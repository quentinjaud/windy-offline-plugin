import { describe, it, expect } from 'vitest';
import { getMaxZoom, getMaxHours, SELECTABLE_MODELS, MODELS } from '../src/lib/models';
import { getRefTime, addHours } from '../src/lib/downloadManager';

describe('models registry', () => {
    it('returns known maxZoom / maxHours', () => {
        expect(getMaxZoom('arome')).toBe(9);
        expect(getMaxHours('gfs')).toBe(384);
        expect(getMaxZoom('iconD2')).toBe(10);
    });

    it('falls back to defaults for unknown models', () => {
        expect(getMaxZoom('inconnu')).toBe(8);
        expect(getMaxHours('inconnu')).toBe(68);
    });

    it('exposes only selectable models in the UI list', () => {
        expect(SELECTABLE_MODELS.length).toBeLessThan(MODELS.length);
        expect(SELECTABLE_MODELS.every(m => m.selectable)).toBe(true);
        expect(SELECTABLE_MODELS[0].id).toBe('arome'); // défaut en tête
    });
});

describe('forecast time helpers', () => {
    it('floors refTime to the previous 6h UTC boundary', () => {
        expect(getRefTime(new Date('2026-05-30T15:42:00Z'))).toBe('2026-05-30T12:00:00.000Z');
        expect(getRefTime(new Date('2026-05-30T05:59:00Z'))).toBe('2026-05-30T00:00:00.000Z');
        expect(getRefTime(new Date('2026-05-30T18:00:00Z'))).toBe('2026-05-30T18:00:00.000Z');
    });

    it('adds hours across day boundaries (UTC)', () => {
        expect(addHours('2026-05-30T18:00:00.000Z', 12)).toBe('2026-05-31T06:00:00.000Z');
        expect(addHours('2026-05-30T00:00:00.000Z', 68)).toBe('2026-06-01T20:00:00.000Z');
    });
});
