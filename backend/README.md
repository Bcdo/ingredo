# Ingredo backend

ASP.NET Core (.NET 10) API for Ingredo. Solution file: `Ingredo.slnx` (the
SDK's current solution format; `dotnet build`/`dotnet test` work as usual).

## Run locally

```bash
cp .env.example .env          # defaults work for local dev; if you change the
                              # password, change it in appsettings.Development.json
                              # too (and wipe the pgdata volume)
docker compose up -d postgres # database only…
dotnet run --project Ingredo.Api
```

- API base: http://localhost:5241 (from launchSettings; `--urls` overrides)
- API docs (Development): http://localhost:5241/scalar
- Health: http://localhost:5241/health

Or run the whole stack in Docker:

```bash
docker compose up --build     # api on http://localhost:8080
```

## Auth

- `POST /api/v1/auth/register` `{ email, password, displayName }` → tokens + user (auto-login)
- `POST /api/v1/auth/login` / `refresh` / `logout`, `GET /api/v1/auth/me`
- Access token: JWT, 15 min. Refresh token: 30 days, rotated on every refresh;
  reusing a rotated token revokes its whole family.
- All `/api/v1/recipes` endpoints require `Authorization: Bearer <accessToken>`;
  recipes belong to the caller's (personal, for now) household.
- Local config: `Jwt:Key` comes from `appsettings.Development.json` for
  `dotnet run` and from `JWT_KEY` in `.env` for docker compose. If you add
  `HouseholdId` (or any schema change) to a running compose db that already
  holds recipes, `docker compose down -v` once to reset — dev data is disposable.

## Migrations

- `dotnet-ef` is a local tool pinned in `.config/dotnet-tools.json`; run
  `dotnet tool restore` once after cloning (or whenever the pinned version
  changes) before using any `dotnet ef` command below.
- Development applies pending migrations automatically on startup
  (`Database.Migrate()` — never `EnsureCreated`).
- Any other environment applies them explicitly:
  `dotnet ef database update --project Ingredo.Api`.
- New migration: `dotnet ef migrations add <Name> --project Ingredo.Api --output-dir Data/Migrations`.

## Test

```bash
dotnet test   # integration tests need Docker running (Testcontainers pulls postgres:17-alpine)
```
