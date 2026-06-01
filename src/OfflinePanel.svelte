<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { Pack } from './lib/storage';
    import { formatDate, formatSize } from './lib/format';

    export let packs: Pack[];
    export let activePackId: string | null;
    export let cacheSize: number;

    const dispatch = createEventDispatcher<{
        activatePack: string;
        deactivatePack: void;
        deletePack: string;
    }>();
</script>

<div class="off">
    {#if packs.length === 0}
        <div class="empty">
            <div class="empty__icon">💾</div>
            <p class="empty__title">Aucun pack téléchargé</p>
            <p class="empty__hint">Va dans l'onglet « Télécharger » pour enregistrer une zone hors-ligne.</p>
        </div>
    {:else}
        <div class="summary">
            <span>{packs.length} pack{packs.length > 1 ? 's' : ''}</span>
            <span class="summary__size">{formatSize(cacheSize)}</span>
        </div>

        {#if activePackId}
            <div class="banner">🟢 Mode hors-ligne actif — les requêtes sont servies depuis le cache.</div>
        {/if}

        <ul class="list">
            {#each packs as pack (pack.id)}
                <li class="pack" class:pack--active={ pack.id === activePackId }>
                    <div class="pack__head">
                        <span class="pack__name">{pack.name}</span>
                        <span class="pack__badge">{pack.model.toUpperCase()}</span>
                    </div>
                    <div class="pack__meta">
                        {pack.tileCount} tiles · {formatSize(pack.totalSize)} · {formatDate(pack.createdAt)}
                    </div>
                    <div class="pack__meta">
                        {pack.bbox.n.toFixed(1)}°N · {pack.bbox.s.toFixed(1)}°S · {pack.bbox.e.toFixed(1)}°E · {pack.bbox.w.toFixed(1)}°W
                    </div>
                    <div class="pack__actions">
                        {#if pack.id === activePackId}
                            <button class="wbtn" on:click={ () => dispatch('deactivatePack') }>
                                ⏸ Désactiver
                            </button>
                        {:else}
                            <button class="wbtn wbtn--ghost" on:click={ () => dispatch('activatePack', pack.id) }>
                                ▶ Activer
                            </button>
                        {/if}
                        <button class="wbtn wbtn--ghost icon-only" title="Supprimer" on:click={ () => dispatch('deletePack', pack.id) }>
                            🗑
                        </button>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style lang="less">
    .off {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    /* Styles de base .wbtn / .wbtn--ghost définis globalement dans plugin.svelte */
    .empty {
        text-align: center;
        padding: 32px 16px;
        color: var(--color-text-primary, #aaa);
    }
    .empty__icon {
        font-size: 2.4em;
        margin-bottom: 8px;
    }
    .empty__title {
        font-weight: 600;
        margin: 0 0 4px;
        color: var(--color-text-secondary, #fff);
    }
    .empty__hint {
        font-size: 0.82em;
        color: var(--color-text-secondary, #888);
        margin: 0;
        line-height: 1.5;
    }

    .summary {
        display: flex;
        justify-content: space-between;
        font-size: 0.82em;
        color: var(--color-text-secondary, #999);
        padding: 0 2px;
    }
    .summary__size {
        font-weight: 600;
    }

    .banner {
        font-size: 0.8em;
        padding: 8px 10px;
        color: var(--color-ok, #00a316);
        border: 1px solid var(--color-ok, #00a316);
        border-radius: 8px;
    }

    .list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .pack {
        padding: 10px 12px;
        border: 1px solid var(--color-border, rgba(255, 255, 255, 0.12));
        border-radius: 10px;
        background-color: var(--color-background-secondary, rgba(255, 255, 255, 0.03));
    }
    .pack--active {
        border-color: var(--color-border-selected, var(--color-orange, #d49500));
    }
    .pack__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .pack__name {
        font-weight: 600;
        font-size: 0.9em;
        color: var(--color-text-secondary, #fff);
    }
    .pack__badge {
        font-size: 0.68em;
        padding: 2px 7px;
        border-radius: 10px;
        background-color: var(--color-ui-primary, rgba(255, 255, 255, 0.12));
        color: var(--color-white, #fff);
        letter-spacing: 0.04em;
        white-space: nowrap;
    }
    .pack__meta {
        font-size: 0.75em;
        color: var(--color-text-secondary, #999);
        margin-top: 3px;
    }
    .pack__actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
    }
    .pack__actions .wbtn {
        flex: 1;
    }
    .pack__actions .icon-only {
        flex: 0 0 auto;
        min-width: 40px;
        padding: 0.5em;
    }
</style>
