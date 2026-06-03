// CacheProxy — monkey-patch de window.fetch pour intercepter
// les requêtes citytile et les servir depuis/vers IndexedDB.
//
// Modes :
// - Online (par défaut) : capture passive, stocke dans IndexedDB
// - Offline (pack actif) : sert depuis IndexedDB, ne fait pas de requête réseau

import { getCacheEntry, putPassiveEntry } from './storage';
import { normalizeUrl } from './urlUtils';
import { getActivePackId } from './packState';

type FetchFn = typeof window.fetch;

let originalFetch: FetchFn | null = null;
let installCount = 0;
let capturedToken: string | null = null;
let capturedParams: Record<string, string> | null = null;

// Compteur XHR : détecte si Windy Android utilise XMLHttpRequest au lieu de fetch
// pour les requêtes citytile. Incrémenté à chaque open() citytile intercepté.
let xhrCitytileCount = 0;
// Compteur fetch : symétrique du compteur XHR, pour la sonde (delta fetch vs XHR).
// Indépendant de la capture du token (incrémenté même si aucun token2 dans l'URL).
let fetchCitytileCount = 0;
let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;

export function getCapturedToken(): string | null {
    return capturedToken;
}

/** Retourne les paramètres de query capturés sur la dernière requête citytile Windy */
export function getCapturedParams(): Record<string, string> | null {
    return capturedParams;
}

export function getXHRCitytileCount(): number {
    return xhrCitytileCount;
}

export function getFetchCitytileCount(): number {
    return fetchCitytileCount;
}

/** Retourne le fetch original (avant monkey-patch) pour contourner le proxy */
export function getOriginalFetch(): typeof window.fetch {
    return originalFetch || window.fetch;
}

export function install(): void {
    installCount++;
    if (installCount > 1) return; // déjà installé

    originalFetch = window.fetch;

    // ──────────── XHR interception (compteur uniquement) ────────────
    // Windy Android utilise potentiellement XMLHttpRequest plutôt que fetch
    // pour ses requêtes citytile. On patche open() pour incrémenter un
    // compteur passif — pas d'interception fonctionnelle pour l'instant,
    // le but est de confirmer le transport avant d'investir dedans.
    if (typeof XMLHttpRequest !== 'undefined') {
        originalXHROpen = XMLHttpRequest.prototype.open;
        originalXHRSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function patchedXHROpen(
            this: XMLHttpRequest,
            method: string,
            url: string | URL,
            async?: boolean,
            username?: string | null,
            password?: string | null,
        ): void {
            const urlStr = typeof url === 'string' ? url : url.href;
            if (urlStr.includes('citytile')) {
                xhrCitytileCount++;
            }
            // @ts-expect-error — overloads conflict but runtime is fine
            return originalXHROpen!.call(this, method, url, async, username, password);
        };

        XMLHttpRequest.prototype.send = function patchedXHRSend(
            this: XMLHttpRequest,
            body?: Document | XMLHttpRequestBodyInit | null,
        ): void {
            return originalXHRSend!.call(this, body);
        };
    }

    // ──────────── fetch interception ────────────
    window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        // Ne pas intercepter les requêtes non-citytile
        if (!url.includes('citytile')) {
            return originalFetch!(input, init);
        }

        // Compteur sonde : citytile passe par fetch (par opposition à XHR / transformRequest).
        fetchCitytileCount++;

        // Capturer le token d'auth
        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get('token2');
        if (token) capturedToken = token;

        // Capturer les params de session Windy (indépendamment du token)
        const keys = ['uid', 'pr', 'sc', 'poc', 'v', 'labelsVersion'];
        const params: Record<string, string> = {};
        for (const key of keys) {
            const val = parsedUrl.searchParams.get(key);
            if (val) params[key] = val;
        }
        if (Object.keys(params).length > 0) {
            capturedParams = params;
        }

        const cacheKey = normalizeUrl(url);
        const activePackId = getActivePackId();

        // Mode offline : servir depuis le cache
        if (activePackId) {
            const cached = await getCacheEntry(cacheKey);
            if (cached) {
                return rebuildResponse(cached.json);
            }
            // Cache miss en mode offline : retourner une réponse vide
            // (Windy gère ça en affichant des zones grises)
            return new Response('{}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Mode online : fetch normal + capture
        const response = await originalFetch!(input, init);

        // Capture asynchrone (ne bloque pas la réponse)
        captureResponse(cacheKey, response, activePackId);

        return response;
    };
}

export function uninstall(): void {
    installCount--;
    if (installCount > 0) return;
    if (originalFetch) {
        window.fetch = originalFetch;
        originalFetch = null;
    }
}

async function captureResponse(cacheKey: string, response: Response, packId: string | null): Promise<void> {
    try {
        const cloned = response.clone();
        const json = await cloned.json();

        const size = new Blob([JSON.stringify(json)]).size;

        await putPassiveEntry({
            url: cacheKey,
            json,
            size,
            createdAt: Date.now(),
            packId: packId || '__uncaptured__',
        });
    } catch {
        // Silencieux : l'échec de capture ne doit pas casser Windy
    }
}

function rebuildResponse(json: unknown): Response {
    const body = JSON.stringify(json);
    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
