# Frontend Household Partitioning — Design Spec

**Date:** 2026-07-27
**Slice:** multi-household slice ② (see `2026-07-27-multi-household-architecture.md`). The frontend half of data locality: every local content row belongs to a household partition, every read and write is scoped to the device's active partition, and the never-signed-in bucket is `NULL`.
**Scope:** local schema + migration, active-partition store, query/repo scoping, interim sync-tagging compatibility. No per-household cursors (slice ③), no switcher UI or recipe copy (slice ④), no user-visible behavior change.
**Builds on:** the drizzle/expo-sqlite schema (`lib/db/schema.ts`, migrations `0000`–`0004` run in `app/_layout.tsx`), the `notDeleted()` single-predicate rule (`lib/db/predicates.ts`), the repo layer (`lib/db/{recipes,mealPlan,shoppingList}.ts`), `useLiveQuery` screens, the sync engine (`lib/sync/*` — single cursor, `sync_household_id` bookkeeping, `ensureHousehold` adoption, `apply.ts` writers, `remint.ts`), the suggestions heuristics (`lib/suggestions/*`), the module-state + `useSyncExternalStore` idiom (`lib/api/session.ts`, `lib/locale.ts`), and slice ①'s backend (per-family active household, additive membership).

## Goals

- The three synced tables carry `household_id`; existing rows are backfilled from the device's synced household (`NULL` when never synced).
- Every content read/write in repos, screens, suggestions, and dev seeding is scoped to the device's active partition — two households' rows on one device never mix.
- The active partition survives restarts and sign-out (last-active household stays visible and editable, local-first); a device that has never signed in works entirely in the `NULL` bucket.
- The current single-cursor sync engine keeps working bit-for-bit: today the whole device is one household, and the interim tagging preserves exactly that.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Per-household cursors; scoped collect; retiring switch-as-adoption/re-mint churn | Slice ③ |
| Switcher UI, create/join/leave surfaces, recipe copy | Slice ④ |
| Background sync of non-active households | Umbrella non-goal |
| Settings partitioning | Umbrella non-goal (settings stay device-local) |

## Key decisions

1. **Schema: nullable `household_id` on the three synced tables** — `recipes`, `meal_plan_entries`, `shopping_items` — each with an index on the new column. Ingredient/instruction children get NO column: they are only ever reached through their parent recipe (schema cascade + repo joins), so the parent's partition scopes them. `NULL` means the local/never-signed-in bucket, not "unknown".
2. **Migration `0005`: add + backfill in one step.** `ALTER TABLE … ADD COLUMN household_id text` (+ indexes), then backfill every existing row from the `settings` table's `sync_household_id` value — the household this device has synced with. Never-synced devices have no such setting, so rows stay `NULL`: exactly the bucket semantics. The backfill is plain SQL inside the migration (drizzle migrations are SQL files), so it runs atomically with the schema change on first launch after upgrade.
3. **Active-partition store: new `lib/household.ts`,** module-state + `useSyncExternalStore` (the session/locale idiom). API: `getActiveHouseholdId(): string | null`, `useActiveHouseholdId()`, `setActiveHouseholdId(id: string | null)`, plus an init that loads the persisted value at startup (alongside migrations in `_layout.tsx`). Persistence: `settings` key `active_household_id` — device-local bookkeeping like the sync keys, excluded from any future settings sync. Semantics: follows the session's `householdId` whenever it changes to a non-null value (sign-in, join/leave/switch token rotations — wired via `subscribeSession`, the realtime module's existing pattern); sign-OUT does NOT clear it (last-active household stays visible and editable); it is `null` only on a device that has never signed in. Slice ④'s switcher will call `setActiveHouseholdId` directly; nothing in this slice changes it except session-follow.
4. **Scoping predicate: `inHousehold(table, householdId)`** in `lib/db/predicates.ts`, sibling of `notDeleted()`: `eq(table.householdId, id)` when non-null, `isNull(table.householdId)` for the bucket. Same grep-enforceable rule — no `household_id` comparison outside the predicates file (sync modules excepted: they tag and re-tag, they don't filter reads by partition in this slice).
5. **Repos take the partition explicitly.** Every repo read AND write function gains a `householdId: string | null` parameter (house style: `db` is already explicit; explicit beats hidden module reads for testability). Creates stamp `householdId` onto new rows; reads add `inHousehold(...)` beside the existing `notDeleted(...)`; id-addressed updates/deletes also filter by partition (defense in depth — a stale screen holding a foreign id must no-op, not cross partitions). Screens pass `useActiveHouseholdId()` into their `useLiveQuery` queries — the query object changes on switch, so live queries re-run automatically. Suggestions modules (`staples`/`recipeIdeas`/`habits`) and `lib/dev/sampleData.ts` take the same parameter.
6. **Interim sync tagging keeps today's semantics exactly.** The single-cursor engine remains authoritative until slice ③; this slice only teaches it the column:
   - `apply.ts`: every pulled row (upsert path) is stamped with the pulled household id (the engine already threads it to `storePullResult`).
   - `ensureHousehold` (adoption on household change): in the same step that marks everything dirty, re-tag ALL rows in the three tables — `NULL` bucket included — to the new household. Today the whole device belongs to one household; this states that in the column. First sign-in therefore adopts the `NULL` bucket into the first household (current behavior, kept).
   - `collect.ts` stays unscoped (all dirty rows): after adoption re-tag, every row is in the synced household, so scoping would be a no-op — slice ③ introduces real scoped collect with per-household cursors.
   - `remint.ts` re-mints within the device as today; re-minted copies keep their source row's `household_id`.
7. **Type ripple is mechanical.** Row types (`RecipeRow` etc.) gain `householdId: string | null`; test fixtures and chain-stub db mocks gain the column/parameter. No screen changes beyond threading the hook value into queries and repo calls.
8. **Compatibility invariant (the slice's headline):** with a single household — every device today — the app behaves identically before and after this slice: same visible rows, same sync payloads, same adoption flow. Partition effects become observable only when slice ④ lets a user hold two households.

## Components

- `lib/db/schema.ts` (+`householdId` on three tables, +indexes), `drizzle/0005_*.sql` (+meta journal), migration wiring untouched (`_layout.tsx` already runs migrations).
- `lib/household.ts` (new store) + init call in `app/_layout.tsx`.
- `lib/db/predicates.ts` (`inHousehold`), `lib/db/{recipes,mealPlan,shoppingList}.ts`, `lib/db/types.ts`.
- Screens with content queries: `app/(tabs)/{index,recipes,plan,shop}.tsx`, `app/recipe/[id]/index.tsx`, `app/plan/{add,pick-day}.tsx`, `app/plan/entry/[id].tsx`, `app/habits.tsx` (via suggestions), plus any components issuing repo calls.
- `lib/sync/{apply,cursor}.ts` (tagging + adoption re-tag), `lib/sync/remint.ts` (carry column).
- `lib/suggestions/{staples,recipeIdeas,habits}.ts`, `lib/dev/sampleData.ts`.
- Tests: migration backfill (synced vs. fresh), partition isolation per repo, store behavior across sign-in/sign-out/never-signed-in, sync tagging + adoption re-tag, updated fixtures/mocks.

## Error handling

No new failure modes: the store falls back to `null` when the setting is absent; repos treat an unknown partition as an empty partition (queries simply return nothing). No new error surfaces or copy.

## Testing

Jest + better-sqlite3 for db-level tests (house pattern), RNTL for the hook. Headline invariants: (a) two partitions plus the `NULL` bucket never bleed into each other through any repo function; (b) a migrated synced device sees every pre-existing row in its household, a fresh install sees them in `NULL`; (c) single-household end-to-end behavior is unchanged — the existing 416 tests keep passing with only mechanical fixture updates.

## Rollout

Feature branch `feature/frontend-partitioning` off `develop`. Existing devices upgrade via migration `0005` on next launch; no backend coordination required (slice ② is deployable before or after slice ① reaches any server). Bilingual surface untouched — no new user-facing strings.
