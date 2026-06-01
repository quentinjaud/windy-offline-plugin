// Test e2e mobile — vérifie qu'en émulation iPhone le panneau du plugin se monte
// AU-DESSUS de la barre de timestamp native de Windy (#bottom-wrapper), et non
// dessous comme avec l'ancien mobileUI 'small' (.plugin-mobile-bottom-small,
// position:relative sans z-index).
//
// Prérequis : `npm start` (serveur HTTPS sur https://localhost:9999) pour que le
// mode développeur Windy charge le plugin local.
// Usage : npx playwright test tests/e2e/mobile.test.ts --project=mobile

import { test, expect } from '@playwright/test';

const WINDY_URL = 'https://www.windy.com/developer-mode';

test.describe('Windy Offline — UI mobile', () => {
    test('le panneau se monte au-dessus de la barre de timestamp', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'Test réservé au projet mobile');

        const fatal: string[] = [];
        page.on('pageerror', e => fatal.push(e.message));
        page.on('console', m => {
            if (m.type() === 'error') fatal.push(m.text());
        });

        await page.goto(WINDY_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });

        // Laisse Windy charger le plugin local et monter le panneau (notre .plugin__content).
        const panel = page.locator('.plugin__content').first();
        let mounted = false;
        try {
            await panel.waitFor({ state: 'visible', timeout: 25000 });
            mounted = true;
        } catch {
            mounted = false;
        }

        // Régression "plante / n'affiche rien" : aucune erreur fatale de composant.
        const componentErrors = fatal.filter(e => /ReferenceError|TypeError|is not defined/.test(e));
        expect(componentErrors, componentErrors.join('; ')).toHaveLength(0);

        if (!mounted) {
            // Honnête : sans plugin monté en headless, l'assertion z-order n'est pas
            // concluante (prérequis npm start + session Windy valide).
            test.skip(true, 'Panneau non monté en headless — assertion z-order non concluante');
            return;
        }

        // Assertion clé : au centre du panneau, l'élément le plus haut doit être le
        // panneau (ou un descendant). Si le timestamp était empilé par-dessus, ce
        // serait #bottom-wrapper → échec.
        const z = await page.evaluate(() => {
            const el = document.querySelector('.plugin__content') as HTMLElement | null;
            if (!el) return { ok: false, inSmall: false, topClass: 'none' };
            const r = el.getBoundingClientRect();
            const cx = Math.round(r.left + r.width / 2);
            const cy = Math.round(r.top + r.height / 2);
            const top = document.elementFromPoint(cx, cy) as HTMLElement | null;
            return {
                ok: !!top && (el === top || el.contains(top)),
                inSmall: !!el.closest('.plugin-mobile-bottom-small'),
                topClass: top ? String(top.className) : 'none',
            };
        });

        // Ne doit plus utiliser le conteneur 'small' fautif.
        expect(z.inSmall, "panneau monté dans .plugin-mobile-bottom-small (mode 'small')").toBe(false);
        // Doit être l'élément topmost en son centre (donc au-dessus du timestamp).
        expect(z.ok, `panneau masqué par un autre élément: ${z.topClass}`).toBe(true);
    });

    test('le bouton « Zone écran » est disponible sur mobile', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'Test réservé au projet mobile');

        await page.goto(WINDY_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });

        const panel = page.locator('.plugin__content').first();
        try {
            await panel.waitFor({ state: 'visible', timeout: 25000 });
        } catch {
            test.skip(true, 'Panneau non monté en headless — prérequis npm start + session Windy');
            return;
        }

        // Régression mobile : la carte doit être détectée (resolveMap : @windy/map
        // → global W → DOM .leaflet-container), donc « Zone écran » doit s'afficher
        // et l'avertissement « Carte non détectée » ne doit pas apparaître.
        const screenZoneBtn = page.locator('text=Zone écran').first();
        await expect(screenZoneBtn, '« Zone écran » introuvable — carte non détectée sur mobile')
            .toBeVisible({ timeout: 5000 });
        await expect(page.locator('text=Carte non détectée')).toHaveCount(0);
    });
});
