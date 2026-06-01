<div class="plugin__mobile-header">
    { title }
</div>
<section class="plugin__content">
    <div class="plugin__title plugin__title--chevron-back" on:click={ openMenu }>
        { title }
    </div>

    <p class="intro">Télécharge des couches météo pour les consulter sans connexion. Le rendu reste assuré par Windy.</p>

    <!-- Mode tabs -->
    <div class="tabs" role="tablist">
        <button class="tab" class:active={ mode === 'download' } on:click={ () => mode = 'download' }>
            📥 Télécharger
        </button>
        <button class="tab" class:active={ mode === 'offline' } on:click={ () => mode = 'offline' }>
            💾 Hors-ligne
            {#if packs.length > 0}<span class="tab__count">{ packs.length }</span>{/if}
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

    import bcast from '@windy/broadcast';
    import { map, whenMapInitialized } from '@windy/map';

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
    let mapAvailable = false;

    const { title } = config;

    function openMenu(): void {
        bcast.emit('rqstOpen', 'menu');
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

            // Pack créé uniquement si le téléchargement n'a pas été annulé
            // et qu'au moins une tile a été récupérée.
            if (!result.aborted && result.tileCount > 0) {
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

            if (result.aborted) {
                errorMsg = 'Téléchargement annulé.';
            } else if (result.errors.length > 0) {
                errorMsg = `${result.tileCount}/${result.total} tiles ok, ${result.errors.length} erreur(s).`;
            } else {
                errorMsg = '';
            }
        } catch (e) {
            errorMsg = `Erreur: ${e}`;
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



    onMount(() => {
        install();
        loadPacks();

        // La carte Windy (Leaflet-GL) est disponible via @windy/map.
        // whenMapInitialized garantit qu'elle est prête (desktop, mobile, Android).
        whenMapInitialized(() => {
            mapAvailable = !!map;
            if (!mapAvailable) {
                console.warn('[Windy Offline] map indisponible après initialisation');
            }
        });
    });

    onDestroy(() => {
        uninstall();
        if (rectLayer && map) map.removeLayer(rectLayer);
    });
</script>

<style lang="less">
    .plugin__content {
        padding: 14px;
    }
    .intro {
        font-size: 0.8em;
        line-height: 1.5;
        opacity: 0.65;
        margin: 0 0 14px;
    }

    .tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        margin-bottom: 16px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
    }
    .tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 0;
        border: none;
        background: transparent;
        color: inherit;
        opacity: 0.6;
        cursor: pointer;
        font-size: 0.88em;
        border-radius: 7px;
        transition: background 0.15s, opacity 0.15s;
    }
    .tab:hover {
        opacity: 0.85;
    }
    .tab.active {
        background: rgba(255, 255, 255, 0.12);
        opacity: 1;
        font-weight: 600;
    }
    .tab__count {
        min-width: 18px;
        padding: 0 5px;
        font-size: 0.82em;
        line-height: 18px;
        border-radius: 9px;
        background: #ff9800;
        color: #000;
        font-weight: 700;
    }
</style>
