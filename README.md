<div align="center">

<img src="https://portfolio-puce-two-79.vercel.app/logos/logo-garden.png" alt="Logo Garden" width="120">

# Garden

**Un « Transfermarkt » pour une ligue amateur de League of Legends — l'écosystème complet.**

Valeurs des joueurs · marché des transferts · contrats · statistiques · classements · draft en temps réel · back-office

[![Démo](https://img.shields.io/badge/🌐_Démo_en_ligne-thegarden--tm--web.vercel.app-0E6F66?style=for-the-badge)](https://thegarden-tm-web.vercel.app)

![Next.js](https://img.shields.io/badge/Next.js_15-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![tRPC](https://img.shields.io/badge/tRPC_11-2596BE?logo=trpc&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis_·_Upstash-FF4438?logo=redis&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?logo=socketdotio&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_4-06B6D4?logo=tailwindcss&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?logo=turborepo&logoColor=white)

</div>

Garden traite une ligue amateur comme une vraie compétition professionnelle. C'est le cœur d'un écosystème de trois briques qui partagent le même vocabulaire et le même rating :

- 🐍 [**replay-service**](https://github.com/Amirormir/replay-service) — microservice Python qui parse les replays `.rofl` et injecte les stats de match automatiquement ;
- 🤖 [**bot-discord**](https://github.com/Amirormir/bot-discord) — matchmaking 5v5 sur Discord avec classement Glicko-2, relié à Garden par une API d'intégration.

## ✨ Fonctionnalités

**Zone publique** — homepage, transfermarket (valeurs des joueurs, comparaison, fiches détaillées), league (classement, matchs, stats, rulebook, historique), draft, rank, news et customs.

**Zone authentifiée** (Auth.js · Discord) — gestion d'équipe de bout en bout : roster, budget, contrats, transferts, paris, notifications, profil.

**Back-office admin** — CRUD complet sur joueurs, équipes, matchs, champions, news, paris, contrats et utilisateurs ; import `.rofl` en un clic depuis le détail d'un match custom (les 10 lignes de stats sont pré-remplies, puis écrites en une seule transaction Prisma).

**Draft en temps réel** — serveur Socket.io dédié : timer, état pick/ban, persistance Redis.

## 🏗️ Architecture

Monorepo **Turborepo + pnpm** :

```
thegardenTM/
├── apps/
│   ├── web/            # Site Next.js 15 (public + espace équipe + admin)
│   └── realtime/       # Serveur Socket.io du draft (timer, pick/ban, Redis)
├── packages/
│   ├── db/             # Prisma (schéma, client, seed)
│   ├── draft-engine/   # Logique de draft réutilisable
│   └── ...             # Types & configs partagés
└── docs/
```

**Deux bases, deux usages** : PostgreSQL (Prisma) pour la ligue officielle ; MongoDB pour les customs — saison 2, leaderboard avec tiers, ELO, MVP et ACE. Chaque monde a son modèle de données.

**Intégrations** : Auth.js (Discord), Riot API (données joueurs), Cloudinary (médias), Redis Upstash (temps réel), tâches cron.

## 📸 Aperçu

<!-- Si le projet Vercel du portfolio est renommé un jour, copier les captures dans docs/screens/ et mettre à jour ces URLs. -->

| Homepage — les gros noms du moment | Fiche joueur — valeur & stats |
|---|---|
| ![Homepage de Garden](https://portfolio-puce-two-79.vercel.app/projects/garden1.png) | ![Fiche joueur](https://portfolio-puce-two-79.vercel.app/projects/garden2.png) |

## 🚀 Lancer le projet

**Prérequis** : `git`, Node.js ≥ 22.13, pnpm ≥ 10, un PostgreSQL et un MongoDB accessibles. Python 3.11+ uniquement pour l'import replay.

```bash
git clone https://github.com/Amirormir/thegardenTM.git
cd thegardenTM
pnpm install
```

Copier `.env.example` vers `.env.local` (racine) et `apps/web/.env.local`, puis renseigner :

| Fichier | Variables |
|---|---|
| `/.env.local` | `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `RIOT_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `CLOUDINARY_URL` |
| `/apps/web/.env.local` | `MONGO_URL`, `REPLAY_SERVICE_URL` (par défaut `http://127.0.0.1:8000`) |

```bash
# Base vide ? Génération + schéma + seed :
pnpm db:generate && pnpm db:push && pnpm db:seed

# Démarrer (web sur http://localhost:3004)
pnpm dev
```

Import `.rofl` (optionnel) : lancer [replay-service](https://github.com/Amirormir/replay-service) sur le port 8000 (`lol-stats serve --port 8000`). Le service est **découplé par design** : sans lui, le site tourne — on perd juste l'import automatique des stats.

Autres commandes : `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm db:migrate` · `pnpm db:studio`. Notes internes et checklist de dépannage : [`docs/DEV.md`](docs/DEV.md).

## 👤 Auteur

**Amir Iradi** — Développeur full-stack, Montpellier
[Portfolio](https://portfolio-puce-two-79.vercel.app) · [LinkedIn](https://www.linkedin.com/in/amir-iradi-93343a296/) · [GitHub](https://github.com/Amirormir)
