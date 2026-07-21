# Meal-Plan & Shopping Endpoints — Design Spec

**Date:** 2026-07-21
**Slice:** Completes the backend content surface (Phase 4 tail / Phase 5 prerequisite): meal-plan entries and shopping items as household-scoped stores, plus two earmarked hardening items whose "pre-Phase 5" moment this is.
**Scope:** Two dumb, sync-shaped CRUD surfaces mirroring the frontend schemas with server-side tombstones; a structural one-household-per-user guarantee; stale-claim requests turned into clean 401s.
**Builds on:** recipes/auth/household slices — `ServiceResult`, FluentValidation-in-controller, household claim scoping, client-minted Guids, soft-delete pattern, Testcontainers rig; frontend schemas (`frontend/lib/db/schema.ts`: `meal_plan_entries`, `shopping_items`).

## Goals

- Every content type the app has exists server-side, household-scoped, before sync work begins — recipes, meal plans, shopping — all with the same contract (client Guids, full-replace PUT, tombstone DELETE).
- The server stays a replicated row store: all shopping/meal-plan *behavior* (merge-on-add, shelf grouping, purchase flows, aggregation) remains the client logic it already is; sync will push states, not commands.
- Close the two tracked structural gaps while they're cheap: membership uniqueness at the DB level, and stale-household tokens failing clean (401) instead of weird (500/empty).

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Operation endpoints (purchase, restore, re-add, add-week) | Never planned — client logic; sync replicates row states |
| Server-side aggregation / shelf logic | Same |
| Frontend `deletedAt` columns and API consumption | Phase 5 prep |
| Settings/preferences endpoints (units, week start) | Later slice, likely alongside sync |
| Timestamp conveyance (client-authored timestamps) | Phase 5 sync design (already noted for recipes) |
| Per-request household check caching | Revisit in the sync slice if the extra query matters |

## Key decisions

1. **`MealPlanEntry`:** Guid `Id`, `HouseholdId` (required FK, cascade), `Date` as `DateOnly` (Postgres `date`; serializes as the ISO `yyyy-MM-dd` string the frontend already uses), `RecipeId` (required FK, cascade — inert in practice since recipes only soft-delete), `Servings` int ≥ 1, `SortOrder` int ≥ 0, `CreatedAt`/`UpdatedAt`/`DeletedAt` with the recipes-style soft-delete query filter. Index on `(HouseholdId, Date)`.
2. **`ShoppingItem`:** Guid `Id`, `HouseholdId` (required FK, cascade), `Name`/`NormalizedName` required ≤ 500, `Quantity` nullable decimal > 0 when present, `Unit` nullable ≤ 50, `Sources` required string defaulting `"[]"` (opaque client-owned JSON, ≤ 4000), `Status` enum `Active|Purchased` stored lowercase text, `PurchasedAt` nullable, timestamps + `DeletedAt` + query filter. Index on `(HouseholdId, Status)`. The server does not enforce status↔purchasedAt consistency — client-owned semantics.
3. **Endpoints — the recipes contract, twice.** `/api/v1/meal-plan-entries` and `/api/v1/shopping-items`, `[Authorize]`, household-scoped: `GET /` list (non-deleted, household only — meal plan ordered by `Date` then `SortOrder` and accepting optional `from`/`to` `DateOnly` query filters; shopping ordered by `UpdatedAt` desc), `GET /{id}` (404 missing/deleted/foreign), `POST` (client Guid honored, duplicate id → 409 global-check like recipes, 201), `PUT /{id}` full replace bumping `UpdatedAt` (404 semantics as get), `DELETE /{id}` soft + idempotent (already-deleted 204, never-existed 404).
4. **One referential rule:** a meal-plan entry's `RecipeId` must resolve to a non-deleted recipe in the caller's household, checked on create and update; nonexistent and foreign ids produce the identical validation-style 400 (no existence oracle). (Recipes may be soft-deleted *later* while entries reference them — allowed, mirrors the frontend where the join simply stops matching.)
5. **Structural membership uniqueness.** New migration adds a **deferrable** unique constraint on `HouseholdMembers.UserId` (raw SQL: `UNIQUE ... DEFERRABLE INITIALLY DEFERRED`) — one household per user is now impossible to violate at rest, while the join flow's remove+add inside one transaction stays legal (checked at commit). The existing `(UserId, HouseholdId)` index remains.
6. **Stale-claim requests → 401.** New `HouseholdGuardMiddleware` after authentication: for authenticated requests, verify the `household` claim parses and its row exists; otherwise 401 (client refreshes; refresh resolves membership fresh and returns correct claims). Replaces today's 500s/empty-lists during the ≤ 15-minute window after a user's old household dies. One indexed primary-key lookup per authenticated request — accepted; caching noted as deferred.
7. **House patterns, verbatim:** feature folders `MealPlan/` and `Shopping/`; controller validates → service → `ServiceResult`; DTO records; validators with unit matrices; integration suites on the shared rig; zero-warning/green bar; compose smoke extended with an authenticated meal-plan-entry + shopping-item create.

## Components

### `backend/Ingredo.Api/Domain/` — `MealPlanEntry`, `ShoppingItem`, `ShoppingItemStatus` enum.

### `backend/Ingredo.Api/Data/` — DbContext config per decisions 1–2; migration `AddMealPlanAndShopping` (tables) + the decision-5 deferrable constraint (same migration, `migrationBuilder.Sql`).

### `backend/Ingredo.Api/MealPlan/` — `MealPlanController`, `IMealPlanService`/`MealPlanService`, DTOs (`MealPlanEntryRequest/Response`), validators.

### `backend/Ingredo.Api/Shopping/` — `ShoppingController`, `IShoppingService`/`ShoppingService`, DTOs (`ShoppingItemRequest/Response`), validators.

### `backend/Ingredo.Api/Common/` — `HouseholdGuardMiddleware` (decision 6), registered after `UseAuthentication`/`UseAuthorization`.

### `backend/Ingredo.Api.Tests/` — `Integration/MealPlanApiTests.cs`, `Integration/ShoppingApiTests.cs`, `Integration/HouseholdGuardTests.cs` (the dead-household-token 401 scenario), validator test files.

### Docs — README sections; `docs/TESTING.md` manual checklist; compose smoke additions.

## Error handling

House pattern throughout; the referential 400 uses `ValidationProblemDetails` with a `RecipeId` key; the guard middleware writes a bare 401 (no body) matching the bearer challenge style.

## Testing

Integration per surface: CRUD round-trip; cross-tenant isolation (list absence + 404s on get/put/delete); soft-delete semantics incl. idempotent delete and list exclusion; duplicate-id 409; validation 400s (servings 0, blank name, negative sortOrder, bad status, quantity 0); meal-plan `from`/`to` filtering and ordering; cross-household and nonexistent `RecipeId` → identical 400. Guard: dead-household token → 401 on recipes, meal-plan, shopping, and household endpoints; fresh token works. Existing join/leave scenarios re-verify the deferrable constraint doesn't break membership moves. Validator matrices. Full pass + extended compose smoke.

## Rollout

Feature branch `feature/content-endpoints` off `develop`. Compose volumes: documented `down -v` (new tables + constraint). Frontend and theme branches untouched.
