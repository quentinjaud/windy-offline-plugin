<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { BBox } from './lib/tileMath';

    export let model: string;
    export let rectBounds: BBox | null;
    export let drawing: boolean;
    export let downloading: boolean;
    export let progress: { downloaded: number; total: number };
    export let errorMsg: string;

    const dispatch = createEventDispatcher<{
        selectModel: string;
        startDraw: void;
        screenZone: void;
        cancelDraw: void;
        startDownload: void;
        cancelDownload: void;
    }>();

    const MODELS = [
        'arome', 'aromeFrance', 'gfs', 'gfsWaves', 'ecmwf', 'ecmwfWaves',
        'icon', 'iconEu', 'iconD2', 'namConus', 'hrrrConus', 'nems', 'ukv'
    ];

    $: tileEstimate = rectBounds ? 42 : 0; // estimation ultra-simplifiée pour v0.1
    $: sizeEstimate = tileEstimate > 0 ? tileEstimate * 5 : 0; // ~5 Ko/tile
    $: pct = progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
</script>

<div class="download-panel">
    <select bind:value={ model } on:change={ () => dispatch('selectModel', model) }>
        {#each MODELS as m}
            <option value={m}>{m.toUpperCase()}</option>
        {/each}
    </select>

    {#if !downloading}
        <div class="zone-info">
            {#if rectBounds}
                Zone: {rectBounds.n.toFixed(1)}°N {rectBounds.s.toFixed(1)}°S / {rectBounds.e.toFixed(1)}°E {rectBounds.w.toFixed(1)}°W
                <div class="info">~{tileEstimate} tiles estimées (~{sizeEstimate} Ko)</div>
            {:else if drawing}
                <div class="info">Clique deux points sur la carte pour définir la zone</div>
            {:else}
                <div class="info">Sélectionne une zone pour commencer</div>
            {/if}
        </div>

        <div class="actions">
            <button class="btn orange" on:click={ () => dispatch('startDraw') } disabled={downloading}>
                ✏️ Rectangle
            </button>
            <button class="btn green" on:click={ () => dispatch('screenZone') } disabled={downloading}>
                📺 Zone écran
            </button>
            <button class="btn" on:click={ () => dispatch('cancelDraw') } disabled={!drawing && !rectBounds}>
                ✖ Effacer
            </button>
        </div>

        <button
            class="btn green"
            style="width:100%;margin-top:8px"
            on:click={ () => dispatch('startDownload') }
            disabled={!rectBounds}
        >
            📥 Télécharger
        </button>
    {:else}
        <div class="download-progress">
            <div class="info">Téléchargement en cours... ({pct}%)</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width:{pct}%"></div>
            </div>
            <div class="info">{progress.downloaded} / {progress.total} tiles</div>
            <button class="btn red" style="width:100%;margin-top:8px" on:click={ () => dispatch('cancelDownload') }>
                ✖ Annuler
            </button>
        </div>
    {/if}

    {#if errorMsg}
        <div class="error">{errorMsg}</div>
    {/if}
</div>

<style lang="less">
    .download-panel {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .zone-info {
        font-size: 0.75em;
        color: #ccc;
        padding: 6px 0;
    }
    .download-progress {
        padding: 8px 0;
    }
</style>
