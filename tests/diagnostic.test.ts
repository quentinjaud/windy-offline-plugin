import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

// runDiagnostics fait des import() dynamiques vers cacheProxy, storage, etc.
// En environnement Node/Vitest :
// - @windy/store et @windy/map → échouent → catch → statut 'fail' ou 'warn'
// - ./cacheProxy, ./storage → fonctionnent (fake-indexeddb)
// - IndexedDB → fake-indexeddb répond
// - localStorage → vitest le fournit nativement
// - Citytile réel → pas de token capturé → pas de check (pas d'erreur)

describe('diagnostic - runDiagnostics', () => {
    it('retourne un rapport structuré avec toutes les catégories', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');
        const report = await runDiagnostics();

        // Structure du rapport
        expect(report).toHaveProperty('timestamp');
        expect(report).toHaveProperty('platform');
        expect(report).toHaveProperty('checks');
        expect(report).toHaveProperty('summary');

        // Plateforme
        expect(report.platform).toHaveProperty('userAgent');
        expect(report.platform).toHaveProperty('vendor');
        expect(report.platform).toHaveProperty('platform');
        expect(report.platform).toHaveProperty('language');

        // Checks
        expect(Array.isArray(report.checks)).toBe(true);
        expect(report.checks.length).toBeGreaterThanOrEqual(8);

        // Chaque check a la bonne forme
        for (const c of report.checks) {
            expect(c).toHaveProperty('category');
            expect(c).toHaveProperty('name');
            expect(c).toHaveProperty('status');
            expect(c).toHaveProperty('detail');
            expect(['pass', 'fail', 'warn']).toContain(c.status);
            expect(typeof c.category).toBe('string');
            expect(typeof c.name).toBe('string');
            expect(typeof c.detail).toBe('string');
        }

        // Résumé cohérent
        const pass = report.checks.filter(c => c.status === 'pass').length;
        const fail = report.checks.filter(c => c.status === 'fail').length;
        const warn = report.checks.filter(c => c.status === 'warn').length;
        expect(report.summary.pass).toBe(pass);
        expect(report.summary.fail).toBe(fail);
        expect(report.summary.warn).toBe(warn);
        expect(pass + fail + warn).toBe(report.checks.length);
    });

    it('catégorise correctement les checks', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');
        const report = await runDiagnostics();

        const categories = new Set(report.checks.map(c => c.category));
        expect(categories.has('Plateforme')).toBe(true);
        expect(categories.has('IndexedDB')).toBe(true);
        expect(categories.has('localStorage')).toBe(true);
        expect(categories.has('Fetch interception')).toBe(true);
    });

    it('IndexedDB : ouverture, écriture, lecture OK avec fake-indexeddb', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');
        const report = await runDiagnostics();

        const idbChecks = report.checks.filter(c => c.category === 'IndexedDB');
        expect(idbChecks.length).toBeGreaterThanOrEqual(3);

        // Les 3 checks IndexedDB devraient passer avec fake-indexeddb
        for (const c of idbChecks) {
            expect(c.status).toBe('pass');
        }
    });

    it('localStorage : lecture/écriture OK (ou fail en environnement Node)', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');
        const report = await runDiagnostics();

        const lsCheck = report.checks.find(c => c.category === 'localStorage');
        expect(lsCheck).toBeDefined();
        // En navigateur → pass ; en Node (pas de localStorage natif) → fail.
        expect(['pass', 'fail']).toContain(lsCheck!.status);
        if (lsCheck!.status === 'fail') {
            expect(lsCheck!.detail).toContain('unavailable');
        }
    });

    it('ne lance pas de requête citytile sans token (pas de check ajouté)', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');
        const report = await runDiagnostics();

        // En Node, pas de token → pas de check Citytile API
        const citytileChecks = report.checks.filter(c => c.category === 'Citytile API');
        expect(citytileChecks.length).toBe(0);
    });

    it('nettoie sa base IndexedDB de test après exécution', async () => {
        const { runDiagnostics } = await import('../src/lib/diagnostic');

        // Premier run crée et nettoie
        await runDiagnostics();

        // Vérifie que la base de test n'existe plus
        const dbs = await new Promise<string[]>((resolve) => {
            const req = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
            req.then(d => resolve(d.map((x: any) => x.name)));
        });
        expect(dbs).not.toContain('__windy_diag__');
    });
});
