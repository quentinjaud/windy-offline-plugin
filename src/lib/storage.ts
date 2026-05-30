// IndexedDB StorageEngine — vanilla, zéro dépendance externe.

const DB_NAME = 'windy-offline';
const DB_VERSION = 1;

export interface CacheEntry {
    url: string;       // clé primaire = URL normalisée (sans token2, uid, poc, pr, sc)
    json: unknown;     // le JSON citytile complet
    size: number;      // taille approximative en octets
    createdAt: number; // timestamp
    packId: string;    // référence au pack propriétaire
}

export interface Pack {
    id: string;        // clé primaire auto-générée
    name: string;
    model: string;     // arome, gfs, ecmwf...
    bbox: { n: number; s: number; e: number; w: number };
    zoomLevels: number[];
    timeRange: { start: string; end: string }; // ISO
    tileCount: number;
    totalSize: number;
    createdAt: string; // ISO
}

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
    if (db) return Promise.resolve(db);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains('cacheEntries')) {
                const cacheStore = database.createObjectStore('cacheEntries', { keyPath: 'url' });
                cacheStore.createIndex('packId', 'packId', { unique: false });
                cacheStore.createIndex('createdAt', 'createdAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('packs')) {
                database.createObjectStore('packs', { keyPath: 'id' });
            }
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onerror = () => reject(request.error);
    });
}

export function closeDB(): void {
    if (db) {
        db.close();
        db = null;
    }
}

// CacheEntry CRUD

export async function putCacheEntry(entry: CacheEntry): Promise<void> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readwrite');
        tx.objectStore('cacheEntries').put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getCacheEntry(url: string): Promise<CacheEntry | undefined> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readonly');
        const request = tx.objectStore('cacheEntries').get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function deleteCacheEntriesByPack(packId: string): Promise<void> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readwrite');
        const index = tx.objectStore('cacheEntries').index('packId');
        const request = index.openCursor(IDBKeyRange.only(packId));

        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getCacheSize(): Promise<number> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readonly');
        const request = tx.objectStore('cacheEntries').getAll();
        request.onsuccess = () => {
            const total = (request.result as CacheEntry[]).reduce((sum, e) => sum + e.size, 0);
            resolve(total);
        };
        request.onerror = () => reject(request.error);
    });
}

// Pack CRUD

export async function putPack(pack: Pack): Promise<void> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('packs', 'readwrite');
        tx.objectStore('packs').put(pack);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getPack(id: string): Promise<Pack | undefined> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('packs', 'readonly');
        const request = tx.objectStore('packs').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getAllPacks(): Promise<Pack[]> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('packs', 'readonly');
        const request = tx.objectStore('packs').getAll();
        request.onsuccess = () => resolve(request.result as Pack[]);
        request.onerror = () => reject(request.error);
    });
}

export async function deletePack(id: string): Promise<void> {
    const database = await openDB();
    // Supprimer d'abord les cache entries liées
    await deleteCacheEntriesByPack(id);

    return new Promise((resolve, reject) => {
        const tx = database.transaction('packs', 'readwrite');
        tx.objectStore('packs').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
