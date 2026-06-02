// IndexedDB StorageEngine — vanilla, zéro dépendance externe.

const DB_NAME = 'windy-offline';
const DB_VERSION = 1;

/** Plafond d'entrées de capture passive (`__uncaptured__`) avant éviction FIFO. */
export const MAX_PASSIVE_ENTRIES = 1000;

/** Détecte un dépassement de quota IndexedDB (stockage plein), tous navigateurs. */
export function isQuotaExceeded(e: unknown): boolean {
    return (
        e instanceof DOMException &&
        (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
    );
}

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
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (db) return Promise.resolve(db);
    // Mémorise la promesse en vol : plusieurs appels concurrents (workers de
    // download, capture passive, lectures) partagent une seule requête open
    // au lieu d'en lancer plusieurs en parallèle sur une DB pas encore créée.
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
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

        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };
    });
    return dbPromise;
}

export function closeDB(): void {
    if (db) {
        db.close();
        db = null;
    }
    dbPromise = null;
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
        // Curseur plutôt que getAll() : on somme les tailles sans matérialiser
        // tous les JSON en mémoire d'un coup (peut peser des centaines de Mo).
        const request = tx.objectStore('cacheEntries').openCursor();
        let total = 0;
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                total += (cursor.value as CacheEntry).size;
                cursor.continue();
            } else {
                resolve(total);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

/** Nombre d'entrées de cache rattachées à un pack (count sur index, sans charger les valeurs). */
export async function countCacheEntriesByPack(packId: string): Promise<number> {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readonly');
        const request = tx.objectStore('cacheEntries').index('packId').count(IDBKeyRange.only(packId));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Supprime l'entrée la plus ancienne (par createdAt) rattachée à un pack donné. */
function deleteOldestByPack(packId: string): Promise<void> {
    return openDB().then(database => new Promise((resolve, reject) => {
        const tx = database.transaction('cacheEntries', 'readwrite');
        const request = tx.objectStore('cacheEntries').index('createdAt').openCursor(); // ascendant = plus ancien d'abord
        request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
                if ((cursor.value as CacheEntry).packId === packId) {
                    cursor.delete();
                    return; // plus ancienne trouvée — tx.oncomplete clôt
                }
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

/**
 * Stocke une entrée de capture passive en bornant leur nombre : au-delà de
 * `max` entrées pour ce pack, évince la plus ancienne (FIFO) avant d'insérer.
 * Évite que la capture passive `__uncaptured__` ne grossisse sans limite.
 */
export async function putPassiveEntry(entry: CacheEntry, max = MAX_PASSIVE_ENTRIES): Promise<void> {
    const count = await countCacheEntriesByPack(entry.packId);
    if (count >= max) {
        await deleteOldestByPack(entry.packId);
    }
    await putCacheEntry(entry);
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
