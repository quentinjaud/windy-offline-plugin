// TransformProbe — sonde + candidat d'interception sur le pipeline de requêtes
// de la carte Leaflet-GL / MapLibre (`map.setTransformRequest`).
//
// Pourquoi : sur l'app Android, on ne sait pas encore par quel transport Windy
// va chercher les tiles citytile (fetch ? XMLHttpRequest ? pipeline GL ?). Le
// `RequestManager` de la carte expose `transformRequest(url, resourceType)`, par
// lequel passe *chaque* requête de la carte — agnostique au transport. SI citytile
// y transite, c'est un point d'interception insensible au problème WebView.
//
// ⚠️ Limite capacitaire (cf. declarations/leaflet-gl-L.d.ts:318-351) :
//   `transformRequest` se déclenche AVANT la requête et ne renvoie que des *inputs*
//   (url / headers / method / body). Il NE PEUT NI synthétiser une réponse NI
//   capturer un corps de réponse. Il sert donc à :
//     - DIAGNOSTIQUER (observer chaque URL + son ResourceType) ← la sonde ci-dessous
//     - REDIRIGER une URL (réécriture de schéma) ← l'interception ci-dessous
//   Pour réellement *servir* du cache via le pipeline GL, il faut coupler la
//   réécriture à `maplibregl.addProtocol(scheme, loadFn)` (decl. 12665), seule API
//   GL capable de rendre un vrai corps. Tout ce volet est gardé par un flag,
//   désactivé par défaut, tant qu'on n'a pas confirmé sur device que citytile
//   passe bien par le pipeline GL.

import { getCacheEntry } from './storage';
import { normalizeUrl } from './urlUtils';
import { getActivePackId } from './packState';

// Signature du callback transformRequest (cf. RequestTransformFunction, decl. 730).
type ResourceType = string;
type RequestParameters = { url: string; headers?: unknown; method?: string; body?: string; type?: string };
type TransformFn = (url: string, resourceType?: ResourceType) => RequestParameters | undefined;

const PROTOCOL = 'windyoffline';

// ──────────────────────────── Sonde (non-mutante) ────────────────────────────

export interface TransformProbeStats {
    available: boolean; // typeof map.setTransformRequest === 'function'
    installed: boolean;
    totalSeen: number;
    citytileSeen: number;
    byResourceType: Record<string, number>;
    firstCitytileUrl: string | null;
    firstAnyUrl: string | null;
    chainedPrevious: boolean; // un transformRequest existait déjà (chaîné, pas écrasé)
}

let stats: TransformProbeStats = freshStats();
let probeInstalled = false;
let previousProbeFn: TransformFn | null = null;

function freshStats(): TransformProbeStats {
    return {
        available: false,
        installed: false,
        totalSeen: 0,
        citytileSeen: 0,
        byResourceType: {},
        firstCitytileUrl: null,
        firstAnyUrl: null,
        chainedPrevious: false,
    };
}

/** Lit le transformRequest déjà en place sur la carte, s'il est exposé. */
function readExistingFn(map: any): TransformFn | null {
    const fn = map?._requestManager?._transformRequestFn;
    return typeof fn === 'function' ? fn : null;
}

/**
 * Installe un `transformRequest` COMPTEUR non-mutant : il observe chaque URL, ne
 * modifie rien (renvoie le résultat du fn précédent s'il existe, sinon `undefined`
 * → MapLibre garde l'URL telle quelle). Chaîne le transformRequest existant pour
 * ne pas casser celui de Windy.
 */
export function installTransformProbe(map: any): void {
    stats = freshStats();
    if (!map || typeof map.setTransformRequest !== 'function') {
        return; // available reste false
    }
    stats.available = true;

    previousProbeFn = readExistingFn(map);
    stats.chainedPrevious = previousProbeFn !== null;

    const probeFn: TransformFn = (url, resourceType) => {
        stats.totalSeen++;
        const type = resourceType ?? 'Unknown';
        stats.byResourceType[type] = (stats.byResourceType[type] ?? 0) + 1;
        if (stats.firstAnyUrl === null) stats.firstAnyUrl = url;
        if (typeof url === 'string' && url.includes('citytile')) {
            stats.citytileSeen++;
            if (stats.firstCitytileUrl === null) stats.firstCitytileUrl = url;
        }
        // Non-mutant : on délègue au fn précédent (chaîné) ou on laisse passer.
        return previousProbeFn ? previousProbeFn(url, resourceType) : undefined;
    };

    map.setTransformRequest(probeFn);
    probeInstalled = true;
    stats.installed = true;
}

/** Restaure le transformRequest précédent (ou un no-op si aucun). */
export function uninstallTransformProbe(map: any): void {
    if (!probeInstalled) return;
    if (map && typeof map.setTransformRequest === 'function') {
        map.setTransformRequest(previousProbeFn ?? ((u: string) => ({ url: u })));
    }
    probeInstalled = false;
    previousProbeFn = null;
    stats.installed = false;
}

export function getTransformProbeStats(): TransformProbeStats {
    return stats;
}

// ─────────────────── Interception réelle (gated par flag) ────────────────────
//
// Désactivée par défaut : protège le chemin fetch éprouvé. À activer dans le code
// (build de test) une fois que la sonde a confirmé sur device que citytile passe
// par le pipeline GL.

let interceptionEnabled = false;
let interceptionInstalled = false;
let previousInterceptionFn: TransformFn | null = null;
let protocolRegistered = false;

export function setTransformInterceptionEnabled(b: boolean): void {
    interceptionEnabled = b;
}

export function isTransformInterceptionEnabled(): boolean {
    return interceptionEnabled;
}

/** Résout l'objet GL exposant addProtocol/removeProtocol (maplibregl ou L). */
function resolveGl(): any {
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    return w?.maplibregl ?? w?.maplibre ?? w?.L ?? undefined;
}

/**
 * Installe l'interception citytile sur le pipeline GL. NO-OP tant que le flag est
 * désactivé (cas par défaut) — donc sans risque d'interférence avec le chemin fetch.
 *
 * En mode offline (pack actif), réécrit l'URL citytile vers `windyoffline://<clé>`
 * et enregistre un handler `addProtocol` qui sert le JSON depuis IndexedDB. Si
 * `addProtocol` est indisponible, on ne réécrit pas (impossible de servir par cette
 * voie — ce sera un constat de sonde). En mode online, ne touche à rien (la capture
 * reste sur le chemin fetch : transformRequest ne voit aucun corps de réponse).
 */
export function installTransformInterception(map: any): void {
    if (!interceptionEnabled) return; // gardé : no-op par défaut
    if (!map || typeof map.setTransformRequest !== 'function') return;

    previousInterceptionFn = readExistingFn(map);

    // Enregistre le protocole custom qui rend le corps depuis le cache.
    const gl = resolveGl();
    if (gl && typeof gl.addProtocol === 'function' && !protocolRegistered) {
        gl.addProtocol(PROTOCOL, async (params: RequestParameters) => {
            const cacheKey = decodeURIComponent(params.url.slice(`${PROTOCOL}://`.length));
            const entry = await getCacheEntry(cacheKey);
            const json = entry ? entry.json : {};
            // Le type attendu dépend de la requête GL ; on couvre json / arrayBuffer / string.
            if (params.type === 'json') return { data: json };
            const text = JSON.stringify(json);
            if (params.type === 'arrayBuffer') return { data: new TextEncoder().encode(text).buffer };
            return { data: text };
        });
        protocolRegistered = true;
    }

    const interceptFn: TransformFn = (url, resourceType) => {
        const passthrough = () => (previousInterceptionFn ? previousInterceptionFn(url, resourceType) : undefined);
        if (typeof url !== 'string' || !url.includes('citytile')) return passthrough();
        // Online : on ne réécrit pas (la capture se fait sur le chemin fetch).
        if (!getActivePackId()) return passthrough();
        // Offline : rediriger vers le protocole custom si on a pu l'enregistrer.
        if (!protocolRegistered) return passthrough();
        return { url: `${PROTOCOL}://${encodeURIComponent(normalizeUrl(url))}` };
    };

    map.setTransformRequest(interceptFn);
    interceptionInstalled = true;
}

export function uninstallTransformInterception(map: any): void {
    if (!interceptionInstalled) return;
    if (map && typeof map.setTransformRequest === 'function') {
        map.setTransformRequest(previousInterceptionFn ?? ((u: string) => ({ url: u })));
    }
    const gl = resolveGl();
    if (protocolRegistered && gl && typeof gl.removeProtocol === 'function') {
        gl.removeProtocol(PROTOCOL);
    }
    interceptionInstalled = false;
    previousInterceptionFn = null;
    protocolRegistered = false;
}
