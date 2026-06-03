# AGENTS.md — windy-offline-plugin

## Contexte

Plugin Windy (TypeScript + Svelte + Rollup) pour télécharger des couches météo et les consulter hors-ligne. Le plugin tourne **dans** windy.com, pas en standalone.

Le rendu météo reste assuré par Windy. Le plugin agit comme un cache local transparent en interceptant les requêtes `fetch()` vers `node.windy.com/citytile`.

## Découvertes Phase 0

- **Données météo** : `GET https://node.windy.com/citytile/v1.0/{model}/{z}/{x}/{y}` → JSON
  - `{forecast: {"lat/lon": [v1,...,vN]}, reftime, hours}`
  - Transport : `fetch()` (pas XHR, pas WebSocket)
  - Auth : JWT dans l'URL (`token2=...`), pas de header custom
- **Paramètres volatils** dans l'URL : `token2`, `uid`, `poc`, `pr`, `sc` — changent entre sessions mais n'affectent pas le contenu
- **Fond de carte** (`tiles.windy.com`) non concerné — géré nativement par Windy

## Architecture

4 composants :
1. **CacheProxy** — monkey-patch `window.fetch`, intercepte `citytile` → IndexedDB
2. **StorageEngine** — IndexedDB vanilla, stores `CacheEntry` + `Pack`
3. **DownloadManager** — bbox → tiles Z/X/Y → URLs citytile → téléchargement
4. **UI** — Svelte, `desktopUI: rhpane`, `mobileUI: fullscreen`

URL de cache = URL normalisée (strip params volatils).

## Conventions

- Pas de wrapper IndexedDB (`idb`), tout en vanilla pour zéro dépendance
- Tests avec Vitest
- Commit messages en français
- Pas de config.yaml à modifier (plugin auto-contenu)

## Publication / versioning

Pour **republier le plugin**, il faut bumper le numéro de version puis pousser un tag.

1. **Bumper la version dans les 3 fichiers, en cohérence** (toujours les trois ensemble) :
   - `package.json` → `"version"`
   - `plugin.json` → `"version"`
   - `src/pluginConfig.ts` → `version`
   Commit : `chore: bump version X → Y (...)`.
2. **Déclencher la publication** en poussant un tag `v*.*.*` :
   ```bash
   git tag v0.4.2 && git push origin v0.4.2
   ```
   Le workflow [.github/workflows/publish-plugin.yml](.github/workflows/publish-plugin.yml)
   (trigger : push de tag `v*.*.*` ou *workflow_dispatch*) build le plugin et l'upload vers
   `node.windy.com/plugins/v1.0/upload` avec le secret `WINDY_API_KEY`.

> ⚠️ Sans bump de version, l'upload republie la même version — pense à incrémenter avant de tagger.

## Travail en cours & coopération multi-agents

- **[ROADMAP.md](./ROADMAP.md) est la source de vérité de l'état du chantier.** Avant de
  commencer, lis-le : choisis une tâche `TODO` (en respectant les dépendances et le GATE
  Phase A), marque-la `🚧 WIP @ton-nom + date`, puis implémente.
- **Journalisation via commits :** chaque commit qui fait avancer une tâche référence son
  ID entre crochets — `<type>(<zone>): <description fr> [<ID>]`, ex.
  `feat(packState): persiste activePackId [P0-C]`. Le `git log` devient ainsi le journal
  par tâche (`git log --grep="\[P0-C\]"`).
- **Ne marque `✅ DONE`** dans ROADMAP.md qu'avec `npm test` vert.
