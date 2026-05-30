# wind-offline-plugin

Plugin Windy pour télécharger et consulter des données météo hors-ligne.

## Principe

Le plugin intercepte les requêtes `citytile` de Windy via un monkey-patch `fetch()` et les stocke dans IndexedDB. En mode offline, les requêtes sont servies depuis le cache local — le rendu Windy reste inchangé.

## Développement

```bash
npm install
npm start        # Dev server localhost:9999
npm run build    # Build production
npm test         # Vitest
```

## Architecture

Voir [`ARCHITECTURE.md`](./ARCHITECTURE.md).
