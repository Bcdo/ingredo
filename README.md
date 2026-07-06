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
- SignalR (later)

## Repository Layout

```
ingredo/
├── backend/     # ASP.NET Core (.NET 9) REST API — CQRS, EF Core, Scalar/OpenAPI
├── frontend/    # Expo / React Native app — Expo Router, NativeWind, TypeScript
├── design/      # Design notes and assets
├── docs/        # Project documentation
└── PROJECT_PLAN.md
```

The backend and frontend are independent packages, each with its own tooling.
Run them in **two separate terminals** during development.

## Prerequisites

| Tool | Version | Used by | Notes |
|------|---------|---------|-------|
| [.NET SDK](https://dotnet.microsoft.com/download) | 9.0+ | backend | `dotnet --version` |
| [Node.js](https://nodejs.org) | 18+ (LTS) | frontend | ships with `npm` / `npx` |
| [Expo Go](https://expo.dev/go) app | latest | frontend | on a physical iOS/Android device |
| iOS Simulator / Android Emulator | — | frontend | optional, for on-desktop testing |
| [Docker](https://www.docker.com/) + Compose | latest | backend | optional, for Postgres/Redis stack |

## Getting Started

### 1. Backend (REST API)

```bash
cd backend
dotnet restore          # restore NuGet packages (first run only)
dotnet run              # start the API on http://localhost:5193
```

To run with HTTPS as well:

```bash
dotnet run --launch-profile https   # https://localhost:7109 + http://localhost:5193
```

For an auto-reloading dev loop:

```bash
dotnet watch run
```

Once running, the following endpoints are available in Development:

- **API root:** `http://localhost:5193`
- **API reference (Scalar UI):** `http://localhost:5193/scalar` — interactive API docs
- **OpenAPI document:** `http://localhost:5193/openapi/v1.json`
- **Health check:** `http://localhost:5193/health`

**Database:** defaults to **SQLite** (`DatabaseProvider` in `backend/appsettings.json`).
The database file (`RestApi.db`) is created automatically on startup via
`EnsureCreated()` — no manual migration step is needed to get going. Switch the
provider to `PostgreSQL` or `SqlServer` and set the matching connection string
in `appsettings.json` to target another database.

**Logs** are written to the console and to `backend/logs/app.log` (Serilog).

### 2. Frontend (Expo app)

```bash
cd frontend
npm install             # install dependencies (first run only)
npm start               # start the Expo dev server (Metro)
```

Then choose a target:

- Scan the QR code in the terminal with the **Expo Go** app on your phone
- Press `i` for the iOS Simulator or `a` for the Android Emulator
- Or launch a specific platform directly:

```bash
npm run ios             # open in iOS Simulator
npm run android         # open in Android Emulator
npm run web             # open in the browser
```

## Running the Backend with Docker (optional)

A production-like stack (API + PostgreSQL + Redis + nginx + pgAdmin) is defined
in `backend/docker-compose.dev.yml`:

```bash
cd backend
docker compose -f docker-compose.dev.yml up --build
```

Services exposed:

- API — `http://localhost:8080`
- PostgreSQL — `localhost:5432` (db `restapi_dev`, user `postgres`, password `dev_password_123`)
- pgAdmin — `http://localhost:5050` (login `dev@restapi.local` / `admin123`)
- nginx — `http://localhost:80`
- Redis — `localhost:6379`

## Useful Commands

### Backend
```bash
dotnet run                          # run the API
dotnet watch run                    # run with hot reload
dotnet build                        # compile
dotnet ef migrations add <Name>     # create a new EF Core migration
dotnet ef database update           # apply migrations
```

### Frontend
```bash
npm start        # start Metro / Expo dev server
npm run lint     # ESLint + Prettier check
npm run format   # auto-fix lint + formatting
npm test         # run unit tests (Jest)
npx expo prebuild  # generate native projects
```

## Notes for Developers

- **Two servers, two terminals.** The Expo app and the .NET API run as separate
  processes — start each in its own terminal.
- **CORS** is wide open (`AllowAnyOrigin`) in Development, so the app can call the
  API from a device or simulator without extra setup.
- When pointing the app at the API from a **physical device**, use your machine's
  LAN IP (not `localhost`) — `localhost` on the phone refers to the phone itself.
- Secrets and `.env` files are git-ignored. Do not commit connection strings or keys.
- See `backend/README.md`, `backend/CONTRIBUTING.md`, and `backend/WARP.md` for
  deeper backend architecture and conventions.
