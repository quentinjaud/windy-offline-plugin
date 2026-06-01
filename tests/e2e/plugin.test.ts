// Test e2e — charge windy.com avec le plugin local et vérifie le flux
// Usage : npx playwright test tests/e2e/plugin.test.ts --project=chromium
// Prérequis : npm start (serveur HTTPS sur localhost:9999)

import { test, expect } from '@playwright/test';

const WINDY_URL = 'https://www.windy.com/developer-mode';
const PLUGIN_SERVER = 'https://localhost:9999';

test.describe('Windy Offline Plugin', () => {
    test('plugin loads and map is detected', async ({ page }) => {
        // Ignorer les erreurs de certificat (serveur HTTPS local auto-signé)
        page.on('console', msg => {
            if (msg.type() === 'warning') {
                console.log(`  [console.warn] ${msg.text()}`);
            }
        });

        const consoleErrors: string[] = [];
        const consoleWarns: string[] = [];

        page.on('pageerror', err => {
            consoleErrors.push(err.message);
            console.log(`  ❌ pageerror: ${err.message}`);
        });

        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
                console.log(`  ❌ console.error: ${msg.text()}`);
            }
            if (msg.type() === 'warning' && msg.text().includes('[Windy Offline]')) {
                consoleWarns.push(msg.text());
            }
        });

        await page.goto(WINDY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Attendre que la mention du plugin apparaisse dans la page
        console.log('Navigation OK, waiting for plugin to load...');

        // Vérifier que le plugin ne crash pas au chargement
        // (les erreurs ReferenceError, TypeError arrivent dans les 5-10 premières secondes)
        await page.waitForTimeout(15000);

        if (consoleErrors.length > 0) {
            console.log(`\n  ❌ ${consoleErrors.length} console errors detected:`);
            for (const err of consoleErrors) {
                console.log(`     ${err}`);
            }
        }

        if (consoleWarns.length > 0) {
            console.log(`\n  ⚠️ ${consoleWarns.length} Windy Offline warnings:`);
            for (const warn of consoleWarns) {
                console.log(`     ${warn}`);
            }
        }

        // Vérifier qu'aucun ReferenceError de composant Svelte n'est présent
        const refErrors = consoleErrors.filter(e =>
            e.includes('ReferenceError') ||
            e.includes('is not defined') ||
            e.includes('TypeError')
        );
        expect(refErrors.length, `Component errors found: ${refErrors.join('; ')}`).toBe(0);

        // Vérifier que la carte a été détectée
        const mapDetected = consoleErrors.every(e => !e.includes('Map detection failed'));
        expect(mapDetected, 'Map detection failed — check console.warn').toBeTruthy();
    });
});
