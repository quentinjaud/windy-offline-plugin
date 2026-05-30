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
4. **UI** — Svelte, `desktopUI: rhpane`, `mobileUI: small`

URL de cache = URL normalisée (strip params volatils).

## Conventions

- Pas de wrapper IndexedDB (`idb`), tout en vanilla pour zéro dépendance
- Tests avec Vitest
- Commit messages en français
- Pas de config.yaml à modifier (plugin auto-contenu)
