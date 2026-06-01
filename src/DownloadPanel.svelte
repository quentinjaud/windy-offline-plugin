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
                <button class="wbtn wbtn--ghost" class:is-active={ drawing } on:click={ () => dispatch('startDraw') }>
                    ✏️ Rectangle
                </button>
                <button class="wbtn wbtn--ghost" on:click={ () => dispatch('screenZone') }>
                    📺 Zone écran
                </button>
                {#if drawing || rectBounds}
                    <button class="wbtn wbtn--ghost icon-only" title="Effacer" on:click={ () => dispatch('cancelDraw') }>
                        ✖
                    </button>
                {/if}
            </div>
        {/if}

        <button
            class="wbtn full"
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
            <button class="wbtn wbtn--ghost full" on:click={ () => dispatch('cancelDownload') }>
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

    /* Bouton-pilule, calqué sur le .button natif Windy et piloté par ses variables */
    .wbtn {
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
        transition: filter 0.15s, background 0.15s;
    }
    .wbtn:hover:not(:disabled) {
        filter: brightness(1.12);
    }
    .wbtn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .wbtn--ghost {
        background-color: transparent;
        color: var(--color-text-primary, #ccc);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.2));
    }
    .wbtn--ghost:hover:not(:disabled) {
        filter: none;
        border-color: var(--color-border-selected, var(--color-orange, #d49500));
        color: var(--color-text-secondary, #fff);
    }
    .wbtn.is-active {
        border-color: var(--color-border-selected, var(--color-orange, #d49500));
        color: var(--color-border-selected, var(--color-orange, #d49500));
    }
    .full {
        width: 100%;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .field__label {
        font-size: 0.72em;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary, #999);
    }
    select {
        width: 100%;
        padding: 8px 10px;
        background-color: var(--color-background-secondary, rgba(255, 255, 255, 0.06));
        color: var(--color-text-primary, inherit);
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.14));
        border-radius: 8px;
        font-size: 0.9em;
        cursor: pointer;
    }

    .zone {
        padding: 12px;
        border: 1px dashed var(--color-border, rgba(255, 255, 255, 0.2));
        border-radius: 10px;
        background-color: var(--color-background-secondary, rgba(255, 255, 255, 0.03));
    }
    .zone--set {
        border-style: solid;
        border-color: var(--color-border-selected, var(--color-orange, #d49500));
    }
    .zone__title {
        font-weight: 600;
        font-size: 0.9em;
        margin-bottom: 4px;
        color: var(--color-text-secondary, #fff);
    }
    .zone__coords {
        font-size: 0.78em;
        color: var(--color-text-primary, #bbb);
    }
    .zone__estimate {
        font-size: 0.78em;
        color: var(--color-text-secondary, #999);
        margin-top: 4px;
    }
    .zone__hint {
        font-size: 0.82em;
        color: var(--color-text-primary, #aaa);
        text-align: center;
    }
    .zone__hint--warn {
        color: var(--color-error, #c42f2f);
    }

    .row {
        display: flex;
        gap: 8px;
    }
    .row .wbtn {
        flex: 1;
    }
    .row .icon-only {
        flex: 0 0 auto;
        min-width: 40px;
        padding: 0.5em;
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
        color: var(--color-text-secondary, #fff);
    }
    .progress__pct {
        font-weight: 600;
    }
    .progress__bar {
        height: 6px;
        background-color: var(--color-border, rgba(255, 255, 255, 0.1));
        border-radius: 3px;
        overflow: hidden;
    }
    .progress__fill {
        height: 100%;
        background-color: var(--color-ui-primary, #d49500);
        transition: width 0.3s ease;
    }
    .progress__count {
        font-size: 0.78em;
        color: var(--color-text-secondary, #999);
        text-align: center;
    }

    .msg {
        font-size: 0.8em;
        color: var(--color-error, #c42f2f);
        padding: 8px 10px;
        border: 1px solid var(--color-error, #c42f2f);
        border-radius: 8px;
    }
</style>
