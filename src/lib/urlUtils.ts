// URL normalizer — strip les paramètres volatils des URLs citytile.
// Les paramètres token2, uid, poc, pr, sc changent entre sessions
// mais n'affectent pas le contenu de la réponse.

const VOLATILE_PARAMS = ['token2', 'uid', 'poc', 'pr', 'sc', 'labelsVersion', 'v'];

/**
 * Normalise une URL citytile pour usage comme clé de cache.
 * Supprime les params volatils, garde model/z/x/y/refTime/hours/step.
 */
export function normalizeUrl(url: string): string {
    // Ne normalise que les URLs citytile
    if (!url.includes('citytile')) return url;

    const parsed = new URL(url);
    for (const param of VOLATILE_PARAMS) {
        parsed.searchParams.delete(param);
    }

    // Trier les params restants pour ordre déterministe
    parsed.searchParams.sort();
    return parsed.toString();
}

/**
 * Extrait un paramètre d'une URL citytile.
 */
export function getUrlParam(url: string, param: string): string | null {
    const parsed = new URL(url);
    return parsed.searchParams.get(param);
}
