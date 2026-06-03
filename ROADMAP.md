# ROADMAP — windy-offline-plugin

> **Objectif produit :** mode hors-ligne pour Windy. Télécharger en ligne les prévisions
> d'une zone, les afficher sans connexion. Le plugin agit comme cache transparent des
> requêtes `node.windy.com/citytile` (voir [ARCHITECTURE.md](./ARCHITECTURE.md)).

**État au 2026-06-02 (resync sur v0.3.1) :** le code est en **Phase 4-5** (4 composants
fonctionnels, 24 tests unitaires verts + infra e2e Playwright), pas Phase 0 comme l'annonce
ARCHITECTURE.md. Le refactor v0.3.1 (registre des modèles dans [models.ts](src/lib/models.ts),
helpers en lib, styles DRY) a **déjà résolu P1-1+2 et P1-3** (voir ci-dessous). Les `file:line`
de cette roadmap sont alignés sur v0.3.1.

---

## Comment utiliser cette roadmap (agents & humains)

Ce fichier est la **source de vérité de l'état du chantier**. Le `git log` est le
**journal de ce qui a été fait**. Les deux se lisent ensemble.

### Boucle de travail pour un agent

1. **Choisir une tâche** `TODO` en respectant les dépendances (colonne *Dépend*) et le
   gate (voir ci-dessous). Privilégier les tâches sans dépendance ouverte.
2. **La marquer `🚧 WIP`** dans ce fichier (colonne *Statut*), en ajoutant `@nom-agent`
   et la date. Commiter ce changement seul : ça signale aux autres agents que la tâche
   est prise (pas de lock temps réel — ROADMAP.md + git *sont* le mécanisme de coordination).
3. **Implémenter** en TDD, par petits pas, commits fréquents. Chaque commit référence
   l'ID de tâche (voir convention plus bas).
4. **Marquer `✅ DONE`** dans ce fichier quand la tâche est terminée *et vérifiée*
   (`npm test` vert), dans le même commit que la dernière modif ou juste après.
5. Si bloqué : marquer `⛔ BLOCKED` + une ligne expliquant le blocage et l'ID de la
   tâche/question dont ça dépend.

### Le GATE (règle de séquençage)

La **Phase A** est un verrou de validation. Tant que **A-1** n'est pas tranché, on ne
revendique pas le support **Android** et on n'investit pas dans le polish Android.
**Mais** : le plugin marche déjà sur desktop windy.com, et la plupart des correctifs
(Phase B/C/D) l'améliorent *aussi* sur desktop — ils peuvent donc avancer en parallèle
de A. Ne bloque pas tout le chantier sur le verrou Android.

### Légende statut

| Symbole | Sens |
|---------|------|
| `⬜ TODO` | À faire |
| `🚧 WIP` | En cours — `@agent` + date |
| `✅ DONE` | Terminé et vérifié (tests verts) |
| `⛔ BLOCKED` | Bloqué — préciser par quoi |

---

## Journalisation via les commits

Le journal du chantier **est** l'historique git. Pour qu'il soit reconstructible par
tâche, **chaque commit qui fait avancer une tâche référence son ID** entre crochets.

### Format

```
<type>(<zone>): <description en français> [<ID-TÂCHE>]
```

- **type** : `feat` | `fix` | `refactor` | `test` | `docs` | `chore`
- **zone** (optionnel) : `cacheProxy` | `downloadManager` | `storage` | `packState` | `ui` | `tileMath`…
- **description** : impératif, **en français** (convention projet, cf. [AGENTS.md](./AGENTS.md))
- **ID-TÂCHE** : `A-1`, `P0-C`, `P1-3`… tel que listé dans les tables ci-dessous

### Exemples

```
feat(packState): persiste activePackId dans localStorage [P0-C]
test(packState): couvre la restauration du pack actif au reload [P0-C]
fix(downloadManager): télécharge via originalFetch pour éviter la race __uncaptured__ [P1-1+2]
docs(roadmap): marque P0-C terminé [P0-C]
```

### Conséquence pratique

Reconstruire le journal d'une tâche :

```bash
git log --oneline --grep="\[P0-C\]"
```

Règles :
- **Un commit = un pas cohérent.** Pas de commit fourre-tout multi-tâches.
- Ne **jamais** marquer `✅ DONE` sans `npm test` vert (cf. la discipline « evidence before assertions »).
- Mettre à jour la colonne *Statut* fait partie de la tâche, pas un à-côté.

---

## Phase A — GATE : valider l'approche

> Tant que A-1 n'est pas tranché : pas de revendication Android, pas de polish Android.

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **A-1** | Spike P0-A : charger un plugin custom sur l'app Android + compteur `fetch` instrumenté dans [cacheProxy.ts](src/lib/cacheProxy.ts) + test pan/zoom avec overlay. Verdict : le `fetch` citytile est-il interceptable dans le webview Android ? Prérequis à lever d'abord : *peut-on charger son propre plugin sur Android ?* | 1–2 j | — | 🚧 WIP @claude 2026-06-03 — sonde multi-transport (fetch / XHR / `transformRequest`) + énumération du realm Windy. À lancer sur device, puis trancher. |
| **A-2** | Question overlay : une réponse citytile couvre-t-elle **tous** les overlays ou **un seul** ? (inspecter le JSON capté). Détermine si un pack vaut pour tous les overlays. | 0,25 j | — | ⬜ TODO |

> ⚠️ **Attention :** le test e2e [tests/e2e/mobile.test.ts](tests/e2e/mobile.test.ts) **ne couvre pas A-1**.
> Il émule un iPhone dans un navigateur Playwright contre `windy.com/developer-mode` (vérifie le z-order
> du panneau en *viewport mobile web*) — il ne teste **pas** l'interception `fetch` dans le **webview natif
> Android**. L'infra Playwright + chargement dev-mode reste un bon point de départ pour A-1.

**En parallèle (coût zéro) :** poser la question au forum/Discord dev Windy — « les plugins
externes tournent-ils dans le même webview que la carte sur Android, et peuvent-ils
intercepter le fetch citytile ? ». Le `mobileUI: 'fullscreen'` ([pluginConfig.ts:12](src/pluginConfig.ts#L12))
suggère fortement que oui.

## Phase B — Rendre l'offline réellement utilisable

> Le cœur de la promesse : carte qui s'affiche vraiment offline après fermeture/réouverture.

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P0-C** | Persister `activePackId` dans `localStorage` ([packState.ts](src/lib/packState.ts)) → l'offline survit au reload (le cas d'usage réel). | 0,5 j | — | ✅ DONE — hydratation à l'init + `setItem`/`removeItem`, fallback si localStorage indispo. Tests [packState.test.ts](tests/packState.test.ts) (reload, désactivation, défaut, robustesse). |
| **P0-B** | Capturer-et-rejouer le **vrai** refTime/hours/step de Windy (via `@windy/store` ou la requête captée) au lieu de les deviner (`getRefTime` [downloadManager.ts:147](src/lib/downloadManager.ts#L147), désormais testable car prend `now` en paramètre). Sinon mismatch de clé → cache miss → carte grise. Décision possible : retirer refTime de la clé. | 1–2 j | A-2 | ⬜ TODO |
| **P0-D** | Piner le calendrier/timestamp Windy sur `pack.timeRange` à l'activation, pour que Windy demande les tiles cachées. | 1 j | P0-B | ⬜ TODO |

## Phase C — Bugs de correctness du cache

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P1-1+2** | Télécharger via `originalFetch` (bypass du proxy) → supprime la race `__uncaptured__` **et** l'empoisonnement par tiles vides si un pack est actif. | 0,5 j | — | ✅ DONE (v0.3.1) — `getOriginalFetch()` [cacheProxy.ts:29](src/lib/cacheProxy.ts#L29) utilisé par [downloadManager.ts:82](src/lib/downloadManager.ts#L82) |
| **P1-3** | Aligner l'estimation de taille sur le `getZoomLevels` réel + retirer les params ignorés de `getZoomLevels`. | 0,5 j | — | ✅ DONE (v0.3.1) — estime via `getZoomLevels(bbox).filter(z<=maxZoom)` [DownloadPanel.svelte:26](src/DownloadPanel.svelte#L26), identique au download [downloadManager.ts:40](src/lib/downloadManager.ts#L40) ; params morts retirés [tileMath.ts:74](src/lib/tileMath.ts#L74). *Résidu mineur optionnel : l'heuristique 5 Ko/tile [DownloadPanel.svelte:30](src/DownloadPanel.svelte#L30) reste approximative.* |
| **P1-4** | Paralléliser le download (concurrence 4–6) + retry/backoff sur 429/5xx. | 1 j | — | ✅ DONE — pool de workers borné (`concurrency`, défaut 4) + `fetchWithRetry` (backoff exponentiel sur 429/5xx/réseau, pas de retry sur 4xx permanent) ; délai fixe supprimé (débit régulé par concurrence + backoff). Tests [downloadManager.test.ts](tests/downloadManager.test.ts). ⓘ Concurrence/rate-limit par défaut à revalider contre la vraie API (lié à A-1). |

## Phase D — Robustesse / dette

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P2-1** | Gestion quota IndexedDB (QuotaExceeded → message UI). | 1 j | — | ✅ DONE — util `isQuotaExceeded`, download stoppé proprement + flag `quotaExceeded`, message UI clair dans [plugin.svelte](src/plugin.svelte) ; cache passif déjà borné (P2-3). Tests [downloadManager.quota.test.ts](tests/downloadManager.quota.test.ts) + [storage.test.ts](tests/storage.test.ts). |
| **P2-2** | Tests unitaires `cacheProxy` + `downloadManager`. | 1 j | — | ✅ DONE — [downloadManager.test.ts](tests/downloadManager.test.ts) (via P1-4) + [cacheProxy.test.ts](tests/cacheProxy.test.ts) (pass-through, capture online, token/params, service offline hit/miss, ref-counting install/uninstall). |
| **P2-3** | Perf `getCacheSize` + borner la capture passive `__uncaptured__` + MAJ [ARCHITECTURE.md](./ARCHITECTURE.md). | 0,5 j | — | ✅ DONE — `getCacheSize` en curseur (mémoire O(1)), `putPassiveEntry` borne `__uncaptured__` (FIFO via index `createdAt`, `MAX_PASSIVE_ENTRIES`), `openDB` protégé contre ouvertures concurrentes, ARCHITECTURE.md resyncé. Tests [storage.test.ts](tests/storage.test.ts). |

---

## Chemin critique

**A-1 → P0-C → P0-B → P0-D** (~3,5–5,5 j) = la promesse « affichage offline après reload ».
Restant hors gate : ~5 j (P1-1+2 et P1-3 déjà faits par v0.3.1).

## Détail des constats

L'analyse complète (verbatim des risques P0/P1/P2) est aussi archivée dans la mémoire
projet. Le résumé des risques par tâche est repris dans les tables ci-dessus avec les
références fichier:ligne.
