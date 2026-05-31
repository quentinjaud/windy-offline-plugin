// DownloadManager — construit les URLs citytile pour une zone/modèle/plage
// et télécharge avec progression.

import { bboxToTiles, getZoomLevels, estimateTileCount, type BBox, type TileCoord } from './tileMath';
import { normalizeUrl } from './urlUtils';
import { putCacheEntry, getCacheEntry } from './storage';
import { getCapturedToken, getCapturedParams } from './cacheProxy';

/**
 * Résolution max (zoom) par modèle météo.
 * Au-delà, l'API citytile renvoie 400.
 */
const MODEL_MAX_ZOOM: Record<string, number> = {
    gfs: 8,
    gfsWaves: 8,
    ecmwf: 7,
    ecmwfWaves: 7,
    icon: 8,
    iconEu: 9,
    iconD2: 10,
    arome: 9,
    aromeFrance: 9,
    namConus: 9,
    namHawaii: 9,
    namAlaska: 9,
    nems: 8,
    hrrrConus: 10,
    hrrrAlaska: 10,
    ukv: 10,
    jmaMsm: 9,
    bomAccess: 8,
    canHrdps: 10,
};

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
}

export interface DownloadResult {
    tileCount: number;
    totalSize: number;
    errors: string[];
}

/**
 * Télécharge toutes les tiles citytile pour les paramètres donnés.
 * Respecte un rate limit de 3 req/s.
 */
export async function downloadTiles(opts: DownloadOptions): Promise<DownloadResult> {
    const hours = opts.hours ?? 68;
    const step = opts.step ?? 1;
    const maxZoom = MODEL_MAX_ZOOM[opts.model] ?? 8;
    const zoomLevels = (opts.zoomLevels ?? getZoomLevels(opts.bbox)).filter(z => z <= maxZoom);

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
    const errors: string[] = [];

    opts.onProgress?.(0, total);

    for (let i = 0; i < allTiles.length; i++) {
        const { url } = allTiles[i];

        // Vérifier l'annulation
        if (opts.signal?.aborted) {
            errors.push('Téléchargement annulé');
            break;
        }

        const cacheKey = normalizeUrl(url);

        // Déduplication : sauter si déjà en cache
        const existing = await getCacheEntry(cacheKey);
        if (existing) {
            downloaded++;
            totalSize += existing.size;
            opts.onProgress?.(i + 1, total);
            continue;
        }

        try {
            const response = await fetch(url);

            if (!response.ok) {
                errors.push(`${url}: HTTP ${response.status}`);
                continue;
            }

            const json = await response.json();
            const body = JSON.stringify(json);
            const size = body.length;

            await putCacheEntry({
                url: cacheKey,
                json,
                size,
                createdAt: Date.now(),
                packId: opts.packId,
            });

            totalSize += size;
            downloaded++;
        } catch (e) {
            errors.push(`${url}: ${e}`);
        }

        opts.onProgress?.(i + 1, total);

        // Rate limiting : max 3 req/s (~333ms par requête)
        // Sauf pour la dernière
        if (i < allTiles.length - 1) {
            await sleep(350);
        }
    }

    return { tileCount: downloaded, totalSize, errors };
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

export { estimateTileCount, getZoomLevels };
