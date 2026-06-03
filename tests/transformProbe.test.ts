import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

const CITYTILE_URL =
    'https://node.windy.com/citytile/v1.0/arome/9/258/186?hours=68&refTime=2026-06-02T12:00:00Z&step=1&token2=TOK&uid=U1';

// Mock de carte Leaflet-GL : setTransformRequest stocke le fn dans _requestManager
// (comme la vraie impl), ce qui permet de tester le chaînage et de piloter le fn
// comme si le pipeline GL l'appelait.
function makeMap(existingFn?: (url: string, type?: string) => unknown) {
    const rm: { _transformRequestFn: any } = { _transformRequestFn: existingFn };
    return {
        _requestManager: rm,
        setTransformRequest(fn: any) { rm._transformRequestFn = fn; },
        // helper de test : simule un appel du pipeline GL
        _call(url: string, type?: string) { return rm._transformRequestFn(url, type); },
    };
}

beforeEach(() => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('transformProbe — sonde non-mutante', () => {
    it('compte citytile / glyphs / sprite par ResourceType', async () => {
        const { installTransformProbe, getTransformProbeStats, uninstallTransformProbe } =
            await import('../src/lib/transformProbe');
        const map = makeMap();

        installTransformProbe(map);
        map._call(CITYTILE_URL, 'Tile');
        map._call('https://example.com/glyphs/0-255.pbf', 'Glyphs');
        map._call('https://example.com/sprite.png', 'SpriteImage');

        const stats = getTransformProbeStats();
        expect(stats.available).toBe(true);
        expect(stats.installed).toBe(true);
        expect(stats.totalSeen).toBe(3);
        expect(stats.citytileSeen).toBe(1);
        expect(stats.firstCitytileUrl).toBe(CITYTILE_URL);
        expect(stats.byResourceType).toEqual({ Tile: 1, Glyphs: 1, SpriteImage: 1 });

        uninstallTransformProbe(map);
        expect(getTransformProbeStats().installed).toBe(false);
    });

    it('chaîne le transformRequest existant et transmet son résultat (non-mutant)', async () => {
        const { installTransformProbe, getTransformProbeStats } = await import('../src/lib/transformProbe');
        const existing = vi.fn((url: string) => ({ url: url + '#prev' }));
        const map = makeMap(existing);

        installTransformProbe(map);
        const result = map._call(CITYTILE_URL, 'Tile');

        expect(getTransformProbeStats().chainedPrevious).toBe(true);
        expect(existing).toHaveBeenCalledWith(CITYTILE_URL, 'Tile');
        expect(result).toEqual({ url: CITYTILE_URL + '#prev' }); // résultat du fn chaîné transmis
    });

    it('restaure le fn précédent à la désinstallation', async () => {
        const { installTransformProbe, uninstallTransformProbe } = await import('../src/lib/transformProbe');
        const existing = (url: string) => ({ url });
        const map = makeMap(existing);

        installTransformProbe(map);
        expect(map._requestManager._transformRequestFn).not.toBe(existing);
        uninstallTransformProbe(map);
        expect(map._requestManager._transformRequestFn).toBe(existing);
    });

    it('available=false et no-op si setTransformRequest absent', async () => {
        const { installTransformProbe, getTransformProbeStats } = await import('../src/lib/transformProbe');
        installTransformProbe({} as any); // pas de setTransformRequest
        const stats = getTransformProbeStats();
        expect(stats.available).toBe(false);
        expect(stats.installed).toBe(false);
    });
});

describe('transformProbe — interception gated', () => {
    it('no-op tant que le flag est désactivé (défaut)', async () => {
        const { installTransformInterception } = await import('../src/lib/transformProbe');
        const map = makeMap();
        installTransformInterception(map);
        expect(map._requestManager._transformRequestFn).toBeUndefined(); // rien installé
    });

    it('offline + flag actif : réécrit citytile vers windyoffline://', async () => {
        const addProtocol = vi.fn();
        vi.stubGlobal('window', { maplibregl: { addProtocol, removeProtocol: vi.fn() } });

        const { setTransformInterceptionEnabled, installTransformInterception } =
            await import('../src/lib/transformProbe');
        const { setActivePackId } = await import('../src/lib/packState');
        const { normalizeUrl } = await import('../src/lib/urlUtils');

        setActivePackId('p1');
        setTransformInterceptionEnabled(true);
        const map = makeMap();
        installTransformInterception(map);

        expect(addProtocol).toHaveBeenCalledWith('windyoffline', expect.any(Function));
        const out = map._call(CITYTILE_URL, 'Tile') as { url: string };
        expect(out.url).toBe('windyoffline://' + encodeURIComponent(normalizeUrl(CITYTILE_URL)));
    });

    it('online (pas de pack) : ne réécrit pas citytile', async () => {
        vi.stubGlobal('window', { maplibregl: { addProtocol: vi.fn(), removeProtocol: vi.fn() } });
        const { setTransformInterceptionEnabled, installTransformInterception } =
            await import('../src/lib/transformProbe');
        const { setActivePackId } = await import('../src/lib/packState');

        setActivePackId(null);
        setTransformInterceptionEnabled(true);
        const map = makeMap();
        installTransformInterception(map);

        const out = map._call(CITYTILE_URL, 'Tile');
        expect(out).toBeUndefined(); // passthrough, pas de réécriture
    });
});
