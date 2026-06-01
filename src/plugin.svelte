<div class="plugin__mobile-header">
    { title }
</div>
<section class="plugin__content">
    <div class="plugin__title plugin__title--chevron-back" on:click={ openMenu }>
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
    import { onDestroy, onMount } from 'svelte';

    import DownloadPanel from './DownloadPanel.svelte';
    import OfflinePanel from './OfflinePanel.svelte';

    import config from './pluginConfig';
    import { install, uninstall } from './lib/cacheProxy';
    import { getActivePackId, setActivePackId } from './lib/packState';
    import { getAllPacks, deletePack as deletePackFromDB, getCacheSize as getTotalCacheSize, putPack } from './lib/storage';
    import type { Pack } from './lib/storage';
    import type { BBox } from './lib/tileMath';
    import { getZoomLevels } from './lib/tileMath';
    import { formatDate } from './lib/format';
    import { downloadTiles } from './lib/downloadManager';

    declare const L: any;
    let map: any;
    let mapAvailable = false;
    let mapDetectionAttempted = false;

    const { title } = config;

    // Lazy load @windy/broadcast — contourne le crash au chargement du plugin
    async function openMenu(): Promise<void> {
        try {
            const { default: bcast } = await import('@windy/broadcast');
            bcast.emit('rqstOpen', 'menu');
        } catch {
            // broadcast indisponible, le bouton back ne fait rien
        }
    }

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

    // Rectangle drawing layer
    let rectLayer: L.Rectangle | null = null;
    let pointA: L.LatLng | null = null;
    let clickHandler: ((e: L.LeafletMouseEvent) => void) | null = null;

    // Progress
    interface Progress {
        downloaded: number;
        total: number;
    }
    let progress: Progress = { downloaded: 0, total: 0 };

    // AbortController pour annuler le téléchargement
    let abortController: AbortController | null = null;

    function loadPacks(): void {
        getAllPacks().then(p => {
            packs = p;
        }).catch(() => {
            // IndexedDB indisponible, affichage dégradé
        });
        getTotalCacheSize().then(s => {
            cacheSize = s;
        }).catch(() => {
            cacheSize = 0;
        });
        activePackId = getActivePackId();
    }

    function startDrawing(): void {
        if (!map) { console.warn('[Windy Offline] startDrawing: map not detected'); return; }
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
                clickHandler = null;
            }
        };
        clickHandler = onClick;

        map.on('click', onClick);
    }

    function cancelDrawing(): void {
        if (!map) { console.warn('[Windy Offline] cancelDrawing: map not detected'); return; }
        pointA = null;
        drawing = false;
        map.getContainer().style.cursor = '';
        if (clickHandler) {
            map.off('click', clickHandler);
            clickHandler = null;
        }
        if (rectLayer) {
            map.removeLayer(rectLayer);
            rectLayer = null;
        }
    }

    async function useScreenZone(): Promise<void> {
        if (!map) { console.warn('[Windy Offline] useScreenZone: map not detected'); return; }
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

        // Annuler le téléchargement précédent s'il existe
        abortController?.abort();
        abortController = new AbortController();

        try {
            const packId = `pack-${Date.now()}`;
            const hours = getMaxHours(model);
            const refTime = getRefTime(); // appel UNIQUE — ne pas rappeler (boundary 00Z/06Z/12Z/18Z)

            const result = await downloadTiles({
                model,
                bbox: rectBounds,
                refTime,
                hours,
                step: 1,
                packId,
                signal: abortController.signal,
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
                    zoomLevels: getZoomLevels(rectBounds),
                    timeRange: {
                        start: refTime,
                        end: addHours(refTime, hours),
                    },
                    tileCount: result.tileCount,
                    totalSize: result.totalSize,
                    createdAt: new Date().toISOString(),
                };
                await putPack(pack);
                loadPacks();
            }

            if (result.errors.length > 0) {
                errorMsg = `${result.tileCount}/${result.total} tiles ok, ${result.errors.length} erreurs.`;
            } else {
                errorMsg = '';
            }
        } catch (e) {
            if (abortController?.signal.aborted) {
                errorMsg = 'Téléchargement annulé.';
            } else {
                errorMsg = `Erreur: ${e}`;
            }
        } finally {
            downloading = false;
            abortController = null;
        }
    }

    function cancelDownload(): void {
        abortController?.abort();
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
        // Dernier run modèle : arrondi au multiple de 6h le plus proche dans le passé.
        // Les runs GFS/ECMWF sont à 00Z, 06Z, 12Z, 18Z.
        const now = new Date();
        const hours = now.getUTCHours();
        const lastRunHour = Math.floor(hours / 6) * 6;
        now.setUTCHours(lastRunHour, 0, 0, 0);
        return now.toISOString();
    }

    function addHours(iso: string, hours: number): string {
        const d = new Date(iso);
        d.setUTCHours(d.getUTCHours() + hours);
        return d.toISOString();
    }



    onMount(async () => {
        // Détecter la carte — desktop (window.W.map) ou Android (global W.map via plugin)
        // Fallback : Leaflet global récupéré depuis le DOM
        try {
            map = (typeof (window as any).W !== 'undefined' && (window as any).W.map) ? (window as any).W.map : null;
            if (!map) {
                // Fallback Leaflet : cherche l'instance dans le DOM
                const container = document.querySelector('.leaflet-container') as any;
                map = container?._leaflet_map ?? null;
            }
            mapAvailable = map !== null;
            mapDetectionAttempted = true;
            if (!mapAvailable) {
                console.warn('[Windy Offline] Map detection failed — window.W.map not found, no Leaflet container in DOM');
            }
        } catch (e) {
            mapAvailable = false;
            mapDetectionAttempted = true;
            console.warn('[Windy Offline] Map detection error:', e);
        }

        // Mobile: le conteneur du plugin est dans l'ordre DOM AVANT la progress bar,
        // donc même avec z-index il reste en dessous. Solution Windy officielle :
        // déplacer le noeud dans [data-plugin="bottom-below-controls-mobile"]
        // et appliquer la classe plugin-mobile-bottom-small.
        const pluginNode = document.getElementById('plugin');
        if (pluginNode) {
            const container = pluginNode.parentElement;
            if (container && window.getComputedStyle(container).position === 'fixed') {
                const mobileSlot = document.querySelector('[data-plugin="bottom-below-controls-mobile"]');
                if (mobileSlot) {
                    mobileSlot.appendChild(container);
                    container.classList.add('plugin-mobile-bottom-small');
                }
            }
        }

        install();
        loadPacks();
    });

    onDestroy(() => {
        uninstall();
        if (rectLayer && map) map.removeLayer(rectLayer);
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

</style>
