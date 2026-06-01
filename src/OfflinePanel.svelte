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

<div class="offline-panel">
    {#if packs.length === 0}
        <div class="empty">
            <p>Aucun pack téléchargé.</p>
            <p class="info">Passe en mode "Télécharger" pour créer un pack.</p>
        </div>
    {:else}
        <div class="info">
            Cache : {formatSize(cacheSize)} — {packs.length} pack(s)
            {#if activePackId}
                — un pack est actif (mode offline)
            {/if}
        </div>

        <ul class="pack-list">
            {#each packs as pack (pack.id)}
                <li class="pack-item" class:active={ pack.id === activePackId }>
                    <div class="pack-name">{pack.name}</div>
                    <div class="pack-info">
                        {pack.model.toUpperCase()} — {pack.tileCount} tiles — {formatSize(pack.totalSize)} — {formatDate(pack.createdAt)}
                    </div>
                    <div class="pack-info">
                        {pack.bbox.n.toFixed(1)}°N – {pack.bbox.s.toFixed(1)}°S / {pack.bbox.e.toFixed(1)}°E – {pack.bbox.w.toFixed(1)}°W
                    </div>
                    <div class="pack-actions">
                        {#if pack.id === activePackId}
                            <button class="btn orange" on:click={ () => dispatch('deactivatePack') }>
                                ⏸ Désactiver
                            </button>
                        {:else}
                            <button class="btn green" on:click={ () => dispatch('activatePack', pack.id) }>
                                ▶ Activer
                            </button>
                        {/if}
                        <button class="btn red" on:click={ () => dispatch('deletePack', pack.id) }>
                            🗑
                        </button>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style lang="less">
    .offline-panel {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .empty {
        text-align: center;
        padding: 20px 0;
        color: #888;
    }
    .empty p {
        margin: 4px 0;
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
