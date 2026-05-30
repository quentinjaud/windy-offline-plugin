# windy-offline-plugin — Plan d'architecture

> **Status:** Validé — Phase 0 terminée
> **Date:** 2026-05-30

## Objectif

Plugin Windy permettant de télécharger des couches de données météo pour une zone, un modèle et une fenêtre temporelle, puis de les consulter sans connexion Internet. Le rendu reste assuré par Windy — le plugin agit comme un cache local transparent.

## Résultat Phase 0 — Investigation réseau

**Source des données météo :** `node.windy.com/citytile/v1.0/`

```
GET https://node.windy.com/citytile/v1.0/{model}/{z}/{x}/{y}
  ?refTime=2026-05-30T15:00:00Z
  &hours=68
  &step=1
  &token2=<JWT premium>
  &...
```

- **Format :** JSON. Chaque tile contient `{forecast: {"lat/lon": [v1,...,vN]}, reftime, hours}`
- **Transport :** `fetch()` (confirmé DevTools)
- **Token :** JWT dans l'URL, contient `subscriptionTiers: ["premium"]`, pas de header personnalisé
- Les valeurs sont des scalaires (Kelvin pour température, paires [U,V] pour vent, etc.) — dépend de l'overlay

**Approche retenue : interception fetch.** Pas de rendu canvas custom, pas de fallback complexe. Le monkey-patch `fetch()` suffit puisque toutes les tiles citytile passent par là.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Windy.com                              │
│                                                           │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐   │
│  │   Windy  │──▶│ CacheProxy   │──▶│  IndexedDB      │   │
│  │  render  │   │ (fetch patch)│   │  CacheEntry     │   │
│  │  engine  │   │              │   │  Pack            │   │
│  └──────────┘   └──────┬───────┘   └────────────────┘   │
│                        │                                  │
│                        │ (si cache miss)                  │
│                        ▼                                  │
│              ┌─────────────────┐                          │
│              │ node.windy.com  │                          │
│              └─────────────────┘                          │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │               Windy Plugin (UI)                     │ │
│  │                                                     │ │
│  │  Mode Download              Mode Offline            │ │
│  │  - Sélecteur modèle        - Liste des packs       │ │
│  │  - Sélecteur overlay       - Activation/Désactiv.  │ │
│  │  - Rectangle zone          - Infos (taille, dates) │ │
│  │  - Plage temporelle        - Suppression           │ │
│  │  - Progression             - Mode hors-ligne       │ │
│  │  - DownloadManager                                │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Composants

#### CacheProxy
Monkey-patch de `window.fetch`, installé `onMount`, retiré `onDestroy`.

**Filtre :** toute URL contenant `node.windy.com/citytile`

**Mode Online (cache miss) :**
1. Appel fetch original → réponse
2. Clone la réponse avec `response.clone().json()`
3. Stocke dans IndexedDB (clé = URL normalisée sans token)
4. Retourne la réponse originale (transparent pour Windy)

**Mode Offline (pack actif) :**
1. Cherche dans IndexedDB (clé = URL sans token)
2. Si trouvé → reconstruit un objet Response avec le JSON stocké
3. Si pas trouvé → laisse passer vers le réseau (ou bloque si vraiment offline)

#### StorageEngine (IndexedDB)

Deux stores :

```
CacheEntry {
  url: string (clé primaire — URL sans token2, uid, poc)
  json: object (le JSON citytile)
  size: number (octets approximatifs)
  createdAt: number (timestamp)
  packId: string (référence au pack propriétaire)
}

Pack {
  id: string (clé primaire, auto-générée)
  name: string
  model: string (arome, gfs, ecmwf…)
  bbox: {n, s, e, w}
  zoomLevels: number[]
  timeRange: {start: ISO, end: ISO}
  tileCount: number
  totalSize: number
  createdAt: ISO
}
```

**Détail important :** l'URL est normalisée avant stockage. Les params `token2`, `uid`, `poc`, `pr`, `sc` varient entre sessions mais n'affectent pas le contenu. La clé = `citytile/v1.0/{model}/{z}/{x}/{y}?refTime=...&hours=...&step=...`

#### DownloadManager

1. Calcule toutes les URLs citytile pour la zone : bbox → indices Z/X/Y, modèle, refTime, plage horaire
2. Fetch séquentiel (respecter le rate limit 3 req/s du forum Windy, à confirmer)
3. Progression trackée
4. Création d'un Pack dans IndexedDB une fois terminé

**Calcul des tiles :** formules Web Mercator standard (degrés → indices Z/X/Y).

#### UI (plugin.svelte)

- `desktopUI: 'rhpane'`, `mobileUI: 'small'`
- Mode Download : sélecteurs, rectangle, progression
- Mode Offline : liste des packs, toggle activation
- Rectangle via Leaflet `L.rectangle` ou plugin draw
- "Zone écran" = `map.getBounds()`

---

## Stack technique

| Élément | Choix |
|---------|-------|
| Build | Rollup (template Windy) |
| UI | Svelte + TypeScript |
| Stockage | IndexedDB (vanilla — pas de wrapper, pas de dépendance) |
| Carto | `@windy/map` (Leaflet GL) |
| Store Windy | `@windy/store` pour product/timestamp/overlay |
| JWT token | Extrait de l'URL citytile capturée par le proxy |
| Tests | Vitest |

---

## Phases d'implémentation

### Phase 0 — Setup repo ✅
- [x] Création repo `quentinjaud/windy-offline-plugin`
- [x] Investigation réseau : citytile JSON via fetch confirmé
- [x] Architecture validée

### Phase 1 — Setup + StorageEngine
- [ ] Cloner le template Windy, configurer le repo
- [ ] AGENTS.md, TODO.md
- [ ] IndexedDB : CacheEntry + Pack stores
- [ ] URL normalizer (strip params volatils)

### Phase 2 — CacheProxy
- [ ] Monkey-patch fetch (online capture)
- [ ] Mode offline : servir depuis IndexedDB
- [ ] Reconstruction de Response à partir du JSON stocké

### Phase 3 — DownloadManager
- [ ] Calcul bbox → tiles Z/X/Y
- [ ] Construction URLs citytile
- [ ] Boucle de téléchargement avec rate limiting + progression

### Phase 4 — UI
- [ ] Layout Svelte : deux modes
- [ ] Sélecteurs modèle/overlay/plage temporelle
- [ ] Rectangle + "zone écran"
- [ ] Barre progression, estimation taille
- [ ] Liste packs, activation/désactivation

### Phase 5 — Polish
- [ ] Gestion edge cases (quota IndexedDB, modèle non dispo, token expiré)
- [ ] Tests
- [ ] Publication
