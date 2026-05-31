<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import type { Pack } from './lib/storage';

    export let packs: Pack[];
    export let activePackId: string | null;
    export let cacheSize: number;

    const dispatch = createEventDispatcher<{
        activatePack: string;
        deactivatePack: void;
        deletePack: string;
    }>();

    function formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} o`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
    }

    function formatDate(iso: string): string {
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
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
</style>
