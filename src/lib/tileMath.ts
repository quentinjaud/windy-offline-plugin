// Tile math — conversion bbox ↔ indices Z/X/Y en projection Web Mercator.

export interface BBox {
    n: number; // latitude nord
    s: number; // latitude sud
    e: number; // longitude est
    w: number; // longitude ouest
}

export interface TileCoord {
    z: number;
    x: number;
    y: number;
}

/**
 * Convertit lat/lon en indices de tile pour un zoom donné.
 * Formules standard Web Mercator.
 */
export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
    const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z)
    );
    return { x, y };
}

/**
 * Convertit un indice de tile en lat/lon du coin nord-ouest.
 */
export function tileToLatLon(tile: TileCoord): { lat: number; lon: number } {
    const n = Math.PI - (2 * Math.PI * tile.y) / Math.pow(2, tile.z);
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    const lon = (tile.x / Math.pow(2, tile.z)) * 360 - 180;
    return { lat, lon };
}

/**
 * Retourne tous les indices de tiles (z/x/y) qui couvrent une bbox
 * pour un niveau de zoom donné.
 */
export function bboxToTiles(bbox: BBox, z: number): TileCoord[] {
    // Clamp latitudes à [-85, 85] — limites Web Mercator
    const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));

    const nw = latLonToTile(clampLat(bbox.n), bbox.w, z);
    const se = latLonToTile(clampLat(bbox.s), bbox.e, z);

    const tiles: TileCoord[] = [];
    const maxTile = Math.pow(2, z) - 1;

    // Les Y sont inversés en Web Mercator (0 = haut)
    const yMin = Math.min(nw.y, se.y);
    const yMax = Math.max(nw.y, se.y);
    const xMin = Math.min(nw.x, se.x);
    const xMax = Math.max(nw.x, se.x);

    for (let x = xMin; x <= xMax; x++) {
        // Wrap X si on dépasse de la bbox (cas rare proche antiméridien)
        const wrappedX = ((x % (maxTile + 1)) + (maxTile + 1)) % (maxTile + 1);
        for (let y = yMin; y <= yMax; y++) {
            tiles.push({ z, x: wrappedX, y });
        }
    }

    return tiles;
}

/**
 * Retourne les niveaux de zoom pertinents pour une zone.
 * Par défaut : du zoom 5 au zoom 10 (résolution suffisante pour météo).
 */
export function getZoomLevels(bbox: BBox, minZ = 5, maxZ = 10): number[] {
    // Une petite bbox mérite des zooms plus élevés
    const latSpan = bbox.n - bbox.s;
    if (latSpan < 1) return [6, 7, 8, 9, 10, 11];
    if (latSpan < 5) return [5, 6, 7, 8, 9, 10];
    return [4, 5, 6, 7, 8, 9];
}

/**
 * Estimation du nombre de tiles pour une bbox.
 */
export function estimateTileCount(bbox: BBox, zoomLevels: number[]): number {
    let total = 0;
    for (const z of zoomLevels) {
        total += bboxToTiles(bbox, z).length;
    }
    return total;
}
