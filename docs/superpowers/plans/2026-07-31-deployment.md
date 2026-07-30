# Deployment & Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the finished app from "Expo Go over LAN against a dev compose stack" to two phones anywhere talking to `https://api.kodesmien.no`, served by a production compose stack on the developer's desktop behind a Cloudflare Tunnel, with nightly backups and EAS-published app builds.

**Architecture:** The backend compose file splits into base + auto-loaded dev override + prod overlay (prod adds `cloudflared`, drops all host ports, runs `ASPNETCORE_ENVIRONMENT=Production`); startup migrations lose their dev-only gate. The frontend's `app.json` becomes `app.config.ts` with the real identity and an env-driven API URL; `eas.json` + EAS Update (one `beta` branch, `sdkVersion` runtime policy) serve both the Android APK and the iPhone in Expo Go.

**Tech Stack:** Docker Compose, cloudflared (dashboard-managed tunnel), systemd user timers, pg_dump; Expo SDK 54 / RN 0.81, `expo-updates`, `eas-cli`. Backend .NET 10, tests via xUnit + Testcontainers (needs Docker). Spec: `docs/superpowers/specs/2026-07-31-deployment-design.md`.

## Global Constraints

- API public hostname: `https://api.kodesmien.no` (Cloudflare Tunnel → `http://api:8080` on the compose network).
- App identity: name `Ingredo`, slug `ingredo`, scheme `ingredo`, `android.package` = `ios.bundleIdentifier` = `no.kodesmien.ingredo`, `android.versionCode: 1`.
- Production checkout lives at `~/srv/ingredo`, compose project name `ingredo-prod` (always via `-p ingredo-prod`, never `name:` in a compose file).
- Frontend gates before every commit: `npx jest`, `npx tsc --noEmit`, `npm run lint` (prettier covers `.json` too — keep new json/ts files prettier-clean). Backend gate: `dotnet test` (Docker must be running).
- Dev workflow must stay byte-identical: plain `docker compose up` in `backend/` and `npx expo start` in `frontend/` behave exactly as today (ports 8080/5432, `Development`, API default `http://10.0.2.2:8080`).
- Compose merge gotcha driving the file split: overlays UNION port lists — ports may ONLY appear in `docker-compose.override.yml`.
- Commit prefixes follow house style (`feat:`, `fix:`, `docs:`, `chore:`).

---

### Task 1: Compose split (base / dev override / prod overlay)

**Files:**
- Modify: `backend/docker-compose.yml` (becomes the neutral base)
- Create: `backend/docker-compose.override.yml` (dev — auto-loaded)
- Create: `backend/docker-compose.prod.yml` (prod + cloudflared)
- Modify: `backend/.env.example` (+`TUNNEL_TOKEN`)

**Interfaces:**
- Produces: the compose file trio later tasks reference; prod stack = `docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml`; prod postgres container name `ingredo-prod-postgres-1` (Task 4 depends on it).

- [ ] **Step 1: Rewrite the base `backend/docker-compose.yml`** — today's file minus host ports and minus `ASPNETCORE_ENVIRONMENT`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-ingredo}
      POSTGRES_USER: ${POSTGRES_USER:-ingredo}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set in backend/.env}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}']
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: ./Ingredo.Api
    environment:
      Jwt__Key: ${JWT_KEY:?set in backend/.env}
      Jwt__Issuer: ingredo-api
      Jwt__Audience: ingredo-app
      ConnectionStrings__Default: Host=postgres;Port=5432;Database=${POSTGRES_DB:-ingredo};Username=${POSTGRES_USER:-ingredo};Password=${POSTGRES_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 2: Create `backend/docker-compose.override.yml`** (dev conveniences, auto-loaded by plain `docker compose up`):

```yaml
services:
  postgres:
    ports:
      - '5432:5432'

  api:
    environment:
      ASPNETCORE_ENVIRONMENT: Development
    ports:
      - '8080:8080'
```

- [ ] **Step 3: Create `backend/docker-compose.prod.yml`**:

```yaml
services:
  postgres:
    restart: unless-stopped

  api:
    environment:
      ASPNETCORE_ENVIRONMENT: Production
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?set in .env}
    restart: unless-stopped
    depends_on:
      - api
```

- [ ] **Step 4: Append to `backend/.env.example`**:

```bash
# Cloudflare Tunnel token (production only) — Cloudflare dashboard →
# Zero Trust → Networks → Tunnels → the "ingredo" tunnel → token.
TUNNEL_TOKEN=paste-tunnel-token-here
```

- [ ] **Step 5: Verify the dev merge is unchanged.** From `backend/`:

Run: `docker compose config | grep -E 'ASPNETCORE_ENVIRONMENT|published'`
Expected: `ASPNETCORE_ENVIRONMENT: Development`, one `published: "8080"`, one `published: "5432"`.

- [ ] **Step 6: Verify the prod merge.** From `backend/`:

Run: `TUNNEL_TOKEN=dummy docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -cE 'published'` → expected `0`; then `TUNNEL_TOKEN=dummy docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -E 'ASPNETCORE_ENVIRONMENT|cloudflared|restart'`
Expected: `ASPNETCORE_ENVIRONMENT: Production`, a `cloudflared` service, three `restart: unless-stopped`.

- [ ] **Step 7: Dev smoke test.** From `backend/`:

Run: `docker compose up -d --build && sleep 5 && curl -fsS http://localhost:8080/health && docker compose down`
Expected: `Healthy` (plain `down`, NOT `down -v` — the dev volume keeps its data).

- [ ] **Step 8: Commit**

```bash
git add backend/docker-compose.yml backend/docker-compose.override.yml backend/docker-compose.prod.yml backend/.env.example
git commit -m "feat: split compose into base, dev override and prod overlay with cloudflared"
```

---

### Task 2: Startup migrations in every environment

**Files:**
- Modify: `backend/Ingredo.Api/Program.cs:52-56`

**Interfaces:**
- Produces: production schema migration happens at API startup — no other mechanism exists; Task 5's README states this.

- [ ] **Step 1: Ungate `Database.Migrate()`.** Replace:

```csharp
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}
```

with:

```csharp
// Single-instance deployment: the API migrates its own schema on startup
// in every environment — this IS the production migration mechanism.
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
}
```

(The Scalar/OpenAPI block at lines 64-68 and the Serilog file sink keep their dev gates — untouched.)

- [ ] **Step 2: Run the backend suite** (Docker running — Testcontainers):

Run: `cd backend && dotnet test`
Expected: all green. If a test host runs `Migrate()` against a Testcontainers database that the fixture also migrates, `Migrate()` is idempotent — but if any test fails on double-migration, report it rather than patching around it.

- [ ] **Step 3: Commit**

```bash
git add backend/Ingredo.Api/Program.cs
git commit -m "feat: run startup migrations in every environment"
```

---

### Task 3: deploy.sh

**Files:**
- Create: `backend/deploy.sh` (mode 755)

**Interfaces:**
- Consumes: Task 1's compose trio.
- Produces: the one deploy command Task 5's README and Task 8's TESTING.md reference: `backend/deploy.sh` run inside the prod checkout.

- [ ] **Step 1: Write `backend/deploy.sh`**:

```bash
#!/usr/bin/env bash
# Production deploy — run from the prod checkout (~/srv/ingredo/backend).
# Pulls the tracked branch (master) and rebuilds the ingredo-prod stack.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
docker compose -p ingredo-prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --build
docker compose -p ingredo-prod \
  -f docker-compose.yml -f docker-compose.prod.yml \
  ps
echo "Deployed. Verify: curl -fsS https://api.kodesmien.no/health"
```

- [ ] **Step 2: Make it executable and syntax-check**

Run: `chmod +x backend/deploy.sh && bash -n backend/deploy.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/deploy.sh
git commit -m "feat: add production deploy script"
```

---

### Task 4: Nightly backups (script + systemd user units)

**Files:**
- Create: `backend/deploy/backup.sh` (mode 755)
- Create: `backend/deploy/ingredo-backup.service`
- Create: `backend/deploy/ingredo-backup.timer`

**Interfaces:**
- Consumes: prod postgres container `ingredo-prod-postgres-1` (Task 1), default db/user `ingredo`/`ingredo`.
- Produces: dumps at `~/srv/ingredo/backups/ingredo-YYYY-MM-DD.dump`; install procedure documented in Task 5.

- [ ] **Step 1: Write `backend/deploy/backup.sh`**:

```bash
#!/usr/bin/env bash
# Nightly pg_dump of the ingredo-prod stack. Installed via ingredo-backup.timer
# (systemd --user). Keeps the newest 30 dumps.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/srv/ingredo/backups}"
KEEP=30

mkdir -p "$BACKUP_DIR"
docker exec ingredo-prod-postgres-1 \
  pg_dump -Fc -U ingredo ingredo \
  > "$BACKUP_DIR/ingredo-$(date +%F).dump"
ls -1t "$BACKUP_DIR"/ingredo-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm --
```

- [ ] **Step 2: Write `backend/deploy/ingredo-backup.service`**:

```ini
[Unit]
Description=Nightly Ingredo production database dump

[Service]
Type=oneshot
ExecStart=%h/srv/ingredo/backend/deploy/backup.sh
```

- [ ] **Step 3: Write `backend/deploy/ingredo-backup.timer`**:

```ini
[Unit]
Description=Run the Ingredo backup every night

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Syntax checks**

Run: `chmod +x backend/deploy/backup.sh && bash -n backend/deploy/backup.sh && systemd-analyze --user verify backend/deploy/ingredo-backup.service 2>&1 | grep -v "Unit is bound" || true`
Expected: `bash -n` silent; `systemd-analyze verify` reports nothing fatal (a warning that the referenced `%h/srv/...` path doesn't exist yet on this machine is fine — the prod checkout doesn't exist until rollout).

- [ ] **Step 5: Commit**

```bash
git add backend/deploy/backup.sh backend/deploy/ingredo-backup.service backend/deploy/ingredo-backup.timer
git commit -m "feat: add nightly pg_dump backup script and systemd user units"
```

---

### Task 5: Backend README — production operations

**Files:**
- Modify: `backend/README.md` (append a `## Production` section at the end)

**Interfaces:**
- Consumes: everything Tasks 1–4 produced (exact commands/paths repeated below).

- [ ] **Step 1: Append this section to `backend/README.md`** (adjust the heading level to match the file's existing structure — top-level sections there use `##`):

````markdown
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

### Deploying a change

Merge to `master`, then run `~/srv/ingredo/backend/deploy.sh`. It pulls
fast-forward-only, rebuilds, and restarts the `ingredo-prod` stack. Logs:
`docker logs ingredo-prod-api-1`. A failed startup migration leaves the old
data intact — the new container exits and logs the reason; redeploy the
previous ref.

### Restore

Nightly dumps land in `~/srv/ingredo/backups/` (newest 30 kept, 03:30, `pg_dump -Fc`).
To restore into the running stack (DESTRUCTIVE — replaces current data):

```bash
docker exec -i ingredo-prod-postgres-1 pg_restore -U ingredo -d ingredo --clean --if-exists \
  < ~/srv/ingredo/backups/ingredo-<date>.dump
```

To inspect a dump without touching production, restore it into a scratch
container instead:

```bash
docker run -d --name pg-scratch -e POSTGRES_PASSWORD=scratch postgres:17-alpine
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
````

- [ ] **Step 2: Sanity-check the table name in the scratch-restore example** — confirm the EF table is `"Recipes"` (`grep -rn 'ToTable\|DbSet<Recipe>' backend/Ingredo.Api/Data/AppDbContext.cs`); if EF maps a different name/casing, fix the `psql -c` line to match.

- [ ] **Step 3: Commit**

```bash
git add backend/README.md
git commit -m "docs: document production deploy, backups and restore"
```

---

### Task 6: app.config.ts with real identity and env-driven API URL

**Files:**
- Delete: `frontend/app.json`
- Create: `frontend/app.config.ts`
- Test: `frontend/__tests__/app-config.test.ts`

**Interfaces:**
- Produces: `export default ({ config }: ConfigContext): ExpoConfig` reading `process.env.INGREDO_API_URL` at call time; `const EAS_PROJECT_ID = ''` at the top of `app.config.ts` (Task 7 fills it). `lib/api/config.ts` is NOT modified — its `override → extra.apiUrl → DEV_DEFAULT` chain already fits.

- [ ] **Step 1: Write the failing test** at `frontend/__tests__/app-config.test.ts`:

```ts
import type { ConfigContext } from 'expo/config';

import appConfig from '../app.config';

const ctx = { config: {} } as ConfigContext;

describe('app.config', () => {
  const saved = process.env.INGREDO_API_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.INGREDO_API_URL;
    else process.env.INGREDO_API_URL = saved;
  });

  it('falls back to the emulator URL when INGREDO_API_URL is unset', () => {
    delete process.env.INGREDO_API_URL;
    expect(appConfig(ctx).extra?.apiUrl).toBe('http://10.0.2.2:8080');
  });

  it('uses INGREDO_API_URL when set', () => {
    process.env.INGREDO_API_URL = 'https://api.kodesmien.no';
    expect(appConfig(ctx).extra?.apiUrl).toBe('https://api.kodesmien.no');
  });

  it('carries the app identity', () => {
    const cfg = appConfig(ctx);
    expect(cfg.name).toBe('Ingredo');
    expect(cfg.slug).toBe('ingredo');
    expect(cfg.android?.package).toBe('no.kodesmien.ingredo');
    expect(cfg.android?.versionCode).toBe(1);
    expect(cfg.ios?.bundleIdentifier).toBe('no.kodesmien.ingredo');
    expect(cfg.runtimeVersion).toEqual({ policy: 'sdkVersion' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx jest __tests__/app-config.test.ts`
Expected: FAIL — cannot find module `../app.config`.

- [ ] **Step 3: Create `frontend/app.config.ts` and delete `frontend/app.json`.** Content carries over everything from today's `app.json` except: the duplicate `userInterfaceStyle` key, the `web` platform + `web` block (unused; the API has no CORS by design):

```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Filled by `eas init` (see eas.json task) — used for both the EAS project
// link and the expo-updates URL.
const EAS_PROJECT_ID = '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Ingredo',
  slug: 'ingredo',
  version: '1.0.0',
  scheme: 'ingredo',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  assetBundlePatterns: ['**/*'],
  platforms: ['ios', 'android'],
  plugins: ['expo-router', 'expo-localization', 'expo-sqlite', 'expo-font', 'expo-secure-store'],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'no.kodesmien.ingredo',
  },
  android: {
    package: 'no.kodesmien.ingredo',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
  },
  runtimeVersion: { policy: 'sdkVersion' },
  ...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
  extra: {
    apiUrl: process.env.INGREDO_API_URL ?? 'http://10.0.2.2:8080',
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
```

```bash
rm frontend/app.json
```

- [ ] **Step 4: Run the new test, then the full gates**

Run: `cd frontend && npx jest __tests__/app-config.test.ts && npx jest && npx tsc --noEmit && npm run lint`
Expected: all green — jest-expo resolves the Expo config from `app.config.ts` transparently. If `npx tsc --noEmit` flags typed-routes, run `npx expo start` once to regenerate the gitignored typed-routes file (known quirk, see TESTING.md habits section) and re-run.

- [ ] **Step 5: Dev-behavior spot check** (no env var set):

Run: `cd frontend && npx expo config --type public | grep apiUrl`
Expected: `"apiUrl": "http://10.0.2.2:8080"` — local `expo start` behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/app.config.ts frontend/__tests__/app-config.test.ts
git rm frontend/app.json
git commit -m "feat: real app identity via app.config.ts with env-driven API URL"
```

---

### Task 7: expo-updates, eas.json, release scripts

**Files:**
- Modify: `frontend/package.json` (+`expo-updates` dep, +`eas-cli` devDep, +2 scripts)
- Create: `frontend/eas.json`
- Modify: `frontend/app.config.ts:5` (fill `EAS_PROJECT_ID`)

**Interfaces:**
- Consumes: `EAS_PROJECT_ID` const from Task 6.
- Produces: `npm run build:beta` (Android APK, profile `preview`, channel `beta`) and `npm run publish:beta` (EAS Update to branch `beta` with the production API URL inlined). One `beta` branch serves the APK's OTA checks AND the iPhone in Expo Go — that is what `runtimeVersion: { policy: 'sdkVersion' }` buys; adding any non-Expo-Go native module later breaks the Expo Go half (accepted: that's the Apple-program trigger).

- [ ] **Step 1: Install packages** (SDK-matched via `expo install`):

Run: `cd frontend && npx expo install expo-updates && npm install --save-dev eas-cli`
Expected: `expo-updates` lands at the SDK 54-compatible version.

- [ ] **Step 2: USER STEP — link the EAS project.** This is interactive (Expo account login); ask the user to run in their terminal (`!` prefix works in this session):

```
! cd frontend && npx eas login && npx eas init
```

`eas init` with a dynamic config prints the new `projectId` and asks you to add it manually. Take the printed UUID and set it in `frontend/app.config.ts`: `const EAS_PROJECT_ID = '<uuid>';`. Do not proceed until the user provides it.

- [ ] **Step 3: Create `frontend/eas.json`**:

```json
{
  "cli": {
    "version": ">= 12.0.0",
    "appVersionSource": "local"
  },
  "build": {
    "development": {
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "channel": "beta",
      "env": {
        "INGREDO_API_URL": "https://api.kodesmien.no"
      },
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

- [ ] **Step 4: Add the release scripts to `frontend/package.json`** `scripts`:

```json
"build:beta": "eas build --profile preview --platform android",
"publish:beta": "INGREDO_API_URL=https://api.kodesmien.no eas update --branch beta"
```

- [ ] **Step 5: Run the gates + config sanity**

Run: `cd frontend && npx jest && npx tsc --noEmit && npm run lint && npx expo config --type public | grep -E 'runtimeVersion|u.expo.dev'`
Expected: suites green; config output shows the `sdkVersion` policy and the `https://u.expo.dev/<projectId>` updates URL.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/eas.json frontend/app.config.ts
git commit -m "feat: wire EAS build and update with a beta channel"
```

---

### Task 8: TESTING.md deployment pass + root README de-staling

**Files:**
- Modify: `docs/TESTING.md` (append new section at the end)
- Modify: `README.md` (root — replace the stale backend content)

- [ ] **Step 1: Append to `docs/TESTING.md`**:

```markdown
## Deployment (manual pass)

One-time production verification; gates the switch-over from LAN/dev to
`api.kodesmien.no`. Prod stack on the desktop (`~/srv/ingredo`, see
`backend/README.md` → Production). Phones on MOBILE DATA, not home Wi-Fi —
off-LAN is what actually proves the tunnel.

- `deploy.sh` brings the stack up; `docker compose -p ingredo-prod -f docker-compose.yml -f docker-compose.prod.yml ps` shows api, postgres and cloudflared running.
- `https://api.kodesmien.no/health` returns Healthy from a phone browser on mobile data.
- Register both real accounts against production (sign out of the dev server first; each device's local content uploads on its first signed-in sync — watch it appear on the other phone).
- Recipe edit on one phone appears on the other after foregrounding; realtime: check off a shopping item and watch it flip on the other phone within seconds, still off-LAN.
- `npm run publish:beta`, then relaunch the installed APK (Android) and reopen the project in Expo Go (iPhone) → both pick up the change.
- Run `backend/deploy/backup.sh`, restore the dump into a scratch container (commands in `backend/README.md` → Restore) and see row counts.
- `systemctl --user list-timers` shows `ingredo-backup.timer` scheduled.
```

- [ ] **Step 2: Fix the root `README.md`.** It describes a project that no longer exists (.NET 9, SQLite + `EnsureCreated()`, ports 5193/7109, a `docker-compose.dev.yml` with nginx/Redis/pgAdmin, `AllowAnyOrigin` CORS, `backend/CONTRIBUTING.md`, `backend/WARP.md` — none are real). Replace everything from `## Repository Layout` to the end of the file with:

````markdown
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
````

Keep everything above `## Repository Layout` (project description, Core Philosophy, Primary Features, Tech Stack) as-is, except: in **Tech Stack → Backend**, change `SignalR (later)` to `SignalR`.

- [ ] **Step 3: Verify the nested code fence renders** — the Repository Layout block nests a triple-backtick fence inside the replacement; when editing, use the same fencing the current README uses (it already nests this exact block — copy its style). Preview with any markdown renderer or `grep -c '```' README.md` (count must be even).

- [ ] **Step 4: Commit**

```bash
git add docs/TESTING.md README.md
git commit -m "docs: add deployment manual pass; de-stale the root README"
```

---

## Post-merge rollout (operator checklist — not plan tasks)

In order, on the desktop, after this branch merges to `master`:

1. Cloudflare dashboard: create tunnel `ingredo`, public hostname `api.kodesmien.no` → `http://api:8080`, copy token (README Production §1).
2. `git clone` the prod checkout to `~/srv/ingredo`, fill `backend/.env`, run `backend/deploy.sh` (README §2–4).
3. Install the backup timer (README §5).
4. `npm run build:beta` → install the APK on the Android phone; iPhone: install Expo Go, sign in, open the `beta` update.
5. Run the TESTING.md **Deployment** manual pass end-to-end.
6. Both users sign out of the dev server and register on production; local content uploads via NULL-bucket adoption.
