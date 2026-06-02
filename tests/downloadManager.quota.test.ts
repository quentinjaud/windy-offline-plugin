import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { type BBox } from '../src/lib/tileMath';

// Mock du module storage : putCacheEntry lève un QuotaExceededError,
// le reste (getCacheEntry...) reste réel.
vi.mock('../src/lib/storage', async (importActual) => {
    const actual = await importActual<typeof import('../src/lib/storage')>();
    return {
        ...actual,
        putCacheEntry: vi.fn(async () => {
            throw new DOMException('quota', 'QuotaExceededError');
        }),
    };
});

const REF_TIME = '2026-06-02T12:00:00Z';
const SMALL_BBOX: BBox = { n: 44, s: 43, e: 6, w: 5 };

function jsonResponse(obj: unknown, status = 200): Response {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
    vi.resetModules();
    globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('downloadTiles — quota IndexedDB', () => {
    it('s\'arrête proprement et signale quotaExceeded quand le stockage est plein', async () => {
        vi.stubGlobal('window', { fetch: vi.fn(async () => jsonResponse({ forecast: {} })) });
        const { downloadTiles } = await import('../src/lib/downloadManager');

        const result = await downloadTiles({
            model: 'arome', bbox: SMALL_BBOX, refTime: REF_TIME,
            zoomLevels: [9], packId: 'p1', concurrency: 1, retryBaseMs: 0,
        });

        expect(result.quotaExceeded).toBe(true);
        expect(result.tileCount).toBe(0);
        expect(result.errors.some(e => /quota|plein/i.test(e))).toBe(true);
    });
});
