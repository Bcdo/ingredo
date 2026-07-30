# Deployment & Distribution — Design Spec

**Date:** 2026-07-31
**Slice:** deployment (the slice every earlier spec deferred TLS/hosting to). Takes the finished app from "Expo Go over LAN against a dev compose stack" to "two phones anywhere, one production backend".
**Scope:** compose restructure (base/override/prod) + Cloudflare Tunnel, production environment + startup migrations, nightly pg_dump backups, app identity (`app.config.ts`), `eas.json` + Android APK, EAS Update serving both phones, deployment manual pass in TESTING.md. No feature work; no new endpoints.
**Context:** the real audience is two users — one Android phone, one iPhone — on a hobby budget. The backend host is the developer's Arch desktop (also the dev machine), behind a free Cloudflare Tunnel on an already-owned domain (`api.<domain>` — placeholder throughout; substitute the real hostname at implementation). The iPhone runs the app in Expo Go loading EAS Updates during beta; the Apple Developer Program ($99/yr, TestFlight) is deferred until past beta.

## Goals

- The backend runs 24/7 on the desktop as a self-contained compose stack, reachable at `https://api.<domain>` from anywhere, with the dev workflow on the same machine untouched.
- Production exposes no dev surface (no Scalar/OpenAPI, no host ports, fresh secrets) and migrates its own schema on startup — deploy is `git pull` + one compose command.
- Each phone gets a durable install: Android a real APK, the iPhone Expo Go + the published `beta` branch. One `eas update` publishes JS changes to both.
- The shared household data survives a disk failure: nightly dumps, pruned, with a written restore procedure.

## Non-goals (deferred/decided)

| Item | Status |
|---|---|
| Password reset / email infrastructure | Deferred — two known users; the operator can reset via the DB. Revisit before any stranger gets an account |
| TestFlight / App Store / Play Store, account deletion, privacy policy | Deferred to the Apple-program milestone; store-policy items are moot until then |
| Error reporting (Sentry etc.), CI, rate limiting | Deferred — out of scope for this slice |
| Managed hosting / VPS | Not planned — the desktop + tunnel is the decision; offline-first sync makes host downtime benign |
| Horizontal scaling (Redis backplane etc.) | Not planned — single instance is a permanent assumption at this audience |
| `production` EAS build profile, `ios.buildNumber` bumping | Arrives with the Apple program |

## Key decisions

1. **Compose split into base + auto-loaded dev override + prod overlay** (replaces the single `backend/docker-compose.yml`). Base: `postgres` + `api` service definitions, volumes, healthcheck — **no host ports, no `ASPNETCORE_ENVIRONMENT`** (compose overlays UNION port lists rather than replace them, so ports must live only in the leaf files). `docker-compose.override.yml` (picked up automatically by plain `docker compose up`, keeping the dev workflow byte-identical): `Development`, ports `8080:8080` and `5432:5432`. `docker-compose.prod.yml`: `Production`, no ports, `restart: unless-stopped` on every service, plus the `cloudflared` service.
2. **Cloudflare Tunnel as a compose service:** official `cloudflare/cloudflared` image, `tunnel run` with `TUNNEL_TOKEN` from `.env` (dashboard-managed tunnel). Public hostname `api.<domain>` → `http://api:8080` configured in the Cloudflare dashboard. Cloudflare terminates TLS at the edge and proxies WebSockets, so SignalR (`/hubs/sync`) works unchanged; the API itself keeps serving plain HTTP inside the compose network — no `UseHttpsRedirection`/certs in the app. One-time setup steps (create tunnel, add hostname, mint token) go in `backend/README.md`.
3. **Prod and dev coexist on one machine via a dedicated production checkout** (`~/srv/ingredo`): its own `.env` (fresh `POSTGRES_PASSWORD`, fresh `JWT_KEY`, `TUNNEL_TOKEN`), compose project name `ingredo-prod` (set via the deploy script's `-p` flag, not `name:` in a compose file, so the dev stack's default project name is untouched), hence separate containers and a separate `pgdata` volume from the dev stack. `backend/deploy.sh` wraps the whole deploy: `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml -p ingredo-prod up -d --build`. The prod checkout tracks `master` (merged, tagged states) — never the working branch.
4. **Startup migrations in every environment:** `Program.cs` drops the `IsDevelopment()` gate around `Database.Migrate()`. Single instance + two users makes migrate-on-start the right simplicity trade-off, and it IS the production migration mechanism (no SDK, no manual `dotnet ef` on the host). Scalar/OpenAPI mapping and the Serilog file sink keep their dev gates — Production automatically exposes neither; console logs land in `docker logs`.
5. **Backups: nightly `pg_dump -Fc`** via `docker exec` on the prod postgres container into `~/srv/ingredo/backups/`, pruning to the newest 30. Shipped as `backend/deploy/backup.sh` plus systemd `ingredo-backup.service`/`.timer` unit files with install instructions (symlink + `systemctl enable --now`). The restore procedure (`pg_restore` into a fresh container/volume) is written in `backend/README.md` — one paragraph, authored before it's ever needed. Ops notes there too: disable desktop suspend; downtime is benign (offline-first — phones queue and converge later).
6. **`app.json` → `app.config.ts`** with the real identity: name "Ingredo", slug `ingredo`, scheme `ingredo`, `android.package` and `ios.bundleIdentifier` = reverse-domain id (set both now; iOS fields are inert until the Apple program). Cleanups riding along: duplicate `userInterfaceStyle` key removed, unused `web` platform + block dropped. `extra.apiUrl = process.env.INGREDO_API_URL ?? 'http://10.0.2.2:8080'` — local `expo start` behaves exactly as today; only artifact-producing commands set the variable. `lib/api/config.ts` is untouched (its override → extra → default chain already fits), and the in-app server override field keeps working as the escape hatch in dev builds.
7. **`eas.json` with `development` and `preview` profiles.** `preview`: Android `buildType: apk`, `distribution: internal`, `channel: beta`, `INGREDO_API_URL=https://api.<domain>` in the profile env. Version stays `1.0.0`; `android.versionCode` starts at 1 and bumps only on native rebuilds. EAS free tier covers the rare APK build; requires an Expo account + `extra.eas.projectId` (added by `eas init`).
8. **EAS Update, one `beta` branch, both phones:** add `expo-updates`, configure via `eas update:configure`, `runtimeVersion: { policy: 'sdkVersion' }`. That policy is what lets a single published update serve the Android APK (OTA check on launch) AND the iPhone in Expo Go (opens the same update; every current native module — router, sqlite, secure-store, localization, font — is Expo Go-compatible). Adding any custom native module breaks the Expo Go half — acceptable, that's the Apple-program trigger. Publishing = `npm run publish:beta` → `INGREDO_API_URL=https://api.<domain> eas update --branch beta` (env inlined at publish time, so the update carries the prod URL).
9. **npm scripts as the release interface:** `build:beta` (`eas build --profile preview --platform android` — run ~once, then only for native changes) and `publish:beta` (every JS change). Phone setup, once each: Android installs the APK from the EAS build link; iPhone installs Expo Go, signs into the Expo account, opens the project's `beta` update (QR/link from the dashboard).
10. **Fresh start on the production server:** dev-era accounts/data on the phones don't migrate. Both users sign out, sign in (register) against the new URL; pre-existing local content uploads via the NULL-bucket adoption path (built by the per-household-sync slice for exactly this). No server-side data migration exists or is needed.

## Components

- `backend/docker-compose.yml` (rewritten base), `backend/docker-compose.override.yml` (new, dev), `backend/docker-compose.prod.yml` (new: prod env + cloudflared), `backend/.env.example` (+`TUNNEL_TOKEN` line).
- `backend/deploy.sh`, `backend/deploy/backup.sh`, `backend/deploy/ingredo-backup.{service,timer}`.
- `backend/Ingredo.Api/Program.cs` (ungate `Migrate()`).
- `backend/README.md` (tunnel setup, prod checkout + deploy, backup install, restore, ops notes).
- `frontend/app.config.ts` (replaces `app.json`), `frontend/eas.json` (new), `frontend/package.json` (+`expo-updates`, +`build:beta`/`publish:beta` scripts).
- `docs/TESTING.md` (+ deployment manual pass), root `README.md` (correct the stale backend description while touching deploy docs).

## Error handling

Nothing new in-app. Host-level: `restart: unless-stopped` recovers containers from crashes and reboots; `cloudflared` reconnects on network blips; a failed nightly backup surfaces in `systemctl status ingredo-backup` (documented in the ops notes — no alerting at this scale, checking after the odd reboot is the operating model). A failed startup migration keeps the old containers' data intact (the new container exits; `docker logs` tells the story; redeploy the previous ref).

## Testing

- Automated: backend suite must stay green after the `Migrate()` ungating (the Testcontainers fixture manages its own schema — verify no double-migrate conflict). Frontend: existing `lib/api/config.ts` tests already pin the URL chain; add one test that the exported Expo config falls back to the dev URL when `INGREDO_API_URL` is unset. `npm run lint` + `tsc` + full suites as always.
- Manual (new TESTING.md "Deployment" pass, gates the switch-over): prod stack up on the desktop → `/health` green via `https://api.<domain>` from mobile data (not home Wi-Fi — that's the test that proves the tunnel) → register both real accounts → both phones sync a recipe through the tunnel → realtime between the phones off-LAN → `publish:beta` and watch both phones pick up the update (APK relaunch, Expo Go reopen) → run `backup.sh`, then `pg_restore` one dump into a scratch container and see the rows.

## Rollout

Feature branch `feature/deployment` off `develop`. Backend + frontend config only — no schema, no endpoints. After merge to `master`: create the tunnel + DNS hostname in the Cloudflare dashboard, clone the prod checkout, fill `.env`, run `deploy.sh`, install the backup timer, run the TESTING.md deployment pass, install the APK + Expo Go update on the two phones, sign in fresh. From then on the loop is: merge → `deploy.sh` on the desktop (backend) and/or `npm run publish:beta` (app).
