import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
    putCacheEntry,
    getCacheEntry,
    deleteCacheEntriesByPack,
    getCacheSize,
    countCacheEntriesByPack,
    putPassiveEntry,
    putPack,
    getPack,
    getAllPacks,
    deletePack,
    closeDB,
} from '../src/lib/storage';
import type { CacheEntry, Pack } from '../src/lib/storage';

// Force storage module to re-open DB after deletion
async function resetDB(): Promise<void> {
    const deleteRequest = indexedDB.deleteDatabase('windy-offline');
    await new Promise<void>((resolve) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
        deleteRequest.onblocked = () => resolve();
    });
    // Small delay for fake-indexeddb to settle
    await new Promise(r => setTimeout(r, 20));
}

const makeEntry = (url: string, packId = 'p1'): CacheEntry => ({
    url,
    json: { forecast: { '43.0/5.0': [1, 2, 3] }, hours: [1, 2, 3], reftime: 1780153200000 },
    size: 500,
    createdAt: Date.now(),
    packId,
});

const makePack = (id: string, name: string): Pack => ({
    id,
    name,
    model: 'arome',
    bbox: { n: 44, s: 43, e: 6, w: 5 },
    zoomLevels: [6, 7, 8],
    timeRange: { start: '2026-05-30T00:00:00Z', end: '2026-05-31T00:00:00Z' },
    tileCount: 50,
    totalSize: 25000,
    createdAt: new Date().toISOString(),
});

describe('StorageEngine', () => {
    beforeEach(async () => {
        closeDB();
        await resetDB();
    });

    describe('CacheEntry CRUD', () => {
        it('stores and retrieves a cache entry', async () => {
            const entry = makeEntry('https://node.windy.com/citytile/v1.0/arome/6/33/23?refTime=2026-05-30T15:00:00Z&hours=51&step=1');
            await putCacheEntry(entry);

            const retrieved = await getCacheEntry(entry.url);
            expect(retrieved).toBeDefined();
            expect(retrieved!.url).toBe(entry.url);
            expect(retrieved!.json).toEqual(entry.json);
            expect(retrieved!.size).toBe(500);
            expect(retrieved!.packId).toBe('p1');
        });

        it('returns undefined for non-existent entry', async () => {
            const result = await getCacheEntry('nonexistent-url');
            expect(result).toBeUndefined();
        });

        it('deletes entries by pack', async () => {
            await putCacheEntry(makeEntry('url1', 'packA'));
            await putCacheEntry(makeEntry('url2', 'packA'));
            await putCacheEntry(makeEntry('url3', 'packB'));

            await deleteCacheEntriesByPack('packA');

            expect(await getCacheEntry('url1')).toBeUndefined();
            expect(await getCacheEntry('url2')).toBeUndefined();
            expect(await getCacheEntry('url3')).toBeDefined();
        });
    });

    describe('Cache size', () => {
        it('calculates total cache size', async () => {
            await putCacheEntry({ ...makeEntry('url1'), size: 100 });
            await putCacheEntry({ ...makeEntry('url2'), size: 200 });
            await putCacheEntry({ ...makeEntry('url3'), size: 300 });

            const size = await getCacheSize();
            expect(size).toBe(600);
        });
    });

    describe('Pack CRUD', () => {
        it('stores and retrieves a pack', async () => {
            const pack = makePack('pack1', 'Test Pack');
            await putPack(pack);

            const retrieved = await getPack('pack1');
            expect(retrieved).toBeDefined();
            expect(retrieved!.name).toBe('Test Pack');
            expect(retrieved!.model).toBe('arome');
        });

        it('lists all packs', async () => {
            await putPack(makePack('p1', 'Pack 1'));
            await putPack(makePack('p2', 'Pack 2'));

            const all = await getAllPacks();
            expect(all).toHaveLength(2);
        });

        it('deletes a pack and its cache entries', async () => {
            await putPack(makePack('p1', 'Pack'));
            await putCacheEntry(makeEntry('url1', 'p1'));
            await putCacheEntry(makeEntry('url2', 'p1'));

            await deletePack('p1');

            expect(await getPack('p1')).toBeUndefined();
            expect(await getCacheEntry('url1')).toBeUndefined();
            expect(await getCacheEntry('url2')).toBeUndefined();
        });
    });

    describe('Capture passive bornée', () => {
        it('countCacheEntriesByPack compte les entrées d\'un pack', async () => {
            await putCacheEntry(makeEntry('u1', '__uncaptured__'));
            await putCacheEntry(makeEntry('u2', '__uncaptured__'));
            await putCacheEntry(makeEntry('u3', 'p1'));

            expect(await countCacheEntriesByPack('__uncaptured__')).toBe(2);
            expect(await countCacheEntriesByPack('p1')).toBe(1);
        });

        it('putPassiveEntry évince la plus ancienne au-delà du max', async () => {
            await putPassiveEntry({ ...makeEntry('u1', '__uncaptured__'), createdAt: 1 }, 2);
            await putPassiveEntry({ ...makeEntry('u2', '__uncaptured__'), createdAt: 2 }, 2);
            await putPassiveEntry({ ...makeEntry('u3', '__uncaptured__'), createdAt: 3 }, 2);

            expect(await getCacheEntry('u1')).toBeUndefined(); // la plus ancienne évincée
            expect(await getCacheEntry('u2')).toBeDefined();
            expect(await getCacheEntry('u3')).toBeDefined();
            expect(await countCacheEntriesByPack('__uncaptured__')).toBe(2);
        });
    });
});
