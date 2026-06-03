// Diagnostic — collecte des informations d'environnement pour le test Android (A-1).
// Appelable depuis le browser : runDiagnostics() → DiagnosticReport.
//
// Objectifs :
//  1. Vérifier que le plugin se charge dans le WebView Android
//  2. Vérifier que le monkey-patch fetch intercepte citytile
//  3. Vérifier IndexedDB accessible et fonctionnel
//  4. Vérifier localStorage accessible
//  5. Tester une requête citytile réelle (si token capturé)
//  6. Détecter si Windy Android utilise XHR au lieu de fetch pour citytile
//
// Le rapport est auto-suffisant — un clic, un copier-coller, et on sait tout.

export interface DiagnosticCheck {
    category: string;
    name: string;
    status: 'pass' | 'fail' | 'warn';
    detail: string;
}

export interface DiagnosticReport {
    timestamp: string;
    platform: {
        userAgent: string;
        vendor: string;
        platform: string;
        language: string;
    };
    checks: DiagnosticCheck[];
    summary: {
        pass: number;
        fail: number;
        warn: number;
    };
}

function check(category: string, name: string, status: DiagnosticCheck['status'], detail: string): DiagnosticCheck {
    return { category, name, status, detail };
}

/**
 * Exécute tous les diagnostics et retourne un rapport structuré.
 * Stateless : n'écrit rien de persistant (les entrées test IndexedDB sont
 * nettoyées après, la sonde transformRequest est désinstallée).
 *
 * @param sampleMs fenêtre d'échantillonnage du trafic citytile (fetch / XHR /
 *   transformRequest). 3 s sur device ; les tests passent une petite valeur.
 */
export async function runDiagnostics({ sampleMs = 3000 }: { sampleMs?: number } = {}): Promise<DiagnosticReport> {
    const checks: DiagnosticCheck[] = [];

    // ── Plateforme ──────────────────────────────────────────────
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'node';
    checks.push(check('Plateforme', 'User-Agent', 'pass', ua));

    const vendor = typeof navigator !== 'undefined' ? navigator.vendor : 'node';
    const plt = typeof navigator !== 'undefined' ? navigator.platform : 'node';
    const lang = typeof navigator !== 'undefined' ? navigator.language : 'node';

    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isMobile = isAndroid || isIOS;
    checks.push(check(
        'Plateforme', 'OS détecté',
        'pass',
        isMobile ? (isAndroid ? 'Android' : 'iOS') : 'Desktop'
    ));

    // @windy/* global
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const hasWindyGlobal = win ? typeof win.W !== 'undefined' : false;
    checks.push(check(
        'Plateforme', 'window.W (Windy global)',
        hasWindyGlobal ? 'pass' : 'fail',
        hasWindyGlobal ? 'window.W détecté — les modules @windy/* sont disponibles'
                        : 'window.W absent — plugin isolé ? Pas sur windy.com ?'
    ));

    // @windy/store (test lazy import)
    try {
        const raw: any = await import('@windy/store');
        // @ts-expect-error — les types @windy/store exposent Store pas get()
        const overlay = raw.get('overlay');
        // @ts-expect-error
        const product = raw.get('product');
        checks.push(check(
            'Plateforme', '@windy/store',
            'pass',
            `Module chargé — overlay=${overlay ?? 'null'}, product=${product ?? 'null'}`
        ));
    } catch (e) {
        checks.push(check(
            'Plateforme', '@windy/store',
            isMobile ? 'warn' : 'fail',
            `Module inaccessible: ${e}`
        ));
    }

    // @windy/map (test lazy import)
    try {
        const windyMap = await import('@windy/map');
        checks.push(check(
            'Plateforme', '@windy/map',
            'pass',
            `Module chargé — map=${windyMap.map ? 'présente' : 'null'}`
        ));
    } catch (e) {
        checks.push(check(
            'Plateforme', '@windy/map',
            isMobile ? 'warn' : 'fail',
            `Module inaccessible: ${e}`
        ));
    }

    // ── Realm / hooks (le plugin partage-t-il le contexte JS de la carte ?) ──
    // Décisif pour Android : un WebView n'offre aucune interception native ; le
    // patch fetch/XHR ne marche que si le plugin tourne dans le même realm que la
    // carte. On vérifie aussi quels points de hook GL sont atteignables.
    if (win) {
        const wKeys = win.W && typeof win.W === 'object' ? Object.keys(win.W) : [];
        checks.push(check(
            'Realm / hooks', 'window.W (clés)',
            wKeys.length > 0 ? 'pass' : 'warn',
            wKeys.length > 0 ? `${wKeys.length} clés: ${wKeys.slice(0, 40).join(', ')}`
                             : 'window.W absent ou vide'
        ));

        const gl = win.maplibregl ?? win.maplibre ?? win.L;
        checks.push(check(
            'Realm / hooks', 'addProtocol (GL)',
            gl && typeof gl.addProtocol === 'function' ? 'pass' : 'warn',
            gl && typeof gl.addProtocol === 'function'
                ? 'maplibregl.addProtocol dispo — service offline via pipeline GL envisageable'
                : 'addProtocol indisponible — pas de synthèse de réponse via le pipeline GL'
        ));
    }

    try {
        const { map } = await import('@windy/map');
        const hasSetTransform = !!map && typeof (map as any).setTransformRequest === 'function';
        checks.push(check(
            'Realm / hooks', 'map.setTransformRequest',
            hasSetTransform ? 'pass' : 'warn',
            hasSetTransform ? 'Hook GL atteignable depuis l\'objet map du plugin'
                            : `Indisponible (map=${map ? 'présente' : 'null'}) — le pipeline GL n\'est pas hookable ici`
        ));
    } catch (e) {
        checks.push(check('Realm / hooks', 'map.setTransformRequest', isMobile ? 'warn' : 'fail', `@windy/map inaccessible: ${e}`));
    }

    // ── Fetch interception ──────────────────────────────────────
    try {
        const { getOriginalFetch, getCapturedToken, getCapturedParams } = await import('./cacheProxy');

        const original = getOriginalFetch();
        const patched = window.fetch;
        const isMonkeyPatched = original !== patched;

        checks.push(check(
            'Fetch interception', 'Monkey-patch fetch',
            isMonkeyPatched ? 'pass' : 'fail',
            isMonkeyPatched ? 'window.fetch ≠ original — interception active'
                            : 'window.fetch === original — install() pas appelé ?'
        ));

        const token = getCapturedToken();
        checks.push(check(
            'Fetch interception', 'Token citytile capturé',
            token ? 'pass' : 'warn',
            token ? `Token présent (${token.substring(0, 20)}...)`
                  : 'Aucun token — navigue sur Windy, change de calque pour déclencher des requêtes citytile'
        ));

        const params = getCapturedParams();
        checks.push(check(
            'Fetch interception', 'Params session capturés',
            params && Object.keys(params).length > 0 ? 'pass' : 'warn',
            params ? `${Object.keys(params).length} param(s): ${JSON.stringify(params)}`
                   : 'Aucun param — idem, active un calque météo (vent, vagues...)'
        ));
    } catch (e) {
        checks.push(check(
            'Fetch interception', 'Accès cacheProxy',
            'fail',
            `Erreur import cacheProxy: ${e}`
        ));
    }

    // ── IndexedDB ───────────────────────────────────────────────
    const testKey = '__diag_test__';
    const testValue = { diag: true, ts: Date.now() };

    try {
        // Ouverture
        const openStart = performance.now();
        const dbReq = indexedDB.open('__windy_diag__', 1);
        const db: IDBDatabase = await new Promise((resolve, reject) => {
            dbReq.onupgradeneeded = () => {
                const store = dbReq.result.createObjectStore('test', { keyPath: 'id' });
                store.put({ id: testKey, ...testValue });
            };
            dbReq.onsuccess = () => resolve(dbReq.result);
            dbReq.onerror = () => reject(dbReq.error);
        });
        const openMs = Math.round(performance.now() - openStart);
        checks.push(check(
            'IndexedDB', 'Ouverture',
            'pass',
            `Base créée en ${openMs}ms`
        ));

        // Écriture
        const writeStart = performance.now();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('test', 'readwrite');
            tx.objectStore('test').put({ id: testKey, ...testValue });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        const writeMs = Math.round(performance.now() - writeStart);
        checks.push(check(
            'IndexedDB', 'Écriture',
            'pass',
            `${writeMs}ms`
        ));

        // Lecture
        const readStart = performance.now();
        const entry: any = await new Promise((resolve, reject) => {
            const tx = db.transaction('test', 'readonly');
            const req = tx.objectStore('test').get(testKey);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const readMs = Math.round(performance.now() - readStart);
        const match = entry && entry.diag === true;
        checks.push(check(
            'IndexedDB', 'Lecture',
            match ? 'pass' : 'fail',
            match ? `${readMs}ms — valeur OK` : `Valeur lue incorrecte: ${JSON.stringify(entry)}`
        ));

        // Nettoyage — attendre la suppression avant de continuer
        db.close();
        await new Promise<void>((resolve) => {
            const delReq = indexedDB.deleteDatabase('__windy_diag__');
            delReq.onsuccess = () => resolve();
            delReq.onerror = () => resolve(); // on continue même si erreur
        });
    } catch (e) {
        const isQuota = e instanceof DOMException &&
            (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

        checks.push(check(
            'IndexedDB', 'Opérations',
            'fail',
            isQuota ? `Quota dépassé — stockage plein. ${e}`
                    : `Erreur: ${e}`
        ));

        // Tenter de nettoyer même en erreur
        try { indexedDB.deleteDatabase('__windy_diag__'); } catch { /* ignore */ }
    }

    // ── localStorage ─────────────────────────────────────────────
    try {
        const ls = typeof localStorage !== 'undefined' ? localStorage : null;
        if (!ls) throw new Error('localStorage unavailable (node env)');
        const lsKey = '__windy_diag_ls__';
        ls.setItem(lsKey, 'ok');
        const read = ls.getItem(lsKey);
        ls.removeItem(lsKey);

        checks.push(check(
            'localStorage', 'Lecture/écriture',
            read === 'ok' ? 'pass' : 'fail',
            read === 'ok' ? 'Fonctionnel' : `Lu: "${read}" au lieu de "ok"`
        ));
    } catch (e) {
        checks.push(check(
            'localStorage', 'Lecture/écriture',
            'fail',
            `Inaccessible: ${e}`
        ));
    }

    // ── Citytile réel (si token disponible) ──────────────────────
    try {
        const { getCapturedToken, getOriginalFetch } = await import('./cacheProxy');
        const token = getCapturedToken();
        if (token) {
            // Requête test : tile au centre de la France, zoom 5, modèle ECMWF
            const testUrl = 'https://node.windy.com/citytile/v1.0/ecmwf/5/16/11?token2=' +
                encodeURIComponent(token) + '&refTime=2026-06-01T00:00:00Z&hours=3&step=1';

            const start = performance.now();
            const fetchFn = getOriginalFetch();
            const resp = await fetchFn(testUrl);
            const ms = Math.round(performance.now() - start);

            if (resp.ok) {
                const json = await resp.json();
                const hasForecast = json && typeof json.forecast === 'object';
                checks.push(check(
                    'Citytile API', 'Requête réelle',
                    hasForecast ? 'pass' : 'warn',
                    hasForecast ? `HTTP ${resp.status} en ${ms}ms — forecast présent`
                                : `HTTP ${resp.status} en ${ms}ms — pas de forecast dans la réponse`
                ));
            } else {
                checks.push(check(
                    'Citytile API', 'Requête réelle',
                    'warn',
                    `HTTP ${resp.status} en ${ms}ms — ${resp.statusText || 'erreur'}`
                ));
            }
        }
    } catch (e) {
        // Optionnel — pas de check si aucun token
    }

    // ── Échantillonnage du transport citytile (fetch / XHR / transformRequest) ──
    // Fenêtre unique : on installe la sonde transformRequest (si la carte est
    // atteignable), on relève les compteurs avant/après sampleMs, puis on restaure
    // tout. C'est le cœur du verdict A-1 : par quel transport passe citytile ?
    let probeMap: any = null;
    try {
        const { getXHRCitytileCount, getFetchCitytileCount } = await import('./cacheProxy');
        const probe = await import('./transformProbe');

        try {
            const { map } = await import('@windy/map');
            if (map && typeof (map as any).setTransformRequest === 'function') {
                probeMap = map;
                probe.installTransformProbe(probeMap);
            }
        } catch { /* @windy/map indispo (Node) — on échantillonne fetch/XHR seuls */ }

        const xhrBefore = getXHRCitytileCount();
        const fetchBefore = getFetchCitytileCount();

        await new Promise(r => setTimeout(r, sampleMs));

        const xhrAfter = getXHRCitytileCount();
        const fetchAfter = getFetchCitytileCount();
        const stats = probe.getTransformProbeStats();

        const fetchDelta = fetchAfter - fetchBefore;
        const xhrDelta = xhrAfter - xhrBefore;
        const anyTraffic = fetchAfter > 0 || xhrAfter > 0 || stats.citytileSeen > 0;
        checks.push(check(
            'Transport actif (fetch vs XHR)', 'Compteurs citytile',
            anyTraffic ? 'pass' : 'warn',
            `fetch=${fetchAfter} (+${fetchDelta}), xhr=${xhrAfter} (+${xhrDelta}), transformRequest=${stats.citytileSeen}` +
            (anyTraffic ? '' : ' — aucun trafic : active un calque (vent…) et navigue, puis Relancer.')
        ));

        // Compat : on conserve la catégorie 'XHR interception' historique.
        checks.push(check(
            'XHR interception', 'XMLHttpRequest citytile',
            xhrAfter > 0 ? 'pass' : 'warn',
            xhrAfter > 0 ? `${xhrAfter} XHR citytile au total — Windy utilise (aussi) XHR, le patch fetch ne suffit pas.`
                         : `Aucune requête XHR citytile (total=${xhrAfter}, delta=${xhrDelta}).`
        ));

        // Sonde transformRequest : citytile transite-t-il par le pipeline GL ?
        if (stats.available) {
            checks.push(check(
                'transformRequest probe', 'setTransformRequest',
                'pass',
                `Hook installé${stats.chainedPrevious ? ' (transformRequest existant chaîné)' : ''}.`
            ));
            checks.push(check(
                'transformRequest probe', 'citytile via transformRequest',
                stats.citytileSeen > 0 ? 'pass' : 'warn',
                stats.citytileSeen > 0
                    ? `${stats.citytileSeen} citytile vu(s) via le pipeline GL — interception transformRequest+addProtocol viable. Ex: ${stats.firstCitytileUrl}`
                    : `Aucun citytile via transformRequest (${stats.totalSeen} URLs vues). Soit citytile passe hors pipeline GL, soit navigue avec un calque actif puis Relancer.`
            ));
            checks.push(check(
                'transformRequest probe', 'URLs par ResourceType',
                'pass',
                JSON.stringify(stats.byResourceType)
            ));
        } else {
            checks.push(check(
                'transformRequest probe', 'setTransformRequest',
                'warn',
                'Indisponible — pipeline GL non hookable (carte absente ou API non exposée).'
            ));
        }
    } catch (e) {
        checks.push(check('Transport actif (fetch vs XHR)', 'Échantillonnage', 'fail', `Erreur: ${e}`));
    } finally {
        // Restaurer impérativement le transformRequest de Windy, même en cas d'erreur.
        if (probeMap) {
            try {
                const probe = await import('./transformProbe');
                probe.uninstallTransformProbe(probeMap);
            } catch { /* ignore */ }
        }
    }

    // ── Résumé ───────────────────────────────────────────────────
    const summary = {
        pass: checks.filter(c => c.status === 'pass').length,
        fail: checks.filter(c => c.status === 'fail').length,
        warn: checks.filter(c => c.status === 'warn').length,
    };

    return {
        timestamp: new Date().toISOString(),
        platform: {
            userAgent: ua,
            vendor,
            platform: plt,
            language: lang,
        },
        checks,
        summary,
    };
}
