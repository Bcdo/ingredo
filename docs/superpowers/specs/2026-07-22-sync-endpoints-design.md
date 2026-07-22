# Backend Sync Endpoints — Design Spec

**Date:** 2026-07-22
**Slice:** Phase 5 slice ② (see `2026-07-22-sync-architecture.md`). The server side of state-based sync: delta pull, LWW batch push, and the named guard fail-closed inversion.
**Scope:** A `SyncSeq` change sequence on the three content tables (server-authored, trigger-assigned), `GET /api/v1/sync/changes` + `POST /api/v1/sync/push`, client-authored timestamps entering ONLY through the push endpoint, per-row LWW with tombstones as ordinary writes, `[AllowAnonymous]`-based guard inversion.
**Builds on:** the contract-identical content stores (recipes/meal-plan/shopping), household scoping + guard middleware, the umbrella architecture's decisions 1–8; frontend slice ① (dirty rows carrying `Date.now()` epoch-ms timestamps).

## Goals

- A device can converge from any state with two calls: pull everything since its cursor, push its dirty rows — repeatable, idempotent, order-tolerant.
- LWW is decided by client-authored `updatedAt` exactly as the architecture prescribes, while the pull cursor stays server-authored and monotonic — the two time axes never mix.
- The guard becomes structurally fail-closed while provably preserving the refresh escape hatch.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| The client engine (consuming these endpoints) | Slice ④ |
| Pull paging | Deferred with a documented cap: households are two-digit-row scale; revisit if a pull ever exceeds ~2000 rows |
| Realtime push notification of changes | Phase 6 (SignalR triggers a pull; same endpoints) |
| Settings sync | Engine slice at the earliest (architecture non-goal) |
| Tombstone GC / sequence compaction | Housekeeping later |
| Rate limiting | Standing pre-public-exposure item |

## Key decisions

1. **`SyncSeq bigint` on `Recipes`, `MealPlanEntries`, `ShoppingItems`,** assigned from ONE shared Postgres sequence (`sync_seq`) by BEFORE INSERT OR UPDATE triggers on the three tables (plus `DEFAULT nextval('sync_seq')`), so EVERY write path — CRUD, sync-applied, and `ExecuteUpdate` bulk paths like the household-join re-home — gets a fresh sequence value structurally, with no interceptor and no special cases. EF maps the column `ValueGeneratedOnAddOrUpdate` (never written by the app). Children carry no `SyncSeq` (they ride the recipe aggregate: any child change already bumps the parent). Indexed `(HouseholdId, SyncSeq)` per table. Known accepted race: a pull's cursor is the max sequence it RETURNED; a concurrently in-flight write with a lower sequence committing after the read is skipped by subsequent pulls — astronomically narrow at household scale, mitigated by the engine's push-then-pull ordering (own writes always resurface), documented here as chosen; the robust fix (transactional watermark) is deferred hardening.
2. **Cursor = max `SyncSeq` observed,** returned by both endpoints, opaque to clients, monotonic because only the server assigns it. `since=0` (or omitted) = full pull. Per-household isolation is by the usual scoping; the cursor itself is global-sequence-valued but reveals nothing (a number). Engine rule (slice ④): the stored cursor advances from pulls; a push-returned cursor may only be adopted after a pull with the pre-push cursor has completed — adopting it blind skips rows the device never pulled.
3. **Pull: `GET /api/v1/sync/changes?since=`** returns `{ recipes, mealPlanEntries, shoppingItems, cursor }` — every row of the caller's household with `SyncSeq > since`, `IgnoreQueryFilters` (tombstones travel), recipes as full aggregates (children included on non-deleted and deleted alike), each row carrying `id`, all content fields, and `createdAt`/`updatedAt`/`deletedAt` as **epoch milliseconds** (the frontend's native representation; server `DateTimeOffset`s convert losslessly).
4. **Push: `POST /api/v1/sync/push`** takes `{ recipes: [...], mealPlanEntries: [...], shoppingItems: [...] }` (any subset, each row a full state incl. epoch-ms timestamps and optional tombstone). Per-row LWW against the caller's household:
   - id absent everywhere → insert with client timestamps (+fresh `SyncSeq`) → `applied`;
   - id present in caller's household → apply iff client `updatedAt` **>** server `updatedAt` (strictly; ties keep the server row) → `applied`, else `superseded`;
   - id present in another household → `conflict` (no details; UUID space makes probing meaningless);
   - recipes apply as full aggregate replace; tombstoned pushes replace like any write (children of a tombstoned recipe are dropped, matching soft-delete display semantics).
   Response: `{ results: { <id>: "applied" | "superseded" | "conflict" }, cursor }`. The batch is one transaction (all-applied-or-none per request? No — per-row outcomes with one transaction for atomic visibility; individual `superseded`/`conflict` are outcomes, not errors). Validation: pushed rows are mapped onto the CRUD request records and run through the EXISTING validator classes (one source of validation truth); invalid row → 400 for the whole batch. Exception: the meal-plan referential rule is NOT the CRUD live-recipe rule — sync accepts entries whose recipe is tombstoned (a legal replicated state); the check is row-existence in the caller's household (IgnoreQueryFilters), and a missing recipe makes that row's outcome `conflict`, not a batch 400. In-batch ordering is fixed (recipes, then entries, then shopping) so same-batch references resolve.
5. **Trust boundary:** client-authored timestamps are accepted ONLY by `/sync/push`. CRUD endpoints keep server-authored timestamps, unchanged. Push-applied rows do NOT bump `updatedAt` server-side — the client's value is stored verbatim (that is the LWW axis); `SyncSeq` alone records server-side ordering.
6. **Guard fail-closed inversion:** `[AllowAnonymous]` attributes on `register`/`login`/`refresh`/`logout`; `HouseholdGuardMiddleware` skips ONLY when the endpoint carries `IAllowAnonymousData` (or is un-endpointed infrastructure like `/health`, which has no auth metadata and no authenticated user — the `IsAuthenticated` precondition still applies first); everything else with an authenticated user is guarded. Existing guard tests must pass unchanged; a new test proves `[Authorize]`-less-but-authenticated endpoints are now guarded (the sync controller itself, temporarily probed, or a metadata-level unit assertion).
7. **House patterns:** `Sync/` feature folder (`SyncController`, `ISyncService`/`SyncService`, DTOs), integration suite on the shared rig, compose smoke extended with a two-device push/pull round trip.

## Components

- `Domain`: `SyncSeq long` on the three entities (children untouched). `Data`: Postgres sequence + BEFORE INSERT/UPDATE triggers (migration SQL) + `(HouseholdId, SyncSeq)` indexes; migration `AddSyncSeq`. No interceptor; no join re-home special case (the trigger covers ExecuteUpdate).
- `Sync/`: `SyncController` (`changes`, `push`), `ISyncService`/`SyncService` (delta query, LWW application, cursor computation), DTOs (`SyncPullResponse`, `SyncPushRequest`, per-type row records with epoch-ms timestamps, `SyncRowOutcome`).
- `Auth/`: `[AllowAnonymous]` on the four endpoints. `Common/HouseholdGuardMiddleware`: inverted check.
- Tests: `Integration/SyncApiTests.cs` (the scenario list from the design conversation), guard-inversion additions to `HouseholdGuardTests`; validator reuse means no new validator files.
- Docs: README sync section; TESTING.md manual checklist.

## Error handling

House pattern. Push: whole-batch 400 on any invalid row (`ValidationProblemDetails`); per-row `superseded`/`conflict` are successful-response outcomes. Pull is read-only and cannot 4xx beyond auth/guard.

## Testing

Integration: full pull from zero (content + tombstones + cursor); incremental pull returns only post-cursor changes; CRUD writes surface in pulls (interceptor proof); push-insert / LWW-win / LWW-lose (superseded, then server version arrives on next pull); tombstone-vs-edit both directions; cross-household id → `conflict`; recipe aggregate round-trips through push+pull with children; epoch-ms timestamps round-trip verbatim; join re-home rows appear in the target household's next pull (explicit `SyncSeq` proof); guard fail-closed + escape hatch intact. Compose smoke: register two devices (same user), push from one, pull from the other, verify convergence.

## Rollout

Feature branch `feature/sync-endpoints` off `develop`. Compose volumes: documented `down -v` (new column + sequence). Frontend untouched.
