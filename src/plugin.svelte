<div class="plugin__mobile-header">
    { title }
</div>
<section class="plugin__content">
    <div class="plugin__title plugin__title--chevron-back" on:click={ () => bcast.emit('rqstOpen', 'menu') }>
        { title }
    </div>

    {#if !offlineMode}
        <p class="status online">🟢 Cache prêt — interception active</p>
    {:else}
        <p class="status offline">🔴 Mode offline — pack actif</p>
    {/if}
</section>

<script lang="ts">
    import bcast from "@windy/broadcast";
    import { onDestroy, onMount } from 'svelte';

    import config from './pluginConfig';
    import { install, uninstall } from './lib/cacheProxy';
    import { isOfflineMode } from './lib/packState';

    const { title } = config;
    let offlineMode = false;

    export const onopen = (_params: unknown) => {
        // Ouvert depuis menu ou context menu
    };

    onMount(() => {
        install();
        syncOfflineState();
    });

    onDestroy(() => {
        uninstall();
    });

    function syncOfflineState(): void {
        offlineMode = isOfflineMode();
        // Simple poll — sera remplacé par du réactif plus tard
        setInterval(() => {
            const current = isOfflineMode();
            if (current !== offlineMode) {
                offlineMode = current;
            }
        }, 1000);
    }
</script>

<style lang="less">
    .plugin__content {
        padding: 12px;
    }
    .status {
        font-size: 0.9em;
        padding: 6px 0;
    }
    .online {
        color: #4caf50;
    }
    .offline {
        color: #ff9800;
    }
</style>
