# Phase 5 Sync — Architecture

**Date:** 2026-07-22
**Role:** Umbrella document for Phase 5 (roadmap: offline queue, push/pull sync, conflict handling). Not a slice spec — the four slices below each get their own spec → plan → execution. This doc pins the decisions every slice depends on, so they are made once.
**Builds on:** the completed backend content surface (recipes/meal-plan/shopping, contract-identical, tombstoned, household-scoped); the frontend's local-first SQLite; `docs/ARCHITECTURE.md`'s offline-first sketch.

## Decisions

1. **State-based sync, not an operation log.** Synced rows carry `updatedAt` + `deletedAt` (+ a client-only dirty flag). Push sends the current state of dirty rows; pull fetches rows changed since a cursor; nothing replays operations. This matches the deliberately dumb server stores and collapses ordering/idempotency problems into row comparison. `ARCHITECTURE.md`'s "queue sync action" is realized as dirty-row tracking; its suggested `Version` column is deliberately omitted — LWW needs only timestamps (versions can be added later without migration pain if a real need appears).
2. **Conflict policy: last-writer-wins per row, silently.** Newer `updatedAt` wins; a delete is just a write (tombstone vs. edit — newer wins). No conflict UI. Rationale: "one pool, anyone edits anything" applied to sync; in a household kitchen the collision surface is tiny and every LWW loss is recoverable by editing again.
3. **Aggregates sync as aggregates.** Recipes travel with their children (ingredients/instructions) exactly as the API's full-replace contract; children have no own sync metadata or tombstones anywhere. Meal-plan entries and shopping items are flat rows.
4. **Local-only stays first-class.** No account required, ever, for local use. Signing in is opt-in and enables sync. First sign-in runs an **adoption flow**: existing local rows are marked dirty and pushed into the user's (personal) household. Signing out returns to local-only with data intact (sync metadata retained for a later re-login). Timestamps: local rows keep their locally-authored `updatedAt` through adoption — the server must accept client timestamps for sync (slice ② changes this; the current CRUD API's server-authored timestamps remain for non-sync callers).
5. **Ids are shared currency.** The frontend already mints UUID ids; the server already honors client ids and 409s duplicates. Sync relies on this: a row's id is identical on both sides forever. Tombstone replay semantics (POST-on-deleted → 409 while GET → 404) are handled by the sync endpoints, not the CRUD surface.
6. **Cursor model.** Pull uses a server-authored opaque cursor (in practice: the max server-received sequence/timestamp per household), stored client-side in `settings`. Per-household; a household switch (join/leave) resets the cursor and triggers a full pull.
7. **Transport & auth.** The engine talks to the existing API base URL (configurable), authenticates with the Phase 3 token scheme (15-min access + rotating refresh in secure storage), and treats 401 as "refresh, then re-auth if that fails". The slice-② guard inversion ([AllowAnonymous] + fail-closed) is a named part of the API slice.
8. **Trigger model (engine slice).** Sync runs on app foreground, after local mutations (debounced), and on-demand (pull-to-refresh style); no background service in this phase. Realtime (SignalR) is Phase 6 and layers *on top of* this engine as an extra trigger, not a different mechanism.

## The four slices

| # | Slice | Scope | Depends on |
|---|---|---|---|
| ① | Frontend sync-prep | `deleted_at` + `dirty` columns, tombstone deletes, filters, dirty stamping — pure local, behavior-invisible | — |
| ② | Backend sync endpoints | Delta pull (`changes since cursor`), batch push (client timestamps, LWW upserts, tombstone handling), guard fail-closed inversion | — |
| ③ | Frontend auth | Login/register/join/leave screens, secure token storage, refresh plumbing, signed-out mode untouched | ② (only for manual testing) |
| ④ | Sync engine | Adoption flow, push/pull loop, LWW merge into SQLite, cursor management, status surface (butter notice), household-switch handling | ①②③ |

Slices ① and ② are independent and could interleave; ④ is where the risk concentrates, by design.

## Non-goals (Phase 5)

Realtime (Phase 6); per-field merge; conflict UI; background sync services; multi-household; settings sync (`color_mode`/`language` stay device-local; `unit_system` sync is decided in the engine slice at the earliest); attachment/photo sync (no photos exist).
