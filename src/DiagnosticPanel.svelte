<script lang="ts">
    import { runDiagnostics, type DiagnosticReport, type DiagnosticCheck } from './lib/diagnostic';

    type State = 'idle' | 'running' | 'done' | 'error';

    let state: State = 'idle';
    let report: DiagnosticReport | null = null;
    let errorText = '';
    let copied = false;

    async function launch(): Promise<void> {
        state = 'running';
        errorText = '';
        copied = false;
        try {
            report = await runDiagnostics();
            state = 'done';
        } catch (e) {
            errorText = `Erreur: ${e}`;
            state = 'error';
        }
    }

    async function copyReport(): Promise<void> {
        if (!report) return;
        const text = JSON.stringify(report, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
            setTimeout(() => copied = false, 2000);
        } catch {
            // fallback : sélection dans un textarea invisible
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copied = true;
            setTimeout(() => copied = false, 2000);
        }
    }

    function statusIcon(status: DiagnosticCheck['status']): string {
        return status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
    }
</script>

<div class="diag">
    {#if state === 'idle'}
        <p class="diag__desc">
            Vérifie que tout fonctionne : interception fetch, IndexedDB, localStorage,
            modules Windy. À lancer depuis l'app Windy Android pour valider le support
            hors-ligne.
        </p>
        <button class="wbtn diag__btn" on:click={ launch }>
            🔍 Lancer le diagnostic
        </button>

    {:else if state === 'running'}
        <div class="diag__running">
            <span class="diag__spinner" />
            Diagnostic en cours…
        </div>

    {:else if state === 'done' && report}
        <div class="diag__summary">
            {report.summary.pass} ✅ / {report.summary.fail} ❌ / {report.summary.warn} ⚠️
        </div>

        {#each groupChecks(report.checks) as group}
            <div class="diag__group">
                <div class="diag__group-name">{ group.category }</div>
                {#each group.items as check}
                    <div class="diag__item diag__item--{ check.status }">
                        <span class="diag__icon">{ statusIcon(check.status) }</span>
                        <span class="diag__name">{ check.name }</span>
                        <span class="diag__detail">{ check.detail }</span>
                    </div>
                {/each}
            </div>
        {/each}

        <div class="diag__actions">
            <button class="wbtn wbtn--ghost" on:click={ launch }>🔄 Relancer</button>
            <button class="wbtn diag__copy" on:click={ copyReport }>
                { copied ? '✅ Copié !' : '📋 Copier le rapport' }
            </button>
        </div>

    {:else if state === 'error'}
        <div class="diag__error">{ errorText }</div>
        <button class="wbtn wbtn--ghost" on:click={ launch }>🔄 Réessayer</button>
    {/if}
</div>

<script lang="ts" context="module">
    // Regroupe les checks par catégorie
    function groupChecks(checks: DiagnosticCheck[]): { category: string; items: DiagnosticCheck[] }[] {
        const map = new Map<string, DiagnosticCheck[]>();
        for (const c of checks) {
            const existing = map.get(c.category);
            if (existing) {
                existing.push(c);
            } else {
                map.set(c.category, [c]);
            }
        }
        return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
    }
</script>

<style>
    .diag__desc {
        font-size: 0.8em;
        color: var(--color-text-secondary, #999);
        margin: 0 0 12px;
        line-height: 1.5;
    }
    .diag__btn {
        width: 100%;
    }
    .diag__running {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.85em;
        color: var(--color-text-secondary, #aaa);
        padding: 12px 0;
    }
    .diag__spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--color-border, rgba(255,255,255,0.2));
        border-top-color: var(--color-orange, #d49500);
        border-radius: 50%;
        animation: diag-spin 0.7s linear infinite;
    }
    @keyframes diag-spin {
        to { transform: rotate(360deg); }
    }

    .diag__summary {
        font-size: 1em;
        font-weight: 600;
        padding: 8px 0;
        margin-bottom: 4px;
    }
    .diag__group {
        margin-bottom: 10px;
    }
    .diag__group-name {
        font-size: 0.72em;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--color-orange, #d49500);
        margin-bottom: 4px;
    }
    .diag__item {
        display: grid;
        grid-template-columns: 18px 1fr;
        gap: 4px 6px;
        padding: 4px 0;
        font-size: 0.78em;
        line-height: 1.4;
    }
    .diag__icon {
        text-align: center;
    }
    .diag__name {
        font-weight: 600;
        color: var(--color-text-primary, #ddd);
    }
    .diag__detail {
        grid-column: 2;
        color: var(--color-text-secondary, #999);
        word-break: break-all;
    }
    .diag__item--fail .diag__name {
        color: #f44336;
    }
    .diag__item--warn .diag__name {
        color: #ff9800;
    }

    .diag__actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
    }
    .diag__copy {
        flex: 1;
    }
    .diag__error {
        color: #f44336;
        font-size: 0.85em;
        padding: 12px 0;
    }
</style>
