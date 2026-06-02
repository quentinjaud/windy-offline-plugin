# ROADMAP — windy-offline-plugin

> **Objectif produit :** mode hors-ligne pour Windy. Télécharger en ligne les prévisions
> d'une zone, les afficher sans connexion. Le plugin agit comme cache transparent des
> requêtes `node.windy.com/citytile` (voir [ARCHITECTURE.md](./ARCHITECTURE.md)).

**État au 2026-06-02 :** analyse PM + dev senior faite. Le code est en réalité en
**Phase 4-5** (4 composants fonctionnels, 17 tests verts), pas Phase 0 comme l'annonce
ARCHITECTURE.md. Aucun item de cette roadmap n'est encore implémenté.

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
| **A-1** | Spike P0-A : charger un plugin custom sur l'app Android + compteur `fetch` instrumenté dans [cacheProxy.ts](src/lib/cacheProxy.ts) + test pan/zoom avec overlay. Verdict : le `fetch` citytile est-il interceptable dans le webview Android ? Prérequis à lever d'abord : *peut-on charger son propre plugin sur Android ?* | 1–2 j | — | ⬜ TODO |
| **A-2** | Question overlay : une réponse citytile couvre-t-elle **tous** les overlays ou **un seul** ? (inspecter le JSON capté). Détermine si un pack vaut pour tous les overlays. | 0,25 j | — | ⬜ TODO |

**En parallèle (coût zéro) :** poser la question au forum/Discord dev Windy — « les plugins
externes tournent-ils dans le même webview que la carte sur Android, et peuvent-ils
intercepter le fetch citytile ? ». Le `mobileUI: 'small'` ([pluginConfig.ts:14](src/pluginConfig.ts#L14))
suggère fortement que oui.

## Phase B — Rendre l'offline réellement utilisable

> Le cœur de la promesse : carte qui s'affiche vraiment offline après fermeture/réouverture.

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P0-C** | Persister `activePackId` dans `localStorage` ([packState.ts](src/lib/packState.ts)) → l'offline survit au reload (le cas d'usage réel). | 0,5 j | — | ⬜ TODO |
| **P0-B** | Capturer-et-rejouer le **vrai** refTime/hours/step de Windy (via `@windy/store` ou la requête captée) au lieu de les deviner ([plugin.svelte:307](src/plugin.svelte#L307)). Sinon mismatch de clé → cache miss → carte grise. Décision possible : retirer refTime de la clé. | 1–2 j | A-2 | ⬜ TODO |
| **P0-D** | Piner le calendrier/timestamp Windy sur `pack.timeRange` à l'activation, pour que Windy demande les tiles cachées. | 1 j | P0-B | ⬜ TODO |

## Phase C — Bugs de correctness du cache

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P1-1+2** | Télécharger via `originalFetch` (bypass du proxy) → supprime la race `__uncaptured__` ([cacheProxy.ts:110](src/lib/cacheProxy.ts#L110)) **et** l'empoisonnement par tiles vides si un pack est actif. | 0,5 j | — | ⬜ TODO |
| **P1-3** | Aligner l'estimation de taille sur le `getZoomLevels` réel + corriger les params ignorés ([tileMath.ts:74](src/lib/tileMath.ts#L74)) + Ko/tile réaliste ([DownloadPanel.svelte:28](src/DownloadPanel.svelte#L28)). | 0,5 j | — | ⬜ TODO |
| **P1-4** | Paralléliser le download (concurrence 4–6) + retry/backoff sur 429/5xx ([downloadManager.ts:134](src/lib/downloadManager.ts#L134)). | 1 j | — | ⬜ TODO |

## Phase D — Robustesse / dette

| ID | Tâche | Est. | Dépend | Statut |
|----|-------|------|--------|--------|
| **P2-1** | Gestion quota IndexedDB (QuotaExceeded → message UI, éviction). | 1 j | — | ⬜ TODO |
| **P2-2** | Tests `cacheProxy` + `downloadManager` (les 2 zones non testées, les plus risquées). | 1 j | P1-1+2 | ⬜ TODO |
| **P2-3** | Perf `getCacheSize` (total courant vs `getAll`) + borner/retirer la capture passive `__uncaptured__` + MAJ [ARCHITECTURE.md](./ARCHITECTURE.md) (phase réelle). | 0,5 j | — | ⬜ TODO |

---

## Chemin critique

**A-1 → P0-C → P0-B → P0-D** (~3,5–5,5 j) = la promesse « affichage offline après reload ».
Total roadmap hors gate : ~6–7 j.

## Détail des constats

L'analyse complète (verbatim des risques P0/P1/P2) est aussi archivée dans la mémoire
projet. Le résumé des risques par tâche est repris dans les tables ci-dessus avec les
références fichier:ligne.
