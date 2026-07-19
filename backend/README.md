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
