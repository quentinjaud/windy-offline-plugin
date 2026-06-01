import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import config from '../src/pluginConfig';

// Régression : jusqu'à la v0.2.x le plugin était en mobileUI 'small', un panneau
// `position:relative` sans z-index qui se montait SOUS la barre de timestamp Windy
// (#bottom-wrapper, position:fixed). Le passage en 'fullscreen' corrige ça par
// construction. Ce test verrouille le choix pour éviter une régression silencieuse.
describe('config plugin — régression UI mobile', () => {
    it("mobileUI est 'fullscreen' (pas 'small')", () => {
        expect(config.mobileUI).toBe('fullscreen');
    });

    it('plugin.json reste cohérent avec pluginConfig (mobileUI + version)', () => {
        const pj = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'));
        expect(pj.mobileUI).toBe(config.mobileUI);
        expect(pj.version).toBe(config.version);
    });
});
