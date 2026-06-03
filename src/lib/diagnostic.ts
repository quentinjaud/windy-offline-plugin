// Diagnostic — collecte des informations d'environnement pour le test Android (A-1).
// Appelable depuis le browser : runDiagnostics() → DiagnosticReport.
//
// Objectifs :
//  1. Vérifier que le plugin se charge dans le WebView Android
//  2. Vérifier que le monkey-patch fetch intercepte citytile
//  3. Vérifier IndexedDB accessible et fonctionnel
//  4. Vérifier localStorage accessible
//  5. Tester une requête citytile réelle (si token capturé)
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
 * nettoyées après).
 */
export async function runDiagnostics(): Promise<DiagnosticReport> {
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
