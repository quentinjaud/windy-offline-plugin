// Registre central des modèles météo Windy.
// Source unique pour : zoom max citytile, portée horaire, libellé, et liste
// proposée dans le sélecteur. Évite la triple duplication qui existait entre
// downloadManager (MODEL_MAX_ZOOM), plugin.svelte (getMaxHours) et
// DownloadPanel (liste MODELS).

export interface ModelInfo {
    id: string;
    label: string;
    maxZoom: number;   // au-delà, l'API citytile renvoie 400
    maxHours: number;  // portée max du forecast (heures)
    selectable: boolean; // proposé dans le sélecteur de l'UI
}

export const MODELS: ModelInfo[] = [
    { id: 'arome', label: 'AROME', maxZoom: 9, maxHours: 68, selectable: true },
    { id: 'gfs', label: 'GFS', maxZoom: 8, maxHours: 384, selectable: true },
    { id: 'gfsWaves', label: 'GFS Waves', maxZoom: 8, maxHours: 384, selectable: true },
    { id: 'ecmwf', label: 'ECMWF', maxZoom: 7, maxHours: 240, selectable: true },
    { id: 'ecmwfWaves', label: 'ECMWF Waves', maxZoom: 7, maxHours: 240, selectable: true },
    { id: 'icon', label: 'ICON', maxZoom: 8, maxHours: 180, selectable: true },
    { id: 'iconEu', label: 'ICON-EU', maxZoom: 9, maxHours: 120, selectable: true },
    { id: 'iconD2', label: 'ICON-D2', maxZoom: 10, maxHours: 48, selectable: true },
    { id: 'namConus', label: 'NAM CONUS', maxZoom: 9, maxHours: 84, selectable: true },
    { id: 'hrrrConus', label: 'HRRR CONUS', maxZoom: 10, maxHours: 48, selectable: true },
    { id: 'nems', label: 'NEMS', maxZoom: 8, maxHours: 72, selectable: true },
    { id: 'ukv', label: 'UKV', maxZoom: 10, maxHours: 120, selectable: true },
    // Non proposés au sélecteur mais reconnus pour les lookups :
    { id: 'namHawaii', label: 'NAM Hawaii', maxZoom: 9, maxHours: 60, selectable: false },
    { id: 'namAlaska', label: 'NAM Alaska', maxZoom: 9, maxHours: 60, selectable: false },
    { id: 'hrrrAlaska', label: 'HRRR Alaska', maxZoom: 10, maxHours: 48, selectable: false },
    { id: 'jmaMsm', label: 'JMA MSM', maxZoom: 9, maxHours: 84, selectable: false },
    { id: 'bomAccess', label: 'BOM Access', maxZoom: 8, maxHours: 168, selectable: false },
    { id: 'canHrdps', label: 'HRDPS', maxZoom: 10, maxHours: 48, selectable: false },
];

const BY_ID: Record<string, ModelInfo> = Object.fromEntries(MODELS.map(m => [m.id, m]));

// Valeurs par défaut si le modèle est inconnu.
const DEFAULT_MAX_ZOOM = 8;
const DEFAULT_MAX_HOURS = 68;

export function getMaxZoom(model: string): number {
    return BY_ID[model]?.maxZoom ?? DEFAULT_MAX_ZOOM;
}

export function getMaxHours(model: string): number {
    return BY_ID[model]?.maxHours ?? DEFAULT_MAX_HOURS;
}

/** Modèles proposés dans le sélecteur de l'UI, dans l'ordre déclaré. */
export const SELECTABLE_MODELS: ModelInfo[] = MODELS.filter(m => m.selectable);
