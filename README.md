# Ingredo

Ingredo is a mobile-first application that combines:

- Meal planning
- Ingredient-based shopping
- Recipe management
- Shared household shopping

The goal is to make weekly meal planning and grocery shopping effortless.

## Core Philosophy

Ingredo is not a task manager.

Shopping items are not tasks.

Instead of checkboxes, purchased items move into a Recently Purchased section where they can be restored or reused.

## Primary Features

- Weekly meal planning
- Recipe management
- Shopping lists generated from recipes
- Shopping lists generated from meal plans
- Manual shopping items
- Recently Purchased history
- Household sharing
- Offline-first support

## Tech Stack

### Frontend
- Expo
- TypeScript
- Expo Router
- NativeWind
- SQLite
- Secure Store

### Backend
- ASP.NET Core
- Entity Framework Core
- PostgreSQL
- JWT Authentication
- SignalR

## Repository Layout

```
ingredo/
├── backend/     # ASP.NET Core (.NET 10) REST API — EF Core, PostgreSQL, SignalR
├── frontend/    # Expo / React Native app — Expo Router, NativeWind, TypeScript
├── design/      # Design notes and assets
└── docs/        # Project documentation (specs, plans, TESTING.md)
```

## Getting Started

**Backend** — the whole stack runs in Docker:

```bash
cd backend
cp .env.example .env   # fill in POSTGRES_PASSWORD and JWT_KEY (first run only)
docker compose up --build
```

API on `http://localhost:8080` (health: `/health`; Scalar API reference and
OpenAPI are exposed in Development). See `backend/README.md` for migrations,
tests, and production operations (deploy, tunnel, backups).

**Frontend** — Expo dev server:

```bash
cd frontend
npm install
npm start
```

Scan the QR with Expo Go, or press `a` for the Android emulator. On a
physical device, point the in-app Server field (Settings → Account, dev
builds) at `http://<your-LAN-ip>:8080`.

## Useful Commands

```bash
# backend (from backend/)
docker compose up --build     # dev stack (API + Postgres)
dotnet test                   # integration tests (needs Docker running)

# frontend (from frontend/)
npm test                      # Jest suites
npm run lint                  # ESLint + Prettier check
npx tsc --noEmit              # typecheck
npm run build:beta            # EAS build: Android APK (profile: preview)
npm run publish:beta          # EAS Update: publish JS to the beta branch
```

## Production

The beta runs on a home machine behind a Cloudflare Tunnel
(`https://api.kodesmien.no`) — full runbook in `backend/README.md` under
**Production**. The manual verification pass lives in `docs/TESTING.md`
under **Deployment**.
