import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto'; // expose les globals IndexedDB (dont IDBKeyRange)
import { IDBFactory } from 'fake-indexeddb';
import { normalizeUrl } from '../src/lib/urlUtils';

declare const window: { fetch: typeof fetch };

const CITYTILE_URL =
    'https://node.windy.com/citytile/v1.0/arome/9/258/186?hours=68&refTime=2026-06-02T12:00:00Z&step=1&token2=TOK123&uid=U1&pr=0&sc=42';

function jsonResponse(obj: unknown, status = 200): Response {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function waitFor(predicate: () => Promise<boolean>, timeout = 1000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await predicate()) return;
        await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('waitFor: condition non remplie à temps');
}

// IndexedDB neuf + modules frais à chaque test (état partagé sinon).
beforeEach(() => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
    // XMLHttpRequest n'existe pas nativement en Node — mock minimal avec
    // prototype réel pour que le monkey-patch puisse s'y accrocher.
    if (typeof globalThis.XMLHttpRequest === 'undefined') {
        class MockXHR {
            open(_method: string, _url: string | URL, _async?: boolean, _user?: string | null, _pw?: string | null) {}
            send(_body?: any) {}
        }
        (globalThis as any).XMLHttpRequest = MockXHR;
    }
});

afterEach(() => {
    vi.unstubAllGlobals();
    // Nettoyer le mock XHR pour ne pas polluer les autres suites de tests
    delete (globalThis as any).XMLHttpRequest;
});

/** Installe un fetch mocké comme window.fetch, puis active le proxy par-dessus. */
async function setupProxy(networkFetch: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('window', { fetch: networkFetch });
    const proxy = await import('../src/lib/cacheProxy');
    proxy.install();
    return proxy;
}

describe('cacheProxy — interception fetch', () => {
    it('laisse passer les requêtes non-citytile sans capture', async () => {
        const network = vi.fn(async () => jsonResponse({ ok: true }));
        await setupProxy(network);

        await window.fetch('https://example.com/autre-chose');

        expect(network).toHaveBeenCalledWith('https://example.com/autre-chose', undefined);
    });

    it('capture le token et les params de session sur une requête citytile', async () => {
        const network = vi.fn(async () => jsonResponse({ forecast: {} }));
        const proxy = await setupProxy(network);

        await window.fetch(CITYTILE_URL);

        expect(proxy.getCapturedToken()).toBe('TOK123');
        const params = proxy.getCapturedParams();
        expect(params?.uid).toBe('U1');
        expect(params?.pr).toBe('0');
        expect(params?.sc).toBe('42');
    });

    it('mode online : stocke la réponse citytile dans IndexedDB', async () => {
        const payload = { forecast: { '43/5': [1, 2, 3] }, hours: [1], reftime: 123 };
        const network = vi.fn(async () => jsonResponse(payload));
        await setupProxy(network);
        const { getCacheEntry } = await import('../src/lib/storage');
        const key = normalizeUrl(CITYTILE_URL);

        const res = await window.fetch(CITYTILE_URL);
        expect(await res.json()).toEqual(payload); // réponse réseau renvoyée telle quelle

        // La capture est asynchrone : on attend qu'elle atterrisse en cache.
        await waitFor(async () => (await getCacheEntry(key)) !== undefined);
        const entry = await getCacheEntry(key);
        expect(entry?.json).toEqual(payload);
    });

    it('mode offline : sert depuis le cache sans toucher au réseau (hit)', async () => {
        const network = vi.fn(async () => jsonResponse({ from: 'network' }));
        await setupProxy(network);
        const { putCacheEntry } = await import('../src/lib/storage');
        const { setActivePackId } = await import('../src/lib/packState');
        const key = normalizeUrl(CITYTILE_URL);

        await putCacheEntry({ url: key, json: { from: 'cache' }, size: 20, createdAt: Date.now(), packId: 'p1' });
        setActivePackId('p1');

        const res = await window.fetch(CITYTILE_URL);

        expect(await res.json()).toEqual({ from: 'cache' });
        expect(network).not.toHaveBeenCalled();
    });

    it('compte les fetch citytile (et ignore les autres URLs)', async () => {
        const network = vi.fn(async () => jsonResponse({ forecast: {} }));
        const proxy = await setupProxy(network);

        expect(proxy.getFetchCitytileCount()).toBe(0);
        await window.fetch('https://example.com/autre-chose');
        expect(proxy.getFetchCitytileCount()).toBe(0); // non-citytile ignoré
        await window.fetch(CITYTILE_URL);
        expect(proxy.getFetchCitytileCount()).toBe(1);
    });

    it('mode offline : réponse vide sur cache miss, sans toucher au réseau', async () => {
        const network = vi.fn(async () => jsonResponse({ from: 'network' }));
        await setupProxy(network);
        const { setActivePackId } = await import('../src/lib/packState');
        setActivePackId('p1');

        const res = await window.fetch(CITYTILE_URL);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({});
        expect(network).not.toHaveBeenCalled();
    });
});

describe('cacheProxy — XHR interception (compteur)', () => {
    it('incrémente sur citytile, ignore les autres URLs', async () => {
        const network = vi.fn(async () => jsonResponse({}));
        vi.stubGlobal('window', {
            fetch: network,
            XMLHttpRequest: globalThis.XMLHttpRequest,
        });
        const { install, getXHRCitytileCount } = await import('../src/lib/cacheProxy');
        install();

        expect(getXHRCitytileCount()).toBe(0);

        const citytileXhr = new XMLHttpRequest();
        citytileXhr.open('GET', CITYTILE_URL);
        expect(getXHRCitytileCount()).toBe(1);

        const normalXhr = new XMLHttpRequest();
        normalXhr.open('GET', 'https://example.com/other-resource');
        expect(getXHRCitytileCount()).toBe(1); // inchangé
    });
});

describe('cacheProxy — install/uninstall', () => {
    it('compte les références : restauré seulement au dernier uninstall', async () => {
        const network = vi.fn(async () => jsonResponse({}));
        vi.stubGlobal('window', { fetch: network });
        const { install, uninstall } = await import('../src/lib/cacheProxy');

        install();
        install();
        expect(window.fetch).not.toBe(network); // patché

        uninstall();
        expect(window.fetch).not.toBe(network); // encore patché (2 install, 1 uninstall)

        uninstall();
        expect(window.fetch).toBe(network); // restauré
    });
});
