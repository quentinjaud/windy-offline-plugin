import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto'; // expose les globals IndexedDB (dont IDBKeyRange)
import { IDBFactory } from 'fake-indexeddb';
import { estimateTileCount, type BBox } from '../src/lib/tileMath';
import type { downloadTiles as DownloadTilesFn } from '../src/lib/downloadManager';

const REF_TIME = '2026-06-02T12:00:00Z';
const TINY_BBOX: BBox = { n: 43.001, s: 43.0, e: 5.001, w: 5.0 }; // 1 tile au zoom 9
const SMALL_BBOX: BBox = { n: 44, s: 43, e: 6, w: 5 };            // quelques tiles au zoom 9

function jsonResponse(obj: unknown, status = 200): Response {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// IndexedDB neuf + modules frais à chaque test → zéro état partagé entre tests
// (fake-indexeddb accumule un état global, source de blocages au fil des cycles).
beforeEach(() => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Importe une copie fraîche de downloadTiles (liée au module storage neuf). */
async function freshDownloadTiles(): Promise<typeof DownloadTilesFn> {
    const mod = await import('../src/lib/downloadManager');
    return mod.downloadTiles;
}

/** Installe un fetch mocké comme `window.fetch` (lu par getOriginalFetch). */
function stubFetch(fn: (url: string) => Promise<Response>) {
    const mock = vi.fn(fn);
    vi.stubGlobal('window', { fetch: mock });
    return mock;
}

describe('downloadTiles — robustesse réseau', () => {
    it('réessaie une erreur transitoire (503 puis succès)', async () => {
        const downloadTiles = await freshDownloadTiles();
        let calls = 0;
        const fetchMock = stubFetch(async () => {
            calls++;
            return calls < 3 ? jsonResponse({}, 503) : jsonResponse({ forecast: {} }, 200);
        });

        const result = await downloadTiles({
            model: 'arome', bbox: TINY_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', retryBaseMs: 0,
        });

        expect(result.total).toBe(1);
        expect(result.tileCount).toBe(1);
        expect(result.errors).toHaveLength(0);
        expect(fetchMock).toHaveBeenCalledTimes(3); // 2 échecs + 1 succès
    });

    it('ne réessaie pas une erreur permanente (400)', async () => {
        const downloadTiles = await freshDownloadTiles();
        const fetchMock = stubFetch(async () => jsonResponse({}, 400));

        const result = await downloadTiles({
            model: 'arome', bbox: TINY_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', retryBaseMs: 0,
        });

        expect(result.tileCount).toBe(0);
        expect(result.errors).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1); // pas de retry sur 4xx permanent
    });
});

describe('downloadTiles — concurrence & déduplication', () => {
    it('télécharge toutes les tiles (concurrence > 1)', async () => {
        const downloadTiles = await freshDownloadTiles();
        const expected = estimateTileCount(SMALL_BBOX, [9]);
        expect(expected).toBeGreaterThan(1);

        const fetchMock = stubFetch(async () => jsonResponse({ forecast: {} }));

        const result = await downloadTiles({
            model: 'arome', bbox: SMALL_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', concurrency: 4, retryBaseMs: 0,
        });

        expect(result.total).toBe(expected);
        expect(result.tileCount).toBe(expected);
        expect(fetchMock).toHaveBeenCalledTimes(expected);
    });

    it('saute les tiles déjà en cache (déduplication, aucun fetch)', async () => {
        const downloadTiles = await freshDownloadTiles();

        // 1er passage : remplit le cache.
        stubFetch(async () => jsonResponse({ forecast: {} }));
        const first = await downloadTiles({
            model: 'arome', bbox: SMALL_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', concurrency: 4, retryBaseMs: 0,
        });

        // 2e passage : un fetch qui explose s'il est appelé.
        const fetchMock = stubFetch(async () => { throw new Error('ne devrait pas fetch'); });
        const second = await downloadTiles({
            model: 'arome', bbox: SMALL_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', concurrency: 4, retryBaseMs: 0,
        });

        expect(second.tileCount).toBe(first.total);
        expect(second.errors).toHaveLength(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('s\'interrompt sur un AbortSignal déjà déclenché', async () => {
        const downloadTiles = await freshDownloadTiles();
        const fetchMock = stubFetch(async () => jsonResponse({ forecast: {} }));
        const controller = new AbortController();
        controller.abort();

        const result = await downloadTiles({
            model: 'arome', bbox: SMALL_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', signal: controller.signal, retryBaseMs: 0,
        });

        expect(result.aborted).toBe(true);
        expect(result.tileCount).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
