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
- Users can belong to several households. `POST /api/v1/households` creates
  one (you become owner and switch to it), `GET /api/v1/households` lists
  your memberships, `POST /api/v1/households/switch` picks the active one.
  The active household rides on the refresh-token family, so each device
  remembers its own choice. Join adds a membership (nothing moves); leave
  sheds one (the last member out deletes the household).

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

## Production

The production stack runs on the home desktop from a dedicated checkout at
`~/srv/ingredo`, tracking `master`. It is the same compose stack as dev plus
`docker-compose.prod.yml`: `ASPNETCORE_ENVIRONMENT=Production`, no host ports,
and a `cloudflared` service that publishes the API as
`https://api.kodesmien.no`. TLS terminates at Cloudflare's edge; WebSockets
(SignalR) are proxied. The API migrates its own schema on startup — there is
no manual migration step.

### One-time setup

1. **Tunnel:** Cloudflare dashboard → Zero Trust → Networks → Tunnels →
   Create tunnel, name `ingredo`. Add a public hostname:
   `api.kodesmien.no` → service `http://api:8080`. Copy the tunnel token.
2. **Checkout:** `git clone <repo> ~/srv/ingredo && cd ~/srv/ingredo && git checkout master`
3. **Secrets:** `cp backend/.env.example backend/.env` and fill in a fresh
   `POSTGRES_PASSWORD`, a fresh `JWT_KEY` (`openssl rand -base64 48`), and the
   `TUNNEL_TOKEN`. Production secrets are separate from dev ones by design.
4. **Deploy:** `~/srv/ingredo/backend/deploy.sh`, then
   `curl -fsS https://api.kodesmien.no/health` → `Healthy`.
5. **Backups:**

   ```bash
   mkdir -p ~/.config/systemd/user
   ln -s ~/srv/ingredo/backend/deploy/ingredo-backup.{service,timer} ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now ingredo-backup.timer
   loginctl enable-linger "$USER"   # timers fire without an open session
   ```

### Invite codes

Registration requires a single-use invite code. Mint a batch on the host:

```bash
~/srv/ingredo/backend/deploy/mint-invites.sh 10   # prints codes like ABC-DEF
```

Hand out one code per tester; a code dies on use. The script prints how many
unused codes remain and the query for a usage overview. Sensitive endpoints
are rate-limited (10/min per client on login/register/join; 429 + Retry-After
beyond that) — a locked-out tester just waits a minute.

### Password resets

A locked-out tester messages the operator; mint them a code:

```bash
~/srv/ingredo/backend/deploy/mint-reset.sh tester@example.com   # prints ABC-DEF
```

The code is single-use, dies after 60 minutes, and only its hash is stored.
The tester enters it under "Glemt passord?" on the sign-in screen with their
new password. A successful reset signs their account out of every device.

### Deploying a change

Merge to `master`, push, then from the dev checkout run
`backend/deploy-remote.sh`. It refuses if `master` has unpushed commits, then
runs `~/srv/ingredo/backend/deploy.sh` on the host over SSH (`bcdo@omarchy`,
override with `INGREDO_HOST`) and checks `/health`. `deploy.sh` itself pulls
fast-forward-only, rebuilds, and restarts the `ingredo-prod` stack. Logs:
`docker logs ingredo-prod-api-1`. A failed startup migration leaves the old
data intact — the new container exits and logs the reason; redeploy the
previous ref.

### Restore

Nightly dumps land in `~/srv/ingredo/backups/` (newest 30 kept, 03:30, `pg_dump -Fc`).
To restore into the running stack (DESTRUCTIVE — replaces current data), stop the API container first to prevent concurrent connections from blocking drops, then restart after the restore:

```bash
docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml stop api
docker exec -i ingredo-prod-postgres-1 pg_restore -U ingredo -d ingredo --clean --if-exists \
  < ~/srv/ingredo/backups/ingredo-<date>.dump
docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml up -d
```

To inspect a dump without touching production, restore it into a scratch
container instead:

```bash
docker run -d --name pg-scratch -e POSTGRES_PASSWORD=scratch postgres:17-alpine
until docker exec pg-scratch pg_isready -U postgres -q; do sleep 1; done
docker exec -i pg-scratch pg_restore -U postgres -d postgres --no-owner \
  < ~/srv/ingredo/backups/ingredo-<date>.dump
docker exec pg-scratch psql -U postgres -c 'SELECT count(*) FROM "Recipes";'
docker rm -f pg-scratch
```

### Ops notes

- Disable desktop suspend (the stack dies with the machine). Downtime is
  benign: the app is offline-first — phones queue edits and converge on the
  next sync after the stack returns.
- Backup status: `systemctl --user status ingredo-backup.timer` /
  `journalctl --user -u ingredo-backup.service`. No alerting at this scale;
  check after reboots.
- The dev stack (`docker compose up` in this directory) and the prod stack
  (`-p ingredo-prod` from `~/srv/ingredo`) share nothing: separate project
  names, containers, volumes, and `.env` files.
