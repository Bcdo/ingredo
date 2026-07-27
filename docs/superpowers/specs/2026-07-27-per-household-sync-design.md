# Per-Household Sync — Design Spec

**Date:** 2026-07-27
**Slice:** multi-household slice ③ (see `2026-07-27-multi-household-architecture.md`). The risk-concentrated slice: sync becomes per-household — each household carries its own cursor, collect is scoped to the active partition, adoption shrinks to the NULL bucket, and the switch-as-adoption/re-mint churn is retired.
**Scope:** sync bookkeeping, engine cycle, adoption semantics, sync triggers, settings-key migration. No UI (slice ④), no backend changes (slice ① shipped the endpoints; the sync API is untouched).
**Builds on:** slice ② (every content row carries `household_id`; `inHousehold` predicate; active-household store; apply already stamps pulled rows; `ensureHousehold` currently re-tags + marks all dirty on household change), the sync engine (`lib/sync/*`: single mutex+coalescing cycle, cursor-from-pulls-only, compare-and-clear, remint-on-conflict), the realtime module (reconnects on claim change), slice ①'s backend (per-family active household; sync endpoints scope by the token claim).

## Goals

- Each household has an independent pull cursor: switching back to a household resumes incrementally instead of re-downloading or re-uploading anything.
- Switching the active household moves and duplicates NOTHING. Adoption happens exactly once — NULL-bucket rows into the first household the device syncs while signed in.
- A household switch (or sign-in) promptly syncs the newly-active household.
- A mid-cycle switch or sign-out can never push one partition's rows into another household or store a cursor under the wrong key.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Switcher UI, create/join/leave surfaces, recipe copy | Slice ④ |
| Background sync of non-active households (they go stale until visited) | Umbrella non-goal |
| Cleaning up orphaned `sync_cursor.<id>` keys for left households | Backlog (harmless settings rows) |
| Per-household `last_synced_at` / status | Not planned — the status line is device-level |

## Key decisions

1. **Cursor keys become `sync_cursor.<householdId>`.** `cursor.ts` reparameterizes: `getSyncCursor(db, householdId)`, `storePullResult(db, householdId, cursor)` (which also stamps the global `last_synced_at`). Missing key → cursor 0, exactly today's fresh-start semantics. `getLastSyncedAt` unchanged.
2. **`sync_household_id` retires.** Its only job was detecting household changes for the adoption reset; per-household cursors make the concept meaningless. `getSyncHouseholdId` is deleted. (Slice ②'s migration 0005 consumed the key before this slice's migration removes it — ordering is safe.)
3. **Migration `0006_per_household_cursors` — pure DML** (generated with `drizzle-kit generate --custom`, hand-written SQL; no schema change, no snapshot delta):
   - Rename the legacy cursor under its household: `UPDATE settings SET key = 'sync_cursor.' || (SELECT value FROM settings WHERE key = 'sync_household_id') WHERE key = 'sync_cursor' AND EXISTS (SELECT 1 FROM settings WHERE key = 'sync_household_id');`
   - Then `DELETE FROM settings WHERE key IN ('sync_cursor', 'sync_household_id');` — the `sync_cursor` delete only bites on a never-synced device (the rename already moved it otherwise), and `sync_household_id` goes away per decision 2.
   - Upgrade paths: synced device keeps its cursor under the new key (no re-download); never-synced device keeps nothing (cursor 0); fresh install unaffected.
4. **`ensureHousehold` is retired; `adoptNullBucket(db, householdId)` replaces it.** Runs at the top of every cycle, idempotent and usually a no-op: tag `household_id IS NULL` rows into the active household with `dirty: 1` (all three tables — tombstones included, so never-signed-in deletes replicate). It touches NOTHING outside the NULL bucket: no mark-all-dirty, no re-tag of other households' rows. This retires switch-as-adoption — re-mint remains only for true cross-household id conflicts (`remint.ts` unchanged).
5. **Collect scopes to the active household.** `collectDirty(db, householdId)` adds `inHousehold(<table>, householdId)` beside `dirty = 1` on all three queries (children still travel with their parent recipe). Sync thereby becomes a legitimate consumer of the one predicate — the grep rule ("no `household_id` comparison outside `predicates.ts`") still holds.
6. **The engine cycle pins its household and re-verifies at every boundary.** `runCycle` captures `householdId = session.householdId` once. Before the push request, before the pull request, and after the pull before apply/store, it re-checks `getSession().householdId === householdId` (sign-out makes the check fail via `null`). On mismatch: abort the cycle as `'skipped'`, set `queued = true` so the coalescing re-run syncs the NEW household immediately. Rationale: requests carry whatever token is current, so a mid-cycle rotation would otherwise push the old partition's rows into the new household (the exact duplication this slice eliminates) or store the new household's cursor under the old key. The push→conflict→remint path keeps its existing behavior (remint stays in the captured household's partition; re-minted rows are collected by the follow-up cycle).
7. **Household change triggers a sync.** `initSyncTriggers` additionally subscribes to session changes: when `session.householdId` transitions to a different non-null value, `fireSync()` (same signed-in gate as today's triggers). Covers sign-in-after-restore (existing launch sync retained), join/leave rotations, and slice ④'s switch. Realtime is untouched — its claim-change reconnect already lands the socket in the new group, and `changed` nudges remain accelerators.
8. **Status/UI unchanged.** One `SyncStatus`, one manual sync button, global `last_synced_at`, `pendingConflicts` per-cycle as today. No new user-facing strings.

## Components

- `lib/sync/cursor.ts` — per-household keys, `adoptNullBucket`, `sync_household_id`/`ensureHousehold` removed.
- `lib/sync/collect.ts` — scoped `collectDirty(db, householdId)`.
- `lib/sync/engine.ts` — pinned household + boundary re-checks, threads `householdId` into collect/cursor calls (applyPull already takes it).
- `lib/sync/trigger.ts` — household-change subscription in `initSyncTriggers`.
- `drizzle/0006_per_household_cursors.sql` (+ journal/migrations.js via drizzle-kit `--custom`).
- Tests: `sync-cursor`, `sync-collect`, `sync-engine`, `sync-trigger` updates; `household-migration` extension (or sibling file) for 0006; a new per-household engine suite for the headline invariants.

## Error handling

No new failure modes or surfaces. An aborted (household-mismatch) cycle reports `'skipped'` and relies on the queued follow-up; a failed adoption cycle re-runs naturally — adoption is idempotent and dirty rows persist until pushed (cursor-from-pulls-only unchanged).

## Testing

Jest + better-sqlite3 (house pattern; engine tests mock `apiFetch` as today). Headline invariants:
- **Switch moves nothing:** sync as A, switch to B (new session household), sync — A's rows keep `household_id` A and `dirty: 0`; nothing re-uploads (push body empty for B beyond B's own rows); no re-mint occurs.
- **Independent cursors:** pulls as A store `sync_cursor.A`; a later cycle as B pulls with `since=0` and stores `sync_cursor.B`; returning to A pulls with A's stored cursor (not 0, not B's).
- **Adoption exactly once, NULL-only:** NULL-bucket rows (tombstones included) get tagged + dirty on first signed-in cycle; a second cycle adopts nothing; foreign-household rows are never touched.
- **Mid-cycle switch aborts:** session household changes between collect and push (and separately between pull and apply) — no request lands rows across partitions, no cursor is stored under the wrong key, the cycle returns `'skipped'`, and a follow-up run syncs the new household.
- **Migration 0006:** synced device's cursor value survives under `sync_cursor.<id>` and `sync_household_id` is gone; never-synced device ends with neither key.
- Trigger: a session emit that changes `householdId` fires a sync; a same-household emit (token refresh) does not.

## Rollout

Feature branch `feature/per-household-sync` off `develop`. Migration 0006 applies on next launch after upgrade — devices keep their cursor (no re-download, no re-upload wave). Frontend-only; the backend sync API is untouched. Bilingual surface untouched. Interim note in TESTING.md about join/leave duplication becomes obsolete for app-side switching once slice ④ ships the UI — TESTING.md gets its update there, not here.
