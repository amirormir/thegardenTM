# Notes de dev internes

> Mémo perso pour reprendre le projet sur une autre machine. Le README public reste la référence pour un premier lancement.

## Repartir vite sur un autre PC

Le plus simple : recopier les fichiers déjà configurés depuis la machine actuelle —

- `thegardenTM/.env.local`
- `thegardenTM/apps/web/.env.local`

⚠️ Si tu réutilises les bases déjà en ligne, **ne lance pas de seed par erreur**.

## Ordre de lancement recommandé

Terminal 1 (Windows) :

```powershell
cd replay-service
.\.venv\Scripts\activate
lol-stats serve --port 8000
```

Terminal 2 :

```bash
cd thegardenTM
pnpm dev
```

Sous Linux/macOS, l'activation du venv devient `source .venv/bin/activate`.

## Installation du replay-service (première fois)

```bash
cd replay-service
python -m venv .venv
# Windows : .\.venv\Scripts\activate — Linux/macOS : source .venv/bin/activate
pip install -e ".[dev]"
lol-stats serve --port 8000
```

Quand le service tourne : l'API répond sur `http://127.0.0.1:8000`, et le site peut importer un `.rofl` depuis **Custom > Saison 2 > détail d'un match**.

## Ce qui a été branché

- branding **Garden**
- section **Custom** : Saison 1 figée localement, Saison 2 connectée à Mongo
- leaderboard customs avec tiers, ELO, `NR`, `MVP`, `ACE`
- historique custom cliquable + page détail de match
- import `.rofl` via le microservice Python

## Vérification rapide si ça ne démarre pas

1. Vérifier Node et pnpm (`node -v`, `pnpm -v`)
2. Vérifier `/.env.local`
3. Vérifier `/apps/web/.env.local`
4. Vérifier que PostgreSQL répond
5. Vérifier que Mongo répond
6. Vérifier que `lol-stats serve --port 8000` tourne si tu testes les replays
7. Lancer `pnpm --filter @nexus/web typecheck`
