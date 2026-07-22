# Frontend Sync-Prep — Design Spec

**Date:** 2026-07-22
**Slice:** Phase 5 slice ① (see `2026-07-22-sync-architecture.md`). Pure local frontend work: the schema and repository changes sync requires, with zero behavior change visible in the UI.
**Scope:** `deleted_at` + `dirty` columns on the three synced tables, hard deletes converted to tombstones, `deletedAt IS NULL` filters everywhere reads happen, and dirty stamping on every write.
**Builds on:** frontend SQLite schema (`frontend/lib/db/schema.ts`), drizzle migrations, the repository modules (`recipes.ts`, `mealPlan.ts`, `shoppingList.ts`), the existing test suite (236 tests).

## Goals

- After this slice, the local database is sync-shaped: every synced row can express "deleted" without vanishing, and "changed since last push" without an operation log.
- Nothing a user can see changes: every screen, flow, and existing test behaves identically (tombstoned rows are invisible; dirty flags are inert until the engine slice reads them).

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Reading the dirty flag / clearing it / any network | Engine slice ④ |
| `lastSyncCursor` settings key | Engine slice ④ (schema needs nothing now — settings is key-value) |
| Auth/token storage | Slice ③ |
| Tombstone garbage collection | Post-Phase 5 housekeeping |
| Sync metadata on recipe children | Never — children ride the recipe aggregate (architecture decision 3) |

## Key decisions

1. **Schema:** one drizzle migration adds `deleted_at integer` (nullable) to `meal_plan_entries` and `shopping_items` (recipes already has it), and `dirty integer NOT NULL DEFAULT 1` to `recipes`, `meal_plan_entries`, `shopping_items`. Default 1 is deliberate: pre-existing local rows are born needing upload — exactly what the adoption flow (slice ④) wants, at zero migration-backfill cost. Children (`recipe_ingredients`, `recipe_instructions`) and `settings` get nothing.
2. **Tombstones replace hard deletes.** `deletePlanEntry` and any shopping-item removal path set `deletedAt = now, updatedAt = now, dirty = 1` instead of deleting. Recipes' existing `softDeleteRecipe` gains only the dirty stamp. Recipe children keep their delete-and-reinsert behavior inside `updateRecipe` (aggregate replace, unchanged).
3. **Filters:** every repository read and every live query over the three tables gains `isNull(deletedAt)` (recipes queries already have it — verify rather than assume). The shelf's purchased-history queries keep working: `status = 'purchased'` rows are NOT deleted rows; tombstones are a distinct, invisible state.
4. **Dirty stamping is a repository invariant:** every function that inserts or mutates a synced row sets `dirty = 1` in the same statement. No screen code changes — the flag is set where writes already happen. (The engine clears it after push; until then it is inert.)
5. **Cascade semantics preserved:** the frontend FK cascade from recipes to meal-plan entries can no longer fire via SQL (recipes are only tombstoned), matching current reality; plan entries referencing a tombstoned recipe stay, and the existing display joins already hide them — verified by existing plan-screen tests.
6. **Testing:** repository tests updated/extended per table — delete leaves the row present with `deletedAt` set and `updatedAt` bumped and `dirty = 1`; reads exclude tombstones; create/update stamp dirty; recipes' children behavior unchanged. Screen tests must pass untouched (behavior-invisible bar). Full frontend pass: suite, lint zero warnings, `tsc`, android bundle export.

## Components

- `frontend/lib/db/schema.ts` + generated drizzle migration.
- `frontend/lib/db/recipes.ts`, `mealPlan.ts`, `shoppingList.ts` — filters + stamping + tombstone deletes.
- Any screen-level live queries over the three tables (`shop.tsx`, plan screens, recipes screens) — add the tombstone filter where the query is composed if not already covered by repository helpers.
- Tests: the three repository test files; screen tests untouched (must stay green as-is).

## Error handling

Unchanged — synchronous SQLite writes throw per app pattern.

## Testing

Per decision 6. The headline assertion class is new: "delete hides but preserves." Everything else is regression-invariance.

## Rollout

Feature branch `feature/frontend-sync-prep` off `develop`, merged per the usual flow. The frontend dev database migrates in place (additive columns); no data loss. Theme branches unaffected (no `lib/theme.js` contact); they can be rebased opportunistically or left until the poll concludes.
