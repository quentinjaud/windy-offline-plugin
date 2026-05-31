<div class="plugin__mobile-header">
    Windy Offline Test
</div>
<section class="plugin__content">
    <div class="plugin__title plugin__title--chevron-back">
        Windy Offline Test
    </div>
    <p style="color:#4caf50;padding:12px;">✅ Si tu vois ce texte, le plugin se charge correctement.</p>
    <p style="color:#aaa;font-size:0.8em;padding:0 12px;">
        Debug: v0.1.1-test, {new Date().toISOString()}
    </p>
</section>

<script lang="ts">
    import { onMount } from 'svelte';

    onMount(() => {
        console.log('[WindyOffline] Plugin mounted OK');
    });
</script>
