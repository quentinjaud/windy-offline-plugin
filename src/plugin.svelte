<div class="plugin__mobile-header">
    { title }
</div>
<section class="plugin__content">
    <div class="plugin__title plugin__title--chevron-back" on:click={ () => bcast.emit('rqstOpen', 'menu') }>
        { title }
    </div>

    <!-- Mode tabs -->
    <div class="tabs">
        <button class="tab" class:active={ mode === 'download' } on:click={ () => mode = 'download' }>
            📥 Télécharger
        </button>
        <button class="tab" class:active={ mode === 'offline' } on:click={ () => mode = 'offline' }>
            💾 Offline ({ packs.length })
        </button>
    </div>

    {#if mode === 'download'}
        <DownloadPanel
            {model}
            {rectBounds}
            {drawing}
            {downloading}
            {progress}
            {errorMsg}
            {mapAvailable}
            on:selectModel={ (e) => model = e.detail }
            on:startDraw={ startDrawing }
            on:screenZone={ useScreenZone }
            on:cancelDraw={ cancelDrawing }
            on:startDownload={ startDownload }
            on:cancelDownload={ cancelDownload }
        />
    {:else}
        <OfflinePanel
            {packs}
            {activePackId}
            {cacheSize}
            on:activatePack={ (e) => activatePack(e.detail) }
            on:deactivatePack={ deactivatePack }
            on:deletePack={ (e) => deletePack(e.detail) }
        />
    {/if}
</section>

<script lang="ts">
    import bcast from "@windy/broadcast";
    import { onDestroy, onMount } from 'svelte';

    import config from './pluginConfig';
    import { install, uninstall } from './lib/cacheProxy';
    import { isOfflineMode, getActivePackId, setActivePackId } from './lib/packState';
    import { getPack, getAllPacks, deletePack as deletePackFromDB, getCacheSize as getTotalCacheSize } from './lib/storage';
    import type { Pack } from './lib/storage';
    import { estimateTileCount } from './lib/tileMath';
    import type { BBox } from './lib/tileMath';
    import { downloadTiles } from './lib/downloadManager';

    // Chargement lazy — @windy/map n'est pas dispo sur mobile
    // Leaflet est global dans Windy (via <script>)
    declare const L: any;
    let map: any = null;

    /** Récupère l'instance Leaflet — essaie @windy/map puis DOM */
    function getWindyMap(): any {
        // Si déjà chargé via @windy/map (desktop)
        if (map) return map;
        // Fallback mobile : l'instance Leaflet est dans le DOM
        const container = document.querySelector('.leaflet-container');
        if (container) {
            return (container as any)._leaflet_map || null;
        }
        return null;
    }

    async function ensureMap(): Promise<void> {
        if (map) return;
        try {
            const windyMap = await import('@windy/map');
            map = windyMap.map;
        } catch {
            map = getWindyMap();
        }
    }

    const { title } = config;

    // UI state
    let mode: 'download' | 'offline' = 'download';
    let model = 'arome';
    let drawing = false;
    let rectBounds: BBox | null = null;
    let downloading = false;
    let errorMsg = '';
    let packs: Pack[] = [];
    let activePackId: string | null = null;
    let cacheSize = 0;
    let mapAvailable = false; // true si @windy/map ou L global est dispo

    // Rectangle drawing layer
    let rectLayer: L.Rectangle | null = null;
    let pointA: L.LatLng | null = null;

    // Progress
    interface Progress {
        downloaded: number;
        total: number;
    }
    let progress: Progress = { downloaded: 0, total: 0 };

    function loadPacks(): void {
        getAllPacks().then(p => {
            packs = p;
        });
        getTotalCacheSize().then(s => {
            cacheSize = s;
        });
        activePackId = getActivePackId();
    }

    function startDrawing(): void {
        if (!map) {
            errorMsg = 'Fonction indisponible sur cette plateforme.';
            return;
        }
        drawing = true;
        rectBounds = null;
        errorMsg = '';

        if (rectLayer) {
            map.removeLayer(rectLayer);
            rectLayer = null;
        }

        map.getContainer().style.cursor = 'crosshair';

        const onClick = (e: L.LeafletMouseEvent) => {
            if (!pointA) {
                pointA = e.latlng;
            } else {
                const bbox: BBox = {
                    n: Math.max(pointA.lat, e.latlng.lat),
                    s: Math.min(pointA.lat, e.latlng.lat),
                    e: Math.max(pointA.lng, e.latlng.lng),
                    w: Math.min(pointA.lng, e.latlng.lng),
                };
                rectBounds = bbox;

                if (rectLayer) map.removeLayer(rectLayer);
                rectLayer = L.rectangle(
                    [[bbox.s, bbox.w], [bbox.n, bbox.e]],
                    { color: '#ff9800', weight: 2, fillOpacity: 0.1 }
                ).addTo(map);

                pointA = null;
                drawing = false;
                map.getContainer().style.cursor = '';
                map.off('click', onClick);
            }
        };

        map.on('click', onClick);
    }

    function cancelDrawing(): void {
        pointA = null;
        drawing = false;
        if (map) {
            map.getContainer().style.cursor = '';
            map.off('click', onClick);
            if (rectLayer) {
                map.removeLayer(rectLayer);
                rectLayer = null;
            }
        }
    }

    async function useScreenZone(): Promise<void> {
        await ensureMap();
        if (!map) {
            errorMsg = 'Impossible d\'accéder à la carte.';
            return;
        }
        const bounds = map.getBounds();
        rectBounds = {
            n: bounds.getNorth(),
            s: bounds.getSouth(),
            e: bounds.getEast(),
            w: bounds.getWest(),
        };

        if (rectLayer) map.removeLayer(rectLayer);
        rectLayer = L.rectangle(
            [[rectBounds.s, rectBounds.w], [rectBounds.n, rectBounds.e]],
            { color: '#4caf50', weight: 2, fillOpacity: 0.1 }
        ).addTo(map);
    }

    async function startDownload(): Promise<void> {
        if (!rectBounds) {
            errorMsg = 'Sélectionne d\'abord une zone.';
            return;
        }

        errorMsg = '';
        downloading = true;

        try {
            const packId = `pack-${Date.now()}`;
            const zoomLevels = [5, 6, 7, 8, 9];
            const hours = getMaxHours(model);

            const result = await downloadTiles({
                model,
                bbox: rectBounds,
                refTime: getRefTime(),
                hours,
                step: 1,
                zoomLevels,
                packId,
                onProgress: (d, t) => {
                    progress = { downloaded: d, total: t };
                },
            });

            if (result.tileCount > 0) {
                const pack: Pack = {
                    id: packId,
                    name: `${model.toUpperCase()} ${formatDate(new Date())}`,
                    model,
                    bbox: rectBounds,
                    zoomLevels,
                    timeRange: {
                        start: getRefTime(),
                        end: addHours(getRefTime(), hours),
                    },
                    tileCount: result.tileCount,
                    totalSize: result.totalSize,
                    createdAt: new Date().toISOString(),
                };
                await import('./lib/storage').then(m => m.putPack(pack));
                loadPacks();
            }

            if (result.errors.length > 0) {
                errorMsg = `${result.tileCount}/${result.total} tiles ok, ${result.errors.length} erreurs.`;
            } else {
                errorMsg = '';
            }
        } catch (e) {
            errorMsg = `Erreur: ${e}`;
        } finally {
            downloading = false;
        }
    }

    function cancelDownload(): void {
        // TODO: implémenter AbortController pour annuler
        downloading = false;
    }

    function activatePack(id: string): void {
        setActivePackId(id);
        activePackId = id;
    }

    function deactivatePack(): void {
        setActivePackId(null);
        activePackId = null;
    }

    async function deletePack(id: string): Promise<void> {
        await deletePackFromDB(id);
        if (activePackId === id) {
            setActivePackId(null);
            activePackId = null;
        }
        loadPacks();
    }

    // Hours max par modèle — valeurs standard
    function getMaxHours(model: string): number {
        const maxHours: Record<string, number> = {
            gfs: 384,
            gfsWaves: 384,
            ecmwf: 240,
            ecmwfWaves: 240,
            icon: 180,
            iconEu: 120,
            iconD2: 48,
            arome: 68,
            aromeFrance: 68,
            namConus: 84,
            namHawaii: 60,
            namAlaska: 60,
            nems: 72,
            hrrrConus: 48,
            hrrrAlaska: 48,
            ukv: 120,
            jmaMsm: 84,
            bomAccess: 168,
            canHrdps: 48,
        };
        return maxHours[model] ?? 68;
    }

    function getRefTime(): string {
        // Utiliser le dernier run disponible — simplifié pour v0.1
        const now = new Date();
        return now.toISOString();
    }

    function addHours(iso: string, hours: number): string {
        const d = new Date(iso);
        d.setUTCHours(d.getUTCHours() + hours);
        return d.toISOString();
    }

    function formatDate(date: Date): string {
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    onMount(async () => {
        install();
        loadPacks();
        await ensureMap();
        mapAvailable = !!map;
    });

    onDestroy(() => {
        uninstall();
        if (map && rectLayer) map.removeLayer(rectLayer);
    });
</script>

<style lang="less">
    .plugin__content {
        padding: 12px;
    }
    .tabs {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
    }
    .tab {
        flex: 1;
        padding: 6px 0;
        border: none;
        background: rgba(255, 255, 255, 0.05);
        color: #aaa;
        cursor: pointer;
        font-size: 0.9em;
        border-radius: 4px;
    }
    .tab.active {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .actions {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
        flex-wrap: wrap;
    }
    .btn {
        padding: 6px 12px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: transparent;
        color: #fff;
        cursor: pointer;
        border-radius: 4px;
        font-size: 0.85em;
    }
    .btn.green {
        border-color: #4caf50;
        color: #4caf50;
    }
    .btn.orange {
        border-color: #ff9800;
        color: #ff9800;
    }
    .btn.red {
        border-color: #f44336;
        color: #f44336;
    }
    .btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    select {
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        font-size: 0.85em;
        width: 100%;
        margin-bottom: 8px;
    }
    .progress-bar {
        width: 100%;
        height: 4px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        margin: 8px 0;
        overflow: hidden;
    }
    .progress-fill {
        height: 100%;
        background: #4caf50;
        transition: width 0.3s;
    }
    .info {
        font-size: 0.8em;
        color: #aaa;
        margin-bottom: 8px;
    }
    .error {
        font-size: 0.8em;
        color: #f44336;
        margin-top: 4px;
    }
    .pack-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .pack-item {
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        margin-bottom: 6px;
    }
    .pack-item.active {
        border-color: #ff9800;
    }
    .pack-name {
        font-weight: bold;
        font-size: 0.85em;
    }
    .pack-info {
        font-size: 0.75em;
        color: #999;
    }
    .pack-actions {
        display: flex;
        gap: 4px;
        margin-top: 4px;
    }
    .pack-actions .btn {
        font-size: 0.75em;
        padding: 3px 8px;
    }
</style>
