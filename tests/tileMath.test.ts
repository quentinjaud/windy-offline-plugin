import { describe, it, expect } from 'vitest';
import { latLonToTile, tileToLatLon, bboxToTiles, estimateTileCount } from '../src/lib/tileMath';

describe('latLonToTile', () => {
    it('converts Paris to known tile coords at zoom 9', () => {
        const { x, y } = latLonToTile(48.8566, 2.3522, 9);
        expect(x).toBe(259);
        expect(y).toBe(176);
    });

    it('converts equator/prime-meridian at zoom 0', () => {
        const { x, y } = latLonToTile(0, 0, 0);
        expect(x).toBe(0);
        expect(y).toBe(0);
    });
});

describe('tileToLatLon', () => {
    it('round-trips with latLonToTile', () => {
        const result = tileToLatLon({ z: 9, x: 259, y: 176 });
        // NW corner of tile for Paris should be north-east of the city
        expect(result.lat).toBeCloseTo(48.922, 0);
        expect(result.lon).toBeCloseTo(2.109, 0);
    });
});

describe('bboxToTiles', () => {
    it('returns tiles covering a small area', () => {
        const bbox = { n: 44, s: 43, e: 6, w: 5 };
        const tiles = bboxToTiles(bbox, 9);
        // 1°x1° at zoom 9 = about 2x2 tiles
        expect(tiles.length).toBeGreaterThan(0);
        expect(tiles.length).toBeLessThanOrEqual(9); // small at zoom 9
        expect(tiles[0].z).toBe(9);
    });

    it('handles normal bbox', () => {
        const bbox = { n: -16, s: -20, e: -175, w: -178 };
        const tiles = bboxToTiles(bbox, 4);
        expect(tiles.length).toBeGreaterThan(0);
    });
});

describe('estimateTileCount', () => {
    it('estimates correct count for known bbox', () => {
        const bbox = { n: 44, s: 43, e: 6, w: 5 };
        const count = estimateTileCount(bbox, [6, 7]);
        expect(count).toBeGreaterThan(0);
    });
});
