<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { BBox } from './lib/tileMath';
    import { estimateTileCount, getZoomLevels } from './lib/tileMath';
    import { MODEL_MAX_ZOOM } from './lib/downloadManager';
    import { formatSize } from './lib/format';

    export let model: string;
    export let rectBounds: BBox | null;
    export let drawing: boolean;
    export let downloading: boolean;
    export let progress: { downloaded: number; total: number };
    export let errorMsg: string;
    export let mapAvailable = true;

    const dispatch = createEventDispatcher<{
        selectModel: string;
        startDraw: void;
        screenZone: void;
        cancelDraw: void;
        startDownload: void;
        cancelDownload: void;
    }>();

    const MODELS = [
        'arome', 'gfs', 'gfsWaves', 'ecmwf', 'ecmwfWaves',
        'icon', 'iconEu', 'iconD2', 'namConus', 'hrrrConus', 'nems', 'ukv',
    ];

    $: maxZoom = MODEL_MAX_ZOOM[model] ?? 8;
    $: tileEstimate = rectBounds
        ? estimateTileCount(rectBounds, getZoomLevels(rectBounds).filter(z => z <= maxZoom))
        : 0;
    // Heuristique : ~5 Ko par tile citytile.
    $: sizeEstimate = tileEstimate * 5 * 1024;
    $: pct = progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : 0;
</script>

<div class="dl">
    {#if !downloading}
        <label class="field">
            <span class="field__label">Modèle météo</span>
            <select bind:value={ model } on:change={ () => dispatch('selectModel', model) }>
                {#each MODELS as m}
                    <option value={m}>{m.toUpperCase()}</option>
                {/each}
            </select>
        </label>

        <div class="zone" class:zone--set={ !!rectBounds }>
            {#if !mapAvailable}
                <div class="zone__hint zone__hint--warn">⚠️ Carte non détectée — recharge la page Windy.</div>
            {:else if rectBounds}
                <div class="zone__title">📍 Zone sélectionnée</div>
                <div class="zone__coords">
                    {rectBounds.n.toFixed(1)}°N · {rectBounds.s.toFixed(1)}°S · {rectBounds.e.toFixed(1)}°E · {rectBounds.w.toFixed(1)}°W
                </div>
                <div class="zone__estimate">~{tileEstimate} tiles · ~{formatSize(sizeEstimate)}</div>
            {:else if drawing}
                <div class="zone__hint">✏️ Clique deux points sur la carte pour délimiter la zone.</div>
            {:else}
                <div class="zone__hint">Sélectionne une zone à télécharger.</div>
            {/if}
        </div>

        {#if mapAvailable}
            <div class="row">
                <button class="button button--variant-clear" on:click={ () => dispatch('startDraw') } class:is-active={ drawing }>
                    ✏️ Rectangle
                </button>
                <button class="button button--variant-clear" on:click={ () => dispatch('screenZone') }>
                    📺 Zone écran
                </button>
                {#if drawing || rectBounds}
                    <button class="button button--variant-clear icon-only" title="Effacer" on:click={ () => dispatch('cancelDraw') }>
                        ✖
                    </button>
                {/if}
            </div>
        {/if}

        <button
            class="button button--variant-orange full"
            on:click={ () => dispatch('startDownload') }
            disabled={ !rectBounds || !mapAvailable }
        >
            📥 Télécharger
        </button>
    {:else}
        <div class="progress">
            <div class="progress__head">
                <span>Téléchargement…</span>
                <span class="progress__pct">{pct}%</span>
            </div>
            <div class="progress__bar"><div class="progress__fill" style="width:{pct}%"></div></div>
            <div class="progress__count">{progress.downloaded} / {progress.total} tiles</div>
            <button class="button button--variant-clear full" on:click={ () => dispatch('cancelDownload') }>
                ✖ Annuler
            </button>
        </div>
    {/if}

    {#if errorMsg}
        <div class="msg">{errorMsg}</div>
    {/if}
</div>

<style lang="less">
    .dl {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .field__label {
        font-size: 0.75em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.6;
    }
    select {
        width: 100%;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.06);
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        font-size: 0.9em;
        cursor: pointer;
    }

    .zone {
        padding: 12px;
        border: 1px dashed rgba(255, 255, 255, 0.2);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
    }
    .zone--set {
        border-style: solid;
        border-color: rgba(255, 152, 0, 0.5);
        background: rgba(255, 152, 0, 0.08);
    }
    .zone__title {
        font-weight: 600;
        font-size: 0.9em;
        margin-bottom: 4px;
    }
    .zone__coords {
        font-size: 0.78em;
        opacity: 0.8;
    }
    .zone__estimate {
        font-size: 0.78em;
        opacity: 0.6;
        margin-top: 4px;
    }
    .zone__hint {
        font-size: 0.82em;
        opacity: 0.7;
        text-align: center;
    }
    .zone__hint--warn {
        color: #ff9800;
        opacity: 1;
    }

    .row {
        display: flex;
        gap: 8px;
    }
    .row .button {
        flex: 1;
    }
    .row .icon-only {
        flex: 0 0 auto;
        min-width: 38px;
    }
    .button.is-active {
        outline: 2px solid rgba(255, 152, 0, 0.7);
    }
    .full {
        width: 100%;
    }

    .progress {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px 0;
    }
    .progress__head {
        display: flex;
        justify-content: space-between;
        font-size: 0.85em;
    }
    .progress__pct {
        font-weight: 600;
    }
    .progress__bar {
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
    }
    .progress__fill {
        height: 100%;
        background: linear-gradient(90deg, #ffb300, #ff9800);
        transition: width 0.3s ease;
    }
    .progress__count {
        font-size: 0.78em;
        opacity: 0.6;
        text-align: center;
    }

    .msg {
        font-size: 0.8em;
        color: #ff9800;
        padding: 8px 10px;
        background: rgba(255, 152, 0, 0.1);
        border-radius: 8px;
    }
</style>
