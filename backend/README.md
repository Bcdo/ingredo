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

## Household

- `GET /api/v1/household` — name, join code (`XXX-XXX`), members.
- `PUT /api/v1/household` `{ name }`, `POST /api/v1/household/regenerate-code` — any member.
- `POST /api/v1/household/join` `{ code }` — moves you to that household; if you
  were alone, your recipes move with you and your empty household is deleted.
  Returns a fresh token pair (the old access token's household claim is stale).
- `POST /api/v1/household/leave` — back to a fresh personal household; content
  stays with the household you left. Also returns a fresh token pair.
- Departing a shared household you own (by join or leave) promotes the
  longest-standing remaining member to owner.

## Meal plan & shopping

- `/api/v1/meal-plan-entries` and `/api/v1/shopping-items` — household-scoped CRUD
  with the same contract as recipes (client-mintable ids, full-replace PUT,
  soft DELETE). Meal-plan list accepts `?from=`/`?to=` (ISO dates).
- The server is a row store: shopping/meal-plan behavior (merging, shelf,
  purchase flows) is client logic. `sources` is opaque client JSON.
- Tokens whose household no longer exists get 401 everywhere — refresh to
  recover (the refresh endpoint resolves your current membership).

## Sync

- `GET /api/v1/sync/changes?since=<cursor>` — everything in your household
  changed after the cursor, tombstones included; returns the next cursor.
- `POST /api/v1/sync/push` — batch of full row states with CLIENT-authored
  epoch-ms timestamps; per-row last-writer-wins (`applied` / `superseded` /
  `conflict`). The only endpoint that accepts client timestamps.
- Every server write gets a `SyncSeq` from a DB trigger — CRUD edits and
  sync edits are indistinguishable to pullers.
- Engine contract: store the cursor returned by PULLS. A push's cursor covers
  household rows you may never have pulled — only adopt it after a pull with
  your pre-push cursor has completed, or you will silently skip other
  devices' rows.

## Realtime

- `/hubs/sync` — SignalR hub, `[Authorize]`d, WebSocket clients pass the
  access token as `?access_token=` (accepted only on hub paths). Clients
  never invoke anything; the server sends one message, `changed`, to the
  `household:<id>` group after every durable content write. Clients answer
  by pulling — the socket carries no data.

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
