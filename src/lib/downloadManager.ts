// DownloadManager — construit les URLs citytile pour une zone/modèle/plage
// et télécharge avec progression.

import { bboxToTiles, getZoomLevels, type BBox, type TileCoord } from './tileMath';
import { normalizeUrl } from './urlUtils';
import { putCacheEntry, getCacheEntry, isQuotaExceeded } from './storage';
import { getCapturedToken, getCapturedParams, getOriginalFetch } from './cacheProxy';
import { getMaxZoom } from './models';

const CITYTILE_BASE = 'https://node.windy.com/citytile/v1.0';

export interface DownloadOptions {
    model: string;       // arome, gfs, ecmwf...
    bbox: BBox;
    refTime: string;     // ISO 8601, ex: '2026-05-30T15:00:00Z'
    hours?: number;      // nombre d'heures de forecast (défaut: 68)
    step?: number;       // pas en heures (défaut: 1)
    zoomLevels?: number[];
    packId: string;      // ID du pack à créer
    signal?: AbortSignal; // pour annulation
    onProgress?: (downloaded: number, total: number) => void;
    concurrency?: number; // requêtes simultanées (défaut: 4)
    maxRetries?: number;  // tentatives sur erreur transitoire (défaut: 3)
    retryBaseMs?: number; // base du backoff exponentiel (défaut: 500ms)
}

export interface DownloadResult {
    tileCount: number;  // tiles effectivement en cache
    total: number;      // tiles visées (dénominateur de progression)
    totalSize: number;
    errors: string[];
    aborted: boolean;
    quotaExceeded: boolean; // stockage IndexedDB plein → download stoppé
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;

/**
 * Télécharge toutes les tiles citytile pour les paramètres donnés.
 *
 * Parallélise via un pool borné (`concurrency`) et réessaie les erreurs
 * transitoires (429, 5xx, erreurs réseau) avec un backoff exponentiel. Les
 * erreurs permanentes (4xx hors 429, ex. 400 paramètres invalides) ne sont
 * pas réessayées. Pas de délai fixe : la concurrence + le backoff adaptatif
 * sur 429 régulent naturellement le débit.
 */
export async function downloadTiles(opts: DownloadOptions): Promise<DownloadResult> {
    const hours = opts.hours ?? 68;
    const step = opts.step ?? 1;
    const maxZoom = getMaxZoom(opts.model);
    const zoomLevels = (opts.zoomLevels ?? getZoomLevels(opts.bbox)).filter(z => z <= maxZoom);
    const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

    // Générer toutes les tiles avec le token d'auth
    const token = getCapturedToken();
    const allTiles: { tile: TileCoord; url: string }[] = [];
    for (const z of zoomLevels) {
        const tiles = bboxToTiles(opts.bbox, z);
        for (const tile of tiles) {
            const rawUrl = buildCitytileUrl(opts.model, tile, opts.refTime, hours, step, token);
            allTiles.push({ tile, url: rawUrl });
        }
    }

    const total = allTiles.length;
    let downloaded = 0;
    let totalSize = 0;
    let completed = 0;
    let aborted = false;
    let quotaExceeded = false;
    const errors: string[] = [];
    const originalFetch = getOriginalFetch();

    opts.onProgress?.(0, total);

    let next = 0;
    async function worker(): Promise<void> {
        while (true) {
            if (opts.signal?.aborted) { aborted = true; return; }
            if (quotaExceeded) return; // stockage plein : on arrête de planifier
            const i = next++;
            if (i >= allTiles.length) return;

            const { url } = allTiles[i];
            const cacheKey = normalizeUrl(url);

            try {
                // Déduplication : sauter si déjà en cache
                const existing = await getCacheEntry(cacheKey);
                if (existing) {
                    downloaded++;
                    totalSize += existing.size;
                } else {
                    const response = await fetchWithRetry(originalFetch, url, maxRetries, retryBaseMs, opts.signal);
                    if (!response.ok) {
                        errors.push(`${url}: HTTP ${response.status}`);
                    } else {
                        const json = await response.json();
                        const body = JSON.stringify(json);
                        const size = new Blob([body]).size;
                        await putCacheEntry({ url: cacheKey, json, size, createdAt: Date.now(), packId: opts.packId });
                        totalSize += size;
                        downloaded++;
                    }
                }
            } catch (e) {
                if (opts.signal?.aborted) { aborted = true; return; }
                if (isQuotaExceeded(e)) {
                    quotaExceeded = true;
                    errors.push(`${url}: stockage plein (quota IndexedDB dépassé)`);
                    return;
                }
                errors.push(`${url}: ${e}`);
            }

            completed++;
            opts.onProgress?.(completed, total);
        }
    }

    const pool = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    await Promise.all(pool);

    return { tileCount: downloaded, total, totalSize, errors, aborted, quotaExceeded };
}

/**
 * Fetch avec retry/backoff exponentiel sur erreurs transitoires (429, 5xx,
 * erreur réseau). Retourne la dernière réponse (même !ok) une fois les
 * tentatives épuisées ; relance l'erreur réseau si toutes échouent.
 */
async function fetchWithRetry(
    fetchFn: typeof window.fetch,
    url: string,
    maxRetries: number,
    retryBaseMs: number,
    signal?: AbortSignal,
): Promise<Response> {
    let attempt = 0;
    while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            const response = await fetchFn(url, signal ? { signal } : undefined);
            const transient = response.status === 429 || response.status >= 500;
            if (transient && attempt < maxRetries) {
                attempt++;
                await sleep(retryBaseMs * Math.pow(2, attempt - 1));
                continue;
            }
            return response;
        } catch (e) {
            if (signal?.aborted || attempt >= maxRetries) throw e;
            attempt++;
            await sleep(retryBaseMs * Math.pow(2, attempt - 1));
        }
    }
}

function buildCitytileUrl(model: string, tile: TileCoord, refTime: string, hours: number, step: number, token?: string | null): string {
    // Garder le format ISO avec 'Z' (Windy le valide)
    const cleanRefTime = refTime.replace(/\.\d{3}Z?$/, 'Z');
    const params = new URLSearchParams({
        refTime: cleanRefTime,
        hours: String(hours),
        step: String(step),
    });
    if (token) params.set('token2', token);
    // Ajouter les params capturés de Windy (uid, pr, sc, poc, v, labelsVersion)
    const captured = getCapturedParams();
    if (captured) {
        for (const [k, v] of Object.entries(captured)) {
            if (!params.has(k)) params.set(k, v);
        }
    }
    return `${CITYTILE_BASE}/${model}/${tile.z}/${tile.x}/${tile.y}?${params.toString()}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * RefTime du dernier run modèle : arrondi au multiple de 6h le plus proche
 * dans le passé (runs GFS/ECMWF à 00Z, 06Z, 12Z, 18Z).
 */
export function getRefTime(now: Date = new Date()): string {
    const d = new Date(now);
    const lastRunHour = Math.floor(d.getUTCHours() / 6) * 6;
    d.setUTCHours(lastRunHour, 0, 0, 0);
    return d.toISOString();
}

/** Décale une date ISO de `hours` heures (UTC). */
export function addHours(iso: string, hours: number): string {
    const d = new Date(iso);
    d.setUTCHours(d.getUTCHours() + hours);
    return d.toISOString();
}
