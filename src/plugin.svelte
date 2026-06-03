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
        <button class="tab" class:active={ mode === 'diagnostic' } on:click={ () => mode = 'diagnostic' }>
            🔍 Diag.
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
    {:else if mode === 'diagnostic'}
        <DiagnosticPanel />
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
    import DiagnosticPanel from './DiagnosticPanel.svelte';

    import config from './pluginConfig';
    import { install, uninstall } from './lib/cacheProxy';
    import { getActivePackId, setActivePackId } from './lib/packState';
    import { getAllPacks, deletePack as deletePackFromDB, getCacheSize as getTotalCacheSize, putPack } from './lib/storage';
    import type { Pack } from './lib/storage';
    import type { BBox } from './lib/tileMath';
    import { getZoomLevels } from './lib/tileMath';
    import { formatDate } from './lib/format';
    import { downloadTiles, getRefTime, addHours } from './lib/downloadManager';
    import { getMaxHours } from './lib/models';

    declare const L: any;
    let mapAvailable = false;

    const { title } = config;

    function openMenu(): void {
        bcast.emit('rqstOpen', 'menu');
    }

    // UI state
    let mode: 'download' | 'offline' | 'diagnostic' = 'download';
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

            if (result.quotaExceeded) {
                errorMsg = `Stockage plein : ${result.tileCount}/${result.total} tiles téléchargées. Libère de l'espace ou réduis la zone.`;
            } else if (result.aborted) {
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
        color: var(--color-text-secondary, #999);
        margin: 0 0 14px;
    }

    .tabs {
        display: flex;
        gap: 4px;
        padding: 4px;
        margin-bottom: 16px;
        background-color: var(--color-background-secondary, rgba(255, 255, 255, 0.05));
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
        color: var(--color-text-primary, #aaa);
        cursor: pointer;
        font-size: 0.88em;
        border-radius: 7px;
        transition: background 0.15s, color 0.15s;
    }
    .tab.active {
        background-color: var(--color-ui-primary, rgba(255, 255, 255, 0.12));
        color: var(--color-white, #fff);
        font-weight: 600;
    }
    .tab__count {
        min-width: 18px;
        padding: 0 5px;
        font-size: 0.82em;
        line-height: 18px;
        border-radius: 9px;
        background-color: var(--color-orange, #d49500);
        color: var(--color-white, #fff);
        font-weight: 700;
    }
    .tab.active .tab__count {
        background-color: rgba(0, 0, 0, 0.25);
    }

    /* Bouton-pilule calqué sur le .button natif Windy, piloté par ses variables
       de thème. Défini en :global pour être partagé par DownloadPanel et
       OfflinePanel (composants enfants) sans duplication. */
    :global(.wbtn) {
        cursor: pointer;
        appearance: none;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 0;
        border-radius: 2em;
        padding: 0.5em 1.1em;
        font-size: 0.85em;
        font-weight: 400;
        line-height: normal;
        color: var(--color-white, #f8f8f8);
        background-color: var(--color-ui-primary, #9d0300);
        transition: filter 0.15s, border-color 0.15s;
    }
    :global(.wbtn:hover:not(:disabled)) {
        filter: brightness(1.12);
    }
    :global(.wbtn:disabled) {
        opacity: 0.4;
        cursor: not-allowed;
    }
    :global(.wbtn--ghost) {
        background-color: transparent;
        color: var(--color-text-primary, #ccc);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.2));
    }
    :global(.wbtn--ghost:hover:not(:disabled)) {
        filter: none;
        border-color: var(--color-border-selected, var(--color-orange, #d49500));
        color: var(--color-text-secondary, #fff);
    }
</style>
