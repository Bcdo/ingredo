# Frontend Sync-Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local database sync-shaped — `deleted_at` + `dirty` columns on the three synced tables, hard deletes converted to tombstones, tombstone filters on every read, dirty stamping on every write — with zero user-visible behavior change (all existing screen tests pass untouched).

**Architecture:** One drizzle migration; repository-level changes in `lib/db/{recipes,mealPlan,shoppingList}.ts`; `isNull(deletedAt)` added to the handful of screen-composed live queries. The `dirty` flag is written everywhere and read nowhere (engine slice ④ consumes it). Discovered facts the spec left open: shopping has NO hard-delete path (status changes only) — it gets columns/filters/stamping but no delete conversion; meal plan's `removePlanEntry` is the sole hard delete; `nextSortOrder` and `addItems`' active-row scan are non-obvious reads that need filters.

**Tech Stack:** Expo SDK 54, drizzle-orm + drizzle-kit (expo driver), better-sqlite3 in tests, Jest.

**Spec:** `docs/superpowers/specs/2026-07-22-frontend-sync-prep-design.md` (+ umbrella `2026-07-22-sync-architecture.md`)

## Global Constraints

- Schema: `deleted_at integer` (nullable) on `meal_plan_entries` + `shopping_items`; `dirty integer NOT NULL DEFAULT 1` on `recipes`, `meal_plan_entries`, `shopping_items`. Children and `settings` untouched. Default 1 is the adoption backfill — do not change it.
- Tombstone delete = `{ deletedAt: now, updatedAt: now, dirty: 1 }` in one update. Every insert/update on a synced table sets `dirty: 1` in the same statement. No code reads `dirty` this slice.
- Every read over the three tables excludes tombstones (`isNull(deletedAt)`), including: `nextSortOrder`, `addItems`' active-row scan, all screen live queries. Recipes' existing filters are verified, not assumed.
- Behavior-invisible bar: ALL existing screen tests pass WITHOUT modification. Repository tests are updated/extended.
- Run all commands from `/home/mrb/Work/Programming/ingredo/frontend`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Modify: `lib/db/schema.ts` (+ generated `drizzle/0004_*.sql`, `drizzle/meta/*`, `drizzle/migrations.js`), `lib/db/mealPlan.ts`, `lib/db/shoppingList.ts`, `lib/db/recipes.ts`, and the screen queries in `app/(tabs)/index.tsx`, `app/(tabs)/plan.tsx`, `app/(tabs)/shop.tsx`, `app/plan/entry/[id].tsx`, `app/plan/pick-day.tsx`.
- Tests: extend `__tests__/meal-plan-repository.test.ts`, `__tests__/shopping-list-repository.test.ts`, `__tests__/recipes-repository.test.ts`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `lib/db/schema.ts`; generate migration artifacts.

**Interfaces:**
- Produces (used by Tasks 2–4): the three tables carry `deletedAt` (nullable int) and `dirty` (int, notNull, default 1) columns in both schema types and the migrated database.

- [ ] **Step 0: Create the feature branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/frontend-sync-prep
cd frontend
```

- [ ] **Step 1: Schema edits**

In `lib/db/schema.ts`:

1. In `recipes`, after `deletedAt: integer('deleted_at'),` add:

```ts
  dirty: integer('dirty').notNull().default(1),
```

2. In `mealPlanEntries`, after `updatedAt: integer('updated_at').notNull(),` add:

```ts
    deletedAt: integer('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
```

3. In `shoppingItems`, after `updatedAt: integer('updated_at').notNull(),` add:

```ts
    deletedAt: integer('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
```

- [ ] **Step 2: Generate the migration**

```bash
npx drizzle-kit generate --name sync_prep
```

Expected: a new `drizzle/0004_sync_prep.sql` with five `ALTER TABLE ... ADD COLUMN` statements (recipes +dirty; meal_plan_entries +deleted_at +dirty; shopping_items +deleted_at +dirty), journal + snapshot updates, and a regenerated `drizzle/migrations.js`. Inspect the SQL to confirm exactly those five columns and the `DEFAULT 1 NOT NULL` on each `dirty`.

- [ ] **Step 3: Verify**

```bash
npm test
npm run lint
npx tsc --noEmit
```

Expected: 236 tests green unchanged (columns are additive; the test DB applies migrations via the shared helper — if `schema.test.ts` asserts column lists, update it to include the new columns and note that in the report). Zero warnings.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat: add sync metadata columns to synced tables"
```

---

### Task 2: Meal-plan repository — tombstone delete, filters, stamping

**Files:**
- Modify: `lib/db/mealPlan.ts`
- Test: extend `__tests__/meal-plan-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `removePlanEntry` tombstones; all meal-plan repo writes stamp dirty; `nextSortOrder` ignores tombstones.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/meal-plan-repository.test.ts` (reusing the file's existing `makeTestDb`/fixture helpers; add `mealPlanEntries` to the schema import if absent):

```ts
describe('sync prep', () => {
  it('remove tombstones the entry instead of deleting it', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db);
    const id = addPlanEntry(db, { date: '2026-07-22', recipeId, servings: 2 });

    removePlanEntry(db, id);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.updatedAt).toBe(row!.deletedAt);
    expect(row!.dirty).toBe(1);
  });

  it('tombstoned entries do not consume sort orders', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db);
    const first = addPlanEntry(db, { date: '2026-07-22', recipeId, servings: 2 });
    removePlanEntry(db, first);

    const second = addPlanEntry(db, { date: '2026-07-22', recipeId, servings: 2 });

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, second)).get();
    expect(row!.sortOrder).toBe(0);
  });

  it('writes stamp the dirty flag', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db);
    const id = addPlanEntry(db, { date: '2026-07-22', recipeId, servings: 2 });
    db.update(mealPlanEntries).set({ dirty: 0 }).where(eq(mealPlanEntries.id, id)).run();

    setPlanEntryServings(db, id, 6);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row!.dirty).toBe(1);
  });
});
```

(If the file has no `seedRecipe` helper, use whatever existing fixture inserts a recipe row and returns its id — read the file first and reuse its idiom; the test bodies above are the contract, the fixture call may be renamed to match.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- meal-plan-repository`
Expected: FAIL — `removePlanEntry` still hard-deletes (first test finds no row); sort-order test fails (tombstone consumed order 0 doesn't exist yet — actually fails because the row is gone; either failure mode is RED evidence).

- [ ] **Step 3: Implement**

In `lib/db/mealPlan.ts`:

1. Extend the drizzle import: `import { and, eq, isNull, sql } from 'drizzle-orm';`
2. `nextSortOrder`: change the `.where(...)` to

```ts
    .where(and(eq(mealPlanEntries.date, date), isNull(mealPlanEntries.deletedAt)))
```

3. `addPlanEntry`: add `dirty: 1,` to the inserted values.
4. `movePlanEntry` and `setPlanEntryServings`: add `dirty: 1,` to the `.set({...})` objects.
5. Replace `removePlanEntry`:

```ts
// Tombstone, not delete: the row must survive locally so sync can tell the
// server about the deletion (architecture decision 1).
export function removePlanEntry(db: DB, id: string): void {
  const now = Date.now();
  db.update(mealPlanEntries)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(mealPlanEntries.id, id))
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- meal-plan-repository`
Expected: PASS — existing tests plus the 3 new. (If an existing repo test asserts the row count after remove, it now needs the tombstone filter — update it and flag the change in the report.)

- [ ] **Step 5: Full green and commit**

```bash
npm test
npm run lint
npx tsc --noEmit
git add lib/db/mealPlan.ts __tests__/meal-plan-repository.test.ts
git commit -m "feat: tombstone meal plan deletes and stamp sync flags"
```

---

### Task 3: Shopping and recipes repositories — filters and stamping

**Files:**
- Modify: `lib/db/shoppingList.ts`, `lib/db/recipes.ts`
- Test: extend `__tests__/shopping-list-repository.test.ts`, `__tests__/recipes-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: every shopping/recipes repo write stamps dirty; `addItems`' active scan ignores tombstones; `softDeleteRecipe` stamps dirty. (Shopping has NO delete path — deliberately unchanged.)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/shopping-list-repository.test.ts`:

```ts
describe('sync prep', () => {
  it('writes stamp the dirty flag on insert, merge, purchase, and restore', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const row = allRows(db)[0];
    expect(row.dirty).toBe(1);

    db.update(shoppingItems).set({ dirty: 0 }).where(eq(shoppingItems.id, row.id)).run();
    purchaseItem(db, row.id);
    expect(allRows(db)[0].dirty).toBe(1);

    db.update(shoppingItems).set({ dirty: 0 }).where(eq(shoppingItems.id, row.id)).run();
    restoreItem(db, row.id);
    expect(allRows(db)[0].dirty).toBe(1);
  });

  it('tombstoned active rows are invisible to merge', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const buried = allRows(db)[0];
    db.update(shoppingItems)
      .set({ deletedAt: Date.now() })
      .where(eq(shoppingItems.id, buried.id))
      .run();

    addItems(db, [item({ quantity: 200 })], 'merge');

    const rows = allRows(db);
    expect(rows).toHaveLength(2); // fresh row inserted; tombstone NOT merged into
    const live = rows.find((r) => r.deletedAt === null)!;
    expect(live.quantity).toBe(200);
  });
});
```

Append to `__tests__/recipes-repository.test.ts` (reusing its existing create/update fixtures):

```ts
describe('sync prep', () => {
  it('create, update, and soft delete stamp the dirty flag', () => {
    const db = makeTestDb();
    const id = createRecipe(db, sampleInput());
    expect(db.select().from(recipes).where(eq(recipes.id, id)).get()!.dirty).toBe(1);

    db.update(recipes).set({ dirty: 0 }).where(eq(recipes.id, id)).run();
    updateRecipe(db, id, sampleInput());
    expect(db.select().from(recipes).where(eq(recipes.id, id)).get()!.dirty).toBe(1);

    db.update(recipes).set({ dirty: 0 }).where(eq(recipes.id, id)).run();
    softDeleteRecipe(db, id);
    const row = db.select().from(recipes).where(eq(recipes.id, id)).get()!;
    expect(row.dirty).toBe(1);
    expect(row.deletedAt).not.toBeNull();
  });
});
```

(As in Task 2: reuse each file's actual fixture names — `sampleInput()`/`item()`/`allRows()` stand for the file's existing helpers; adapt names, keep assertions.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- shopping-list-repository && npm test -- recipes-repository`
Expected: FAIL — dirty stays 0 after writes (no stamping yet); the tombstone-merge test merges into the buried row (no filter yet).

- [ ] **Step 3: Implement**

`lib/db/shoppingList.ts`:

1. Extend the drizzle import with `and, isNull`.
2. `addItems`' active-row scan: `.where(and(eq(shoppingItems.status, 'active'), isNull(shoppingItems.deletedAt)))`.
3. Add `dirty: 1,` to: the insert in `addItems`, the merge `.set({...})` in `addItems`, `purchaseItem`'s set, `restoreItem`'s set, and `readdItem`'s insert path (it routes through `addItems` — verify and note; if it inserts directly, stamp there).

`lib/db/recipes.ts`:

1. `createRecipe`'s recipe insert values: add `dirty: 1,`.
2. `updateRecipe`'s recipe `.set({...})`: add `dirty: 1,`.
3. `softDeleteRecipe`: add `dirty: 1` to the existing `{ deletedAt: now, updatedAt: now }` set.
4. Children (`recipeIngredients`/`recipeInstructions`) get NO changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shopping-list-repository && npm test -- recipes-repository`
Expected: PASS with the new tests.

- [ ] **Step 5: Full green and commit**

```bash
npm test
npm run lint
npx tsc --noEmit
git add lib/db/shoppingList.ts lib/db/recipes.ts __tests__/shopping-list-repository.test.ts __tests__/recipes-repository.test.ts
git commit -m "feat: stamp sync flags in shopping and recipe repositories"
```

---

### Task 4: Screen-query tombstone filters, full verification, checklist

**Files:**
- Modify: `app/(tabs)/index.tsx`, `app/(tabs)/plan.tsx`, `app/(tabs)/shop.tsx`, `app/plan/entry/[id].tsx`, `app/plan/pick-day.tsx`, root `docs/TESTING.md`

**Interfaces:**
- Consumes: everything.
- Produces: no screen can render a tombstoned row; the behavior-invisible bar proven.

- [ ] **Step 1: Add `isNull(<table>.deletedAt)` to each screen-composed query**

For each site below, add the tombstone condition to the query's `where` (wrapping any existing condition with `and(...)`; add `and`/`isNull` to that file's drizzle import as needed). Read each query before editing — these are one-line where-clause changes, nothing else:

- `app/(tabs)/index.tsx` — the `mealPlanEntries` live query (~line 30).
- `app/(tabs)/plan.tsx` — BOTH `mealPlanEntries` queries (~lines 31, 55) and the `shoppingItems` query (~line 71).
- `app/(tabs)/shop.tsx` — both `shoppingItems` live queries (~lines 43, 50; the active and purchased lists).
- `app/plan/entry/[id].tsx` — the `mealPlanEntries` query (~line 27).
- `app/plan/pick-day.tsx` — the by-id entry lookup (~line 34): a tombstoned entry must behave exactly like a missing one.

(`app/(tabs)/recipes.tsx`, `app/plan/add.tsx`, `app/recipe/[id]/index.tsx`, and `lib/dev/sampleData.ts` already filter on `recipes.deletedAt` — verify, don't touch unless a recipes query is genuinely missing the filter.)

- [ ] **Step 2: The behavior-invisible proof**

Run: `npm test`
Expected: the FULL suite green with ZERO changes to any screen test file — this is the slice's bar. If a screen test fails, the change was not behavior-invisible: stop and reconcile (fixtures in screen tests don't set `deletedAt`, so live queries should return them exactly as before).

- [ ] **Step 3: Full verification**

```bash
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: zero warnings, clean, bundle exports.

- [ ] **Step 4: Append the manual checklist**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Frontend sync-prep (manual pass)

- Everything behaves exactly as before: plan a meal, remove it (it disappears from every screen), shop, purchase, re-add, edit and delete a recipe.
- The one observable-by-tooling difference: removed plan entries survive in the database as tombstones (`deleted_at` set) — verifiable with a SQLite browser, invisible in the app.
- Kill and relaunch after the update: the migration applies silently, existing data intact.
```

- [ ] **Step 5: Commit**

```bash
git add 'app/(tabs)/index.tsx' 'app/(tabs)/plan.tsx' 'app/(tabs)/shop.tsx' 'app/plan/entry/[id].tsx' app/plan/pick-day.tsx ../docs/TESTING.md
git commit -m "feat: hide tombstoned rows from all screen queries"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (columns + default-1 adoption backfill → T1), 2 (tombstone deletes; shopping has none — documented discovery → T2/T3), 3 (filters incl. the non-obvious `nextSortOrder` and `addItems` scan + all screen queries → T2–T4), 4 (dirty stamping as repo invariant → T2–T3), 5 (cascade semantics — nothing to change, recipes only tombstone; plan-entry-referencing-tombstoned-recipe hiding is existing join behavior, regression-covered by untouched plan-screen tests), 6 (test strategy: repository assertions new, screen tests untouched → T2–T4).
- **Known judgment calls:** test snippets reference each file's fixture helpers by representative names with an explicit adapt-the-names instruction — the assertions are the contract (a deviation from fully-verbatim test code, justified because three test files' local idioms vary and inventing them blind would guarantee wrong names). `updatedAt === deletedAt` asserted on tombstone (same `now`). The shelf keeps showing purchased rows (status filter ≠ tombstone filter — the new condition is additive and purchased rows have `deletedAt = null`). `pick-day`'s by-id lookup treats tombstoned as missing — the only place a tombstone could otherwise resurface. `drizzle-kit generate --name` produces deterministic file naming; `migrations.js` regeneration is expected churn (established from earlier slices).
- **Type consistency check:** `dirty` is `integer` 0/1 (SQLite has no bool) consistent with the codebase's `status`-style text/int conventions; new columns are additive so `$inferSelect` row types gain fields without breaking existing destructuring; all edits use the same `and`/`isNull` drizzle operators already imported elsewhere in the codebase.
