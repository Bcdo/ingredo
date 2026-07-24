# Sync Engine — Design Spec

**Date:** 2026-07-24
**Slice:** Phase 5 slice ④ — the last slice (see `2026-07-22-sync-architecture.md`). The client engine: adoption, push/pull loop, LWW merge into SQLite, cursor management, triggers, status surface.
**Scope:** `lib/sync/` module (orchestrator, dirty collection, wire mapping, apply-writers, cursor store, triggers, status), repo tombstone write-guards + centralized `notDeleted()` predicate, refresh quiesce in `signOut`, a status line + manual sync in the Account section.
**Builds on:** slice ① (dirty/deletedAt columns, tombstone deletes, dirty stamping, `Date.now()` epoch-ms timestamps), slice ② (`GET /api/v1/sync/changes?since=`, `POST /api/v1/sync/push`, per-row LWW, pull-cursor-only contract), slice ③ (`apiFetch`/session/`restoreSession`, Account section), the umbrella decisions 1–8.

## Goals

- Two devices signed into one household converge: edits, deletes, and re-adds made on either appear on the other after their next syncs, with per-row LWW resolving collisions silently.
- First sign-in adopts existing local data into the household automatically; join/leave/account-switch re-adopts; signing out and back in never loses device data.
- Signed out, nothing changes: zero network, zero behavior difference — every trigger is a no-op.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Realtime change notification | Phase 6 (SignalR triggers `syncNow()`; same engine) |
| Background sync while app is closed | Not this phase (umbrella decision 8) |
| Settings sync — `unit_system` decided now: stays device-local like `color_mode`/`language` | Revisit only on user demand |
| Conflict UI / per-field merge | Never (umbrella decision 2) |
| Tombstone GC (local + server) | Post-Phase 5 housekeeping |
| Pull paging | Documented cap from slice ② (~2000 rows) stands |
| Retry/backoff scheduling beyond "next trigger retries" | Add if real-world use shows a need |

## Key decisions

1. **One serialized orchestrator.** `syncNow(): Promise<SyncResult>` runs collect → push → pull → merge → store-cursor as one cycle. A module-level mutex serializes callers: a trigger during a running sync coalesces into exactly one queued follow-up run (not N). Push-before-pull is structural — it is the mitigation the slice-② spec's accepted cursor-gap race assumes, and it makes a device's own writes always resurface in its next pull window.
2. **Cursor and household identity in settings** (device-local keys, never synced): `sync_cursor` (stringified bigint from the server, opaque), `sync_household_id`, `last_synced_at`. The cursor is stored **only from pull responses** — a push's cursor is never adopted (slice-② engine contract: it covers household rows this device may never have pulled).
3. **Household-switch reset = the adoption flow.** At sync start, if `sync_household_id` ≠ `session.householdId`: set cursor to 0, mark EVERY local row in the three synced tables dirty (tombstones included), then proceed. This single rule handles first-ever sign-in (plus slice ①'s dirty-by-default for never-synced rows), join (re-push into the merged household is idempotent — unchanged `updatedAt` → `superseded`), leave (re-populates the fresh personal household, honoring the leave dialog's "nothing is deleted from this device"), and switching accounts. `sync_household_id` is written together with the cursor after a successful pull.
4. **Push.** Collect all dirty rows (`dirty = 1`, tombstones included) from recipes (full aggregates with children), meal-plan entries, shopping items; map to the slice-② wire DTOs (epoch-ms longs, `yyyy-MM-dd` dates, lowercase enums); one `POST /api/v1/sync/push`. Outcome handling per row: `applied` and `superseded` → clear dirty with **compare-and-clear** (`SET dirty = 0 WHERE id = ? AND updated_at = <value read at collect>`), so an edit landing mid-flight keeps its dirty flag for the next cycle; `conflict` → leave dirty, count it (surfaces in status as unsynced; expected only for cross-household id collisions, i.e. never in practice). A batch-level 400 or network failure fails the cycle (nothing cleared); the next trigger retries. Empty dirty set skips the POST entirely.
5. **Pull & merge.** `GET /api/v1/sync/changes?since=<cursor>`; apply rows through dedicated **apply-writers** in `lib/sync/` that set `dirty: 0` explicitly and never reuse the repository functions (which stamp `dirty: 1` — standing ledger rule). Per row, with `local` = row by id (ignoring tombstone state):
   - absent locally → insert with server state, `dirty: 0` (tombstones inserted too — keeps local LWW state complete);
   - present, local `dirty = 0` → apply server state unconditionally (server is truth for clean rows);
   - present, local `dirty = 1` → apply iff server `updatedAt` ≥ local `updatedAt` (the local edit would lose its push anyway; ties defer to the server since a tied push returns `superseded`), clearing dirty when applied; otherwise keep the local row dirty (it wins the next push).
   Recipes apply as aggregate replace: delete local children by recipe id, reinsert from server rows (matches slice ①'s delete-and-reinsert semantics). Tombstone application sets `deletedAt` (display filters already hide it); resurrection (server row with `deletedAt: null` over a local tombstone) follows the same rules. After a successful pull: store `cursor`, `sync_household_id`, `last_synced_at`.
6. **Triggers, all gated on `session.status === 'signedIn'`** (signed out or restoring → no-op, preserving the signed-out invariant and the restore-gating rule from slice ③):
   - app start: root layout runs `restoreSession()` **then** `syncNow()`;
   - foreground: `AppState` listener fires `syncNow()` on `active`;
   - after local mutations: repository write functions call `scheduleSync()` — a ~2 s debounced `syncNow()` — via `lib/sync/trigger.ts` (repos import the trigger; the trigger imports no repos — no cycle);
   - manual: a sync-now affordance next to the status line in the Account section.
7. **Status surface.** `lib/sync/status.ts`: module state `{ state: 'idle' | 'syncing' | 'error', lastSyncedAt: number | null, pendingConflicts: number }` with `useSyncStatus()` (house idiom); `last_synced_at` persisted so the line survives restarts. UI: one quiet line in the Account section — "Last synced <time>" / "Syncing…" / "Sync failed — will retry" (nb + en, times via the existing date formatting) — plus the manual sync affordance. No toasts, no banners, no chrome elsewhere.
8. **Repo hardening (inherited line items, same slice):**
   - **Tombstone write-guards:** the by-id mutations `movePlanEntry`, `setPlanEntryServings` (meal plan), `purchaseItem`, `restoreItem` (shopping) add `AND deleted_at IS NULL` to their WHERE — a stale-UI tap on a row a pull just tombstoned must be a no-op, not a write that strengthens the delete's LWW position or resurrects content.
   - **Centralized predicate:** a `notDeleted(table)` helper in `lib/db/` replaces the scattered `isNull(deletedAt)` conditions in repos and screen queries (mechanical, behavior-identical).
   - **Refresh quiesce:** `client.ts` exports `pendingRefresh(): Promise<unknown>` (the in-flight refresh promise or a resolved one); `signOut` awaits it before clearing tokens — closing slice ③'s residual microtask race (an in-flight refresh can no longer interleave its persist with sign-out's clear).
9. **Error handling.** A failed cycle (network, 401-after-refresh-failure, 5xx, batch 400) sets status `error`, changes nothing else (no cursor movement, no dirty-clearing beyond outcomes already processed), and waits for the next trigger. 401 handling itself lives in `apiFetch` (slice ③); if refresh fails, the session lands signed out and sync simply stops triggering. No retry timers in this slice.

## Components

- `lib/sync/engine.ts` — `syncNow()`, mutex + coalescing, cycle composition.
- `lib/sync/collect.ts` — dirty-row collection + wire mapping (types from `lib/api/types.ts`, extended with the sync row DTOs).
- `lib/sync/apply.ts` — apply-writers (insert/replace/tombstone per table, aggregate replace for recipes), all `dirty: 0`.
- `lib/sync/cursor.ts` — settings-backed cursor/household/lastSynced accessors + the switch-reset + mark-all-dirty routine.
- `lib/sync/trigger.ts` — `scheduleSync()` debounce, AppState wiring, gating.
- `lib/sync/status.ts` — status module state + `useSyncStatus()`.
- `lib/api/types.ts` — add the slice-② sync wire DTO types; `lib/api/client.ts` — `pendingRefresh()` export; `lib/api/auth.ts` — quiesce in `signOut`.
- `lib/db/mealPlan.ts`, `lib/db/shoppingList.ts` — tombstone write-guards; `lib/db/` + screens — `notDeleted()` adoption; repos — `scheduleSync()` calls.
- `app/_layout.tsx` — restore-then-sync + AppState listener; `components/settings/AccountSection.tsx` — status line + manual sync.
- `lib/i18n/{nb,en}.json` — `sync.*` keys.
- Tests: engine suite on the in-memory test DB with mocked `apiFetch`; repo-guard tests; status/AccountSection screen-test additions.

## Error handling

Per decision 9. The engine never throws to callers — `syncNow()` resolves with a result (`synced` / `failed` / `skipped`), and status carries the user-facing truth.

## Testing

Unit (test DB + mocked `apiFetch`): adoption/switch — differing `sync_household_id` marks all rows (incl. tombstones) dirty and resets cursor; push — mapping shapes for all three types incl. children/tombstones, compare-and-clear leaves mid-flight edits dirty, `conflict` keeps dirty, batch failure clears nothing; pull merge matrix — insert / clean-apply / dirty-newer-keeps / dirty-older-applies / tie-applies / tombstone-in / resurrect / recipe-aggregate-child-replace; cursor stored only from pulls; serialized re-entry coalesces; signed-out and restoring no-ops (zero fetches). Repo guards: each of the four by-id mutations no-ops on a tombstoned row. Screen: status line renders the three states; manual sync calls the engine. Full pass: suite, lint zero warnings, `tsc`, android export. Manual: two-device convergence checklist in TESTING.md (edit/delete/re-add both directions, join merge, leave re-adopt, airplane-mode edits syncing on reconnect).

## Rollout

Feature branch `feature/sync-engine` off `develop`. No schema migration (columns exist since slice ①). Compose backend required for manual testing only. After this slice, Phase 5 is complete; Phase 6 (realtime) layers SignalR onto `syncNow()` as an extra trigger.
