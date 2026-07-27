# Frontend Household Partitioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every local content row carries a `household_id` partition; every read and write is scoped to the device's active partition; the never-signed-in bucket is `NULL`; the current single-cursor sync engine keeps working bit-for-bit.

**Architecture:** Nullable `household_id` on the three synced tables (children scope via their parent recipe), backfilled by migration `0005` from the `sync_household_id` setting. A new module-state store (`lib/household.ts`) holds the active partition, follows the session, and survives sign-out. A single `inHousehold()` predicate beside `notDeleted()` scopes every repo/screen/suggestions query; repos take the partition as an explicit parameter. Interim sync: `apply` tags pulled rows, adoption re-tags everything, `collect` stays unscoped until slice ③.

**Tech Stack:** Expo SDK 54, drizzle/expo-sqlite (better-sqlite3 in tests), drizzle-kit migrations, Jest + RNTL, `useSyncExternalStore` module-state idiom.

**Spec:** `docs/superpowers/specs/2026-07-27-frontend-partitioning-design.md`

## Global Constraints

- **No new user-facing strings** — the app is bilingual (nb/en); this slice must not touch `lib/i18n` or add visible copy.
- **Single-household behavior unchanged (headline invariant):** with one household — every device today — visible rows, sync payloads, and the adoption flow are identical before and after this slice.
- **`household_id` comparisons live ONLY in `lib/db/predicates.ts` (`inHousehold`)** — grep for `householdId` in query `where`s outside predicates must return nothing. Exception: `lib/sync/*` tags and re-tags rows (writes `householdId` in `set`/`values`), but never filters reads by partition in this slice.
- **Children tables (`recipe_ingredients`, `recipe_instructions`) get NO `household_id` column** — they are only reached through their parent recipe.
- **Sign-out does NOT clear the active household** — last-active stays visible and editable. The store is `null` only on a device that has never signed in.
- **`active_household_id` is device-local bookkeeping** in the `settings` table (like `sync_cursor`) — excluded if settings ever sync.
- **Repo signature convention:** the partition parameter is named `householdId: string | null` and comes immediately after `db` in every changed function.
- Run all frontend commands from `frontend/`. Test suite baseline: 416 passing. Each task ends with `npm test` green and a commit.

---

### Task 1: Schema column + migration 0005 with backfill

**Files:**
- Modify: `frontend/lib/db/schema.ts`
- Generate+Modify: `frontend/drizzle/0005_household_partitions.sql` (+ `frontend/drizzle/meta/0005_snapshot.json`, `frontend/drizzle/meta/_journal.json`, `frontend/drizzle/migrations.js` — all updated by drizzle-kit)
- Test: `frontend/__tests__/household-migration.test.ts` (new)

**Interfaces:**
- Produces: `recipes.householdId`, `mealPlanEntries.householdId`, `shoppingItems.householdId` — all `text('household_id')`, nullable; row types (`RecipeRow` etc.) gain `householdId: string | null` via `$inferSelect`. Later tasks rely on these exact property names.

- [ ] **Step 1: Add the column + index to the three synced tables in `schema.ts`**

`recipes` gains a table-config callback (it has none today); the other two extend theirs:

```ts
export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    servings: integer('servings').notNull().default(4),
    notes: text('notes'),
    householdId: text('household_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
  },
  (table) => [index('recipes_household_idx').on(table.householdId)]
);
```

In `mealPlanEntries`, add `householdId: text('household_id'),` after `sortOrder` and extend the config array:

```ts
  (table) => [
    index('meal_plan_entries_date_idx').on(table.date),
    index('meal_plan_entries_household_idx').on(table.householdId),
  ]
```

In `shoppingItems`, add `householdId: text('household_id'),` after `purchasedAt` and extend the config array:

```ts
  (table) => [
    index('shopping_items_status_idx').on(table.status, table.normalizedName),
    index('shopping_items_household_idx').on(table.householdId),
  ]
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name household_partitions`
Expected: creates `drizzle/0005_household_partitions.sql`, `drizzle/meta/0005_snapshot.json`, appends an entry to `drizzle/meta/_journal.json`, and adds `m0005` to `drizzle/migrations.js`. The generated SQL should be three `ALTER TABLE … ADD \`household_id\` text;` statements and three `CREATE INDEX` statements separated by `--> statement-breakpoint`.

- [ ] **Step 3: Append the backfill to the generated SQL file**

Edit `drizzle/0005_household_partitions.sql` — append (after a `--> statement-breakpoint` following the last generated statement):

```sql
UPDATE `recipes` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
UPDATE `meal_plan_entries` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
UPDATE `shopping_items` SET `household_id` = (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id');
```

A never-synced device has no `sync_household_id` row, so the subquery yields `NULL` and rows stay in the `NULL` bucket — exactly the spec's semantics. The SQL file is bundled via babel inline-import, so the edit ships.

- [ ] **Step 4: Write the migration test**

`__tests__/household-migration.test.ts` — applies migrations `0000`–`0004` raw, seeds legacy rows, then applies `0005` and asserts the backfill. Uses the journal to enumerate files so future migrations don't break it:

```ts
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

import journal from '../drizzle/meta/_journal.json';

function applyMigration(sqlite: InstanceType<typeof Database>, tag: string): void {
  const sql = readFileSync(join(__dirname, '..', 'drizzle', `${tag}.sql`), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    sqlite.exec(statement);
  }
}

const tags = journal.entries.map((entry) => entry.tag);
const legacyTags = tags.filter((tag) => !tag.startsWith('0005'));
const partitionTag = tags.find((tag) => tag.startsWith('0005'))!;

function makeLegacyDb(): InstanceType<typeof Database> {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const tag of legacyTags) applyMigration(sqlite, tag);
  return sqlite;
}

function seedContent(sqlite: InstanceType<typeof Database>): void {
  sqlite
    .prepare(
      `INSERT INTO recipes (id, title, servings, created_at, updated_at, dirty)
       VALUES ('r1', 'Tacos', 4, 1, 1, 0)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO meal_plan_entries (id, date, recipe_id, servings, sort_order, created_at, updated_at, dirty)
       VALUES ('e1', '2026-07-27', 'r1', 4, 0, 1, 1, 0)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO shopping_items (id, name, normalized_name, sources, status, created_at, updated_at, dirty)
       VALUES ('s1', 'Melk', 'melk', '[]', 'active', 1, 1, 0)`
    )
    .run();
}

describe('migration 0005 backfill', () => {
  it('tags every existing row with the synced household', () => {
    const sqlite = makeLegacyDb();
    seedContent(sqlite);
    sqlite
      .prepare(`INSERT INTO settings (key, value) VALUES ('sync_household_id', 'h1')`)
      .run();

    applyMigration(sqlite, partitionTag);

    for (const table of ['recipes', 'meal_plan_entries', 'shopping_items']) {
      const row = sqlite.prepare(`SELECT household_id FROM ${table}`).get() as {
        household_id: string | null;
      };
      expect(row.household_id).toBe('h1');
    }
  });

  it('leaves a never-synced device in the NULL bucket', () => {
    const sqlite = makeLegacyDb();
    seedContent(sqlite);

    applyMigration(sqlite, partitionTag);

    for (const table of ['recipes', 'meal_plan_entries', 'shopping_items']) {
      const row = sqlite.prepare(`SELECT household_id FROM ${table}`).get() as {
        household_id: string | null;
      };
      expect(row.household_id).toBeNull();
    }
  });
});
```

- [ ] **Step 5: Run the new test and the full suite**

Run: `npm test -- household-migration`
Expected: 2 passing.
Run: `npm test`
Expected: 418 passing (416 + 2), 0 failures — the column is nullable, so nothing else notices it yet.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts drizzle/ __tests__/household-migration.test.ts
git commit -m "feat: add household_id partition column with backfill migration"
```

---

### Task 2: `inHousehold` predicate + active-household store

**Files:**
- Modify: `frontend/lib/db/predicates.ts`
- Create: `frontend/lib/household.ts`
- Modify: `frontend/app/_layout.tsx` (init wiring)
- Test: `frontend/__tests__/household-store.test.ts` (new)

**Interfaces:**
- Produces: `inHousehold(table, householdId: string | null): SQL` from `lib/db/predicates.ts`; `getActiveHouseholdId(): string | null`, `useActiveHouseholdId(): string | null`, `setActiveHouseholdId(id: string | null): void`, `initActiveHousehold(db: DB): () => void`, `resetActiveHouseholdForTests(): void` from `lib/household.ts`. Tasks 3–4 consume these exact names.
- Consumes: `subscribeSession`/`getSession` from `lib/api/session.ts`; `settings` table; Task 1's schema columns (typing only).

- [ ] **Step 1: Add `inHousehold` to `predicates.ts`**

Complete new file content:

```ts
import { eq, isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// The one tombstone filter. Every read of a synced table that should see
// only live rows goes through this — grep for isNull(...deletedAt) should
// return nothing outside this file.
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}

// The one partition filter, same grep-enforceable rule: no household_id
// comparison outside this file. NULL is the local/never-signed-in bucket,
// so the bucket is a partition like any other — not a wildcard.
export function inHousehold(
  table: { householdId: SQLiteColumn },
  householdId: string | null
): SQL {
  return householdId === null ? isNull(table.householdId) : eq(table.householdId, householdId);
}
```

- [ ] **Step 2: Create `lib/household.ts`**

```ts
import { eq } from 'drizzle-orm';
import { useSyncExternalStore } from 'react';

import { getSession, subscribeSession } from './api/session';
import { settings } from './db/schema';
import type { DB } from './db/types';

// The device's active household partition — module-state + subscriber-hook
// idiom (see lib/api/session.ts). Persisted as device-local bookkeeping in
// the settings table (like sync_cursor — excluded if settings ever sync).
// Sign-out does NOT clear it: the last-active household stays visible and
// editable, local-first. It is null only on a device that never signed in.
const ACTIVE_HOUSEHOLD_KEY = 'active_household_id';

let activeHouseholdId: string | null = null;
let persistDb: DB | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveHouseholdId(): string | null {
  return activeHouseholdId;
}

export function useActiveHouseholdId(): string | null {
  return useSyncExternalStore(subscribe, getActiveHouseholdId);
}

export function setActiveHouseholdId(id: string | null): void {
  if (id === activeHouseholdId) return;
  activeHouseholdId = id;
  if (persistDb) {
    if (id === null) {
      persistDb.delete(settings).where(eq(settings.key, ACTIVE_HOUSEHOLD_KEY)).run();
    } else {
      persistDb
        .insert(settings)
        .values({ key: ACTIVE_HOUSEHOLD_KEY, value: id })
        .onConflictDoUpdate({ target: settings.key, set: { value: id } })
        .run();
    }
  }
  emit();
}

// Loads the persisted partition and follows the session: any non-null
// session household (sign-in, join/leave/switch token rotations) becomes
// the active partition. Sign-out emits householdId null and is ignored.
export function initActiveHousehold(db: DB): () => void {
  persistDb = db;
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, ACTIVE_HOUSEHOLD_KEY))
    .get();
  activeHouseholdId = row?.value ?? null;
  emit();
  return subscribeSession(() => {
    const sessionHouseholdId = getSession().householdId;
    if (sessionHouseholdId !== null) setActiveHouseholdId(sessionHouseholdId);
  });
}

export function resetActiveHouseholdForTests(): void {
  activeHouseholdId = null;
  persistDb = null;
  listeners.clear();
}
```

- [ ] **Step 3: Wire init into `app/_layout.tsx`**

Add the import beside the other lib imports:

```ts
import { initActiveHousehold } from '../lib/household';
```

In the `state === 'ready'` effect, add the init BEFORE `restoreSession` (restore's `applyAuthResponse` emits a session change the store must observe) and tear it down:

```ts
    if (state === 'ready') {
      applyColorMode(getColorMode(db));
      applyLanguageMode(getLanguageMode(db));
      initLastSyncedAt(getLastSyncedAt(db));
      const teardownHousehold = initActiveHousehold(db);
      void restoreSession().then(() => syncNow());
      const teardownTriggers = initSyncTriggers();
      const teardownRealtime = initRealtime();
      return () => {
        teardownHousehold();
        teardownTriggers();
        teardownRealtime();
      };
    }
```

- [ ] **Step 4: Write the store test**

`__tests__/household-store.test.ts` — real in-memory db (`makeTestDb`), real session module. Mock `expo-secure-store` the same way `__tests__/api-session.test.ts` does (copy its mock block verbatim). Test cases:

```ts
import { makeTestDb } from './helpers/testDb';
import {
  getActiveHouseholdId,
  initActiveHousehold,
  resetActiveHouseholdForTests,
  setActiveHouseholdId,
} from '../lib/household';
import {
  applyAuthResponse,
  resetSessionForTests,
  setSessionSignedOut,
} from '../lib/api/session';

// (copy the expo-secure-store jest.mock block from api-session.test.ts here)

function authFor(householdId: string) {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    user: {
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      householdId,
      householdName: 'Home',
    },
  };
}

describe('active household store', () => {
  beforeEach(() => {
    resetActiveHouseholdForTests();
    resetSessionForTests();
  });

  it('starts null on a fresh device and loads the persisted partition', () => {
    const db = makeTestDb();
    initActiveHousehold(db);
    expect(getActiveHouseholdId()).toBeNull();

    setActiveHouseholdId('h1');

    // A second init (fresh app start) reads the persisted value back.
    resetActiveHouseholdForTests();
    initActiveHousehold(db);
    expect(getActiveHouseholdId()).toBe('h1');
  });

  it('follows the session household on sign-in and rotation', async () => {
    const db = makeTestDb();
    initActiveHousehold(db);

    await applyAuthResponse(authFor('h1'));
    expect(getActiveHouseholdId()).toBe('h1');

    await applyAuthResponse(authFor('h2'));
    expect(getActiveHouseholdId()).toBe('h2');
  });

  it('keeps the last-active household across sign-out', async () => {
    const db = makeTestDb();
    initActiveHousehold(db);

    await applyAuthResponse(authFor('h1'));
    setSessionSignedOut();
    expect(getActiveHouseholdId()).toBe('h1');
  });

  it('stops following after teardown', async () => {
    const db = makeTestDb();
    const teardown = initActiveHousehold(db);
    teardown();

    await applyAuthResponse(authFor('h1'));
    expect(getActiveHouseholdId()).toBeNull();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- household-store`
Expected: 4 passing.
Run: `npm test`
Expected: 422 passing, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/db/predicates.ts lib/household.ts app/_layout.tsx __tests__/household-store.test.ts
git commit -m "feat: add active-household store and inHousehold predicate"
```

---

### Task 3: Interim sync tagging (apply stamps, adoption re-tags)

**Files:**
- Modify: `frontend/lib/sync/apply.ts`, `frontend/lib/sync/cursor.ts`, `frontend/lib/sync/engine.ts`
- Test: `frontend/__tests__/sync-apply.test.ts`, `frontend/__tests__/sync-cursor.test.ts`, `frontend/__tests__/sync-remint.test.ts` (updates)

**Interfaces:**
- Produces: `applyPull(db, pull, householdId: string)` (new third parameter); `ensureHousehold(db, householdId)` now also re-tags all content rows. `collectDirty` and `remintConflicted` signatures unchanged.
- Consumes: Task 1's `householdId` columns.

- [ ] **Step 1: Thread the household through `apply.ts`**

Each applier gains a `householdId: string` parameter and stamps it into `values` (both insert and update paths — a re-tagged pull must also correct rows adopted earlier):

- `applyRecipe(db, row, householdId)` — add `householdId,` to the `values` object (after `notes`).
- `applyMealPlanEntry(db, row, householdId)` — add `householdId,` after `sortOrder`.
- `applyShoppingItem(db, row, householdId)` — add `householdId,` after `purchasedAt`.
- `applyPull`:

```ts
export function applyPull(db: DB, pull: SyncPullResponseDto, householdId: string): void {
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    // Recipes first: same-pull meal-plan rows may reference them (FK).
    for (const row of pull.recipes) applyRecipe(txDb, row, householdId);
    for (const row of pull.mealPlanEntries) applyMealPlanEntry(txDb, row, householdId);
    for (const row of pull.shoppingItems) applyShoppingItem(txDb, row, householdId);
  });
}
```

- [ ] **Step 2: Re-tag on adoption in `cursor.ts`**

`ensureHousehold` already marks everything dirty on a household change; fold the re-tag into the same updates:

```ts
// The adoption flow: any household change (first sign-in, join, leave,
// account switch) restarts sync from zero with everything marked for
// upload — tombstones included, so deletes replicate too. The whole device
// belongs to one household until slice ③, and the re-tag states that in
// the household_id column (adopting the NULL bucket on first sign-in).
export function ensureHousehold(db: DB, householdId: string): boolean {
  if (getSyncHouseholdId(db) === householdId) return false;
  write(db, CURSOR_KEY, '0');
  db.update(recipes).set({ dirty: 1, householdId }).run();
  db.update(mealPlanEntries).set({ dirty: 1, householdId }).run();
  db.update(shoppingItems).set({ dirty: 1, householdId }).run();
  return true;
}
```

- [ ] **Step 3: Thread the session household in `engine.ts`**

In `runCycle`, change the apply call:

```ts
    applyPull(db, pull, session.householdId);
```

- [ ] **Step 4: Update and extend the sync tests**

`sync-apply.test.ts`: every existing `applyPull(db, pull)` call gains a third argument `'h1'` (use the household id the fixture already syncs as, if one exists). Add one test:

```ts
  it('stamps pulled rows with the pulled household', () => {
    const db = makeTestDb();
    applyPull(db, pullWithOneRowPerTable(), 'h1');
    expect(db.select().from(recipes).get()?.householdId).toBe('h1');
    expect(db.select().from(mealPlanEntries).get()?.householdId).toBe('h1');
    expect(db.select().from(shoppingItems).get()?.householdId).toBe('h1');
  });
```

(Build `pullWithOneRowPerTable()` from the file's existing pull-fixture helper — reuse it; only the name may differ.)

`sync-cursor.test.ts`: add one test beside the existing `ensureHousehold` cases:

```ts
  it('re-tags every content row onto the adopted household', () => {
    const db = makeTestDb();
    // one row per table in the NULL bucket, one in a foreign household
    // (insert via db.insert(...).values({...}) with householdId: null / 'old')
    ensureHousehold(db, 'h2');
    for (const table of [recipes, mealPlanEntries, shoppingItems]) {
      const rows = db.select().from(table).all();
      expect(rows.every((row) => row.householdId === 'h2')).toBe(true);
      expect(rows.every((row) => row.dirty === 1)).toBe(true);
    }
  });
```

`sync-remint.test.ts`: add one assertion-only test — insert a conflicted row with `householdId: 'h1'`, re-mint, assert the fresh row still has `householdId: 'h1'` (the spread carries it; the test pins that).

`sync-engine.test.ts`: if it stubs `applyPull`, extend the stub's expected arguments with the session household id; if it uses the real one, no change beyond green.

- [ ] **Step 5: Run tests**

Run: `npm test -- sync-`
Expected: all sync suites passing with the 3 new tests.
Run: `npm test`
Expected: 425 passing, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/apply.ts lib/sync/cursor.ts lib/sync/engine.ts __tests__/sync-apply.test.ts __tests__/sync-cursor.test.ts __tests__/sync-remint.test.ts __tests__/sync-engine.test.ts
git commit -m "feat: tag pulled and adopted rows with their household"
```

---

### Task 4: Scope every repo, suggestion, seed, and screen to the active partition

**Files:**
- Modify (lib): `frontend/lib/db/recipes.ts`, `frontend/lib/db/mealPlan.ts`, `frontend/lib/db/shoppingList.ts`, `frontend/lib/suggestions/recipeIdeas.ts`, `frontend/lib/suggestions/habits.ts`, `frontend/lib/dev/sampleData.ts`
- Modify (screens/components): `frontend/app/(tabs)/index.tsx`, `frontend/app/(tabs)/recipes.tsx`, `frontend/app/(tabs)/plan.tsx`, `frontend/app/(tabs)/shop.tsx`, `frontend/app/recipe/new.tsx`, `frontend/app/recipe/[id]/edit.tsx`, `frontend/app/recipe/[id]/index.tsx`, `frontend/app/plan/add.tsx`, `frontend/app/plan/pick-day.tsx`, `frontend/app/plan/entry/[id].tsx`, `frontend/app/habits.tsx`
- Test: `frontend/__tests__/partition-isolation.test.ts` (new) + updates to `recipes-repository.test.ts`, `meal-plan-repository.test.ts`, `shopping-list-repository.test.ts`, `sample-data.test.ts`, `habits.test.ts`, and any screen test whose repo-call assertions change.

**Interfaces:**
- Consumes: `inHousehold` + `useActiveHouseholdId`/`getActiveHouseholdId` (Task 2), schema columns (Task 1).
- Produces (exact new signatures — every caller in the codebase must match):
  - `createRecipe(db, householdId, input)`, `updateRecipe(db, householdId, id, input)`, `softDeleteRecipe(db, householdId, id)`, `getRecipe(db, householdId, id)`
  - `addPlanEntry(db, householdId, input)`, `movePlanEntry(db, householdId, id, toDate)`, `setPlanEntryServings(db, householdId, id, servings)`, `removePlanEntry(db, householdId, id)`
  - `addItems(db, householdId, items, mode)`, `addManualItem(db, householdId, rawName)`, `purchaseItem(db, householdId, id)`, `restoreItem(db, householdId, id)`, `setItemQuantity(db, householdId, id, quantity, unit)`, `readdItem(db, householdId, id)`
  - `getPlanHistory(db, householdId)`, `getHabitsData(db, householdId)`, `seedSampleData(db, householdId)`
  - (`householdId: string | null` in all of the above)

- [ ] **Step 1: Scope `lib/db/recipes.ts`**

Import `inHousehold` beside `notDeleted`. Changes per function:

- `createRecipe(db, householdId, input)`: add `householdId,` to the inserted recipe values (after `notes`).
- `updateRecipe(db, householdId, id, input)`: recipe update `.where(and(eq(recipes.id, id), inHousehold(recipes, householdId)))`. Children are replaced only if the parent row matched — guard the child delete/insert on the update having hit a row:

```ts
export function updateRecipe(db: DB, householdId: string | null, id: string, input: RecipeInput): void {
  const now = Date.now();
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    const owned = txDb
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, id), inHousehold(recipes, householdId)))
      .get();
    if (!owned) return;
    txDb
      .update(recipes)
      .set({
        title: input.title,
        description: input.description,
        servings: input.servings,
        notes: input.notes,
        updatedAt: now,
        dirty: 1,
      })
      .where(eq(recipes.id, id))
      .run();
    txDb.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).run();
    txDb.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, id)).run();
    insertChildren(txDb, id, input);
  });
  scheduleSync();
}
```

- `softDeleteRecipe(db, householdId, id)`: `.where(and(eq(recipes.id, id), inHousehold(recipes, householdId)))`.
- `getRecipe(db, householdId, id)`: recipe select `.where(and(eq(recipes.id, id), notDeleted(recipes), inHousehold(recipes, householdId)))`. Children queries unchanged (reached only through an owned parent).

- [ ] **Step 2: Scope `lib/db/mealPlan.ts`**

- `nextSortOrder(db, householdId, date)`: `.where(and(eq(mealPlanEntries.date, date), notDeleted(mealPlanEntries), inHousehold(mealPlanEntries, householdId)))`.
- `addPlanEntry(db, householdId, input)`: insert values gain `householdId,`; the `nextSortOrder` call threads `householdId`.
- `movePlanEntry(db, householdId, id, toDate)`: where becomes `and(eq(mealPlanEntries.id, id), notDeleted(mealPlanEntries), inHousehold(mealPlanEntries, householdId))`; `nextSortOrder` call threads `householdId`.
- `setPlanEntryServings(db, householdId, id, servings)`: same added predicate.
- `removePlanEntry(db, householdId, id)`: where becomes `and(eq(mealPlanEntries.id, id), inHousehold(mealPlanEntries, householdId))`.

- [ ] **Step 3: Scope `lib/db/shoppingList.ts`**

- `addItems(db, householdId, items, mode)`: `activeRows` query adds `inHousehold(shoppingItems, householdId)` to its `and(...)`; the insert values gain `householdId,` (after `purchasedAt`); the merge-update `.where` becomes `and(eq(shoppingItems.id, existing.id))` — unchanged, `existing` was already partition-filtered.
- `addManualItem(db, householdId, rawName)`: thread into `addItems(db, householdId, [...], 'merge')`.
- `purchaseItem` / `restoreItem`: add `inHousehold(shoppingItems, householdId)` to the existing `and(...)`.
- `setItemQuantity(db, householdId, id, quantity, unit)`: add the predicate to its `and(...)`.
- `readdItem(db, householdId, id)`: source-row select adds the predicate; the `addItems` call threads `householdId`.

- [ ] **Step 4: Scope the suggestions getters and sample data**

`recipeIdeas.ts`:

```ts
export function getPlanHistory(db: DB, householdId: string | null): PlanHistoryRow[] {
  return db
    .select({ recipeId: mealPlanEntries.recipeId, date: mealPlanEntries.date })
    .from(mealPlanEntries)
    .where(and(notDeleted(mealPlanEntries), inHousehold(mealPlanEntries, householdId)))
    .all();
}
```

(`computeRecipeIdeas` is pure — unchanged.)

`habits.ts` — `getHabitsData(db, householdId)`: each of the three queries adds `inHousehold(<table>, householdId)` inside an `and(...)` with its existing predicates. (`computeHabits` unchanged.)

`sampleData.ts` — `seedSampleData(db, householdId)`: its existing recipes guard query adds `inHousehold(recipes, householdId)`; the `createRecipe(db, sample)` call becomes `createRecipe(db, householdId, sample)`.

- [ ] **Step 5: Thread the partition through every screen**

In each file below: add `import { useActiveHouseholdId } from '<rel>/lib/household';`, add `const householdId = useActiveHouseholdId();` at the top of the component, and:

- `app/(tabs)/index.tsx`: the `mealPlanEntries` live query where gains `inHousehold(mealPlanEntries, householdId)` (inside `and(...)` with its existing predicates), and `householdId` joins the `useLiveQuery` dependency array if one is passed.
- `app/(tabs)/recipes.tsx`: recipes live query where becomes `and(notDeleted(recipes), inHousehold(recipes, householdId))`; ingredient live query unchanged (children); `seedSampleData(db, householdId)` at the dev-button call.
- `app/(tabs)/plan.tsx`: both `mealPlanEntries` queries and the `shoppingItems` query gain the matching `inHousehold(...)`; `addItems(db, householdId, pending, 'skip-existing')`.
- `app/(tabs)/shop.tsx`: both `shoppingItems` queries gain `inHousehold(shoppingItems, householdId)`; repo calls become `addManualItem(db, householdId, draft)`, `purchaseItem(db, householdId, id)`, `restoreItem(db, householdId, id)`, `readdItem(db, householdId, id)`, `setItemQuantity(db, householdId, editing.id, quantity, unit)`.
- `app/recipe/new.tsx`: `createRecipe(db, householdId, recipeInputFromForm(state))`.
- `app/recipe/[id]/edit.tsx`: `getRecipe(db, householdId, id)` (add `householdId` to the `useMemo` deps) and `updateRecipe(db, householdId, details.recipe.id, ...)`.
- `app/recipe/[id]/index.tsx`: recipe live query where gains `inHousehold(recipes, householdId)`; children queries unchanged; `addItems(db, householdId, items, 'merge')`; `softDeleteRecipe(db, householdId, recipe.id)`.
- `app/plan/add.tsx`: recipes live query scoped like recipes.tsx; `getPlanHistory(db, householdId)` (add to its `useMemo` deps); `addPlanEntry(db, householdId, {...})`.
- `app/plan/pick-day.tsx`: `getRecipe(db, householdId, recipeId)` (deps), `mealPlanEntries` query scoped, `movePlanEntry(db, householdId, entryRow.id, date)`, `addPlanEntry(db, householdId, {...})`.
- `app/plan/entry/[id].tsx`: entry live query scoped; `setPlanEntryServings(db, householdId, entry.id, next)`; `removePlanEntry(db, householdId, entry.id)`.
- `app/habits.tsx`: `getHabitsData(db, householdId)` — and add `householdId` to the `useMemo` dependency array.

- `components/shop/StaplesSection.tsx`: receives its rows via props (already scoped by shop.tsx's queries) but imports `db` and calls `addItems` directly. Add `import { useActiveHouseholdId } from '../../lib/household';`, add `const householdId = useActiveHouseholdId();` at the top of the component (before the early returns — hook-order safety), and change the add handler's call to `addItems(db, householdId, [...], 'merge')`. No new props.

- [ ] **Step 6: Write the partition-isolation test (headline invariant)**

`__tests__/partition-isolation.test.ts` — real db, exercises every repo read/write across `'h1'`, `'h2'`, and `null`:

```ts
import { makeTestDb } from './helpers/testDb';
import { createRecipe, getRecipe, softDeleteRecipe, updateRecipe } from '../lib/db/recipes';
import { addPlanEntry } from '../lib/db/mealPlan';
import { addItems } from '../lib/db/shoppingList';
import { inHousehold } from '../lib/db/predicates';
import { shoppingItems } from '../lib/db/schema';
import { getPlanHistory } from '../lib/suggestions/recipeIdeas';
import { getHabitsData } from '../lib/suggestions/habits';

jest.mock('../lib/sync/trigger', () => ({ scheduleSync: jest.fn() }));

const recipeInput = {
  title: 'Tacos',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Melk', quantity: 1, unit: 'l' }],
  instructions: [{ text: 'Mix' }],
};

const item = {
  name: 'Melk',
  normalizedName: 'melk',
  quantity: 1,
  unit: 'l',
  sources: [],
};

describe('partition isolation', () => {
  it('reads never cross partitions — including the NULL bucket', () => {
    const db = makeTestDb();
    const inH1 = createRecipe(db, 'h1', recipeInput);
    const inNull = createRecipe(db, null, recipeInput);

    expect(getRecipe(db, 'h1', inH1)).not.toBeNull();
    expect(getRecipe(db, 'h2', inH1)).toBeNull();
    expect(getRecipe(db, null, inH1)).toBeNull();
    expect(getRecipe(db, null, inNull)).not.toBeNull();
    expect(getRecipe(db, 'h1', inNull)).toBeNull();
  });

  it('by-id mutations no-op across partitions', () => {
    const db = makeTestDb();
    const id = createRecipe(db, 'h1', recipeInput);

    softDeleteRecipe(db, 'h2', id);
    updateRecipe(db, 'h2', id, { ...recipeInput, title: 'Stolen' });

    const details = getRecipe(db, 'h1', id);
    expect(details).not.toBeNull();
    expect(details!.recipe.title).toBe('Tacos');
    expect(details!.ingredients).toHaveLength(1);
  });

  it('plan history and habits stay per-household', () => {
    const db = makeTestDb();
    const r1 = createRecipe(db, 'h1', recipeInput);
    const r2 = createRecipe(db, 'h2', recipeInput);
    addPlanEntry(db, 'h1', { date: '2026-07-27', recipeId: r1, servings: 2 });
    addPlanEntry(db, 'h2', { date: '2026-07-27', recipeId: r2, servings: 2 });

    expect(getPlanHistory(db, 'h1')).toHaveLength(1);
    expect(getPlanHistory(db, null)).toHaveLength(0);
    expect(getHabitsData(db, 'h1').recipes).toHaveLength(1);
  });

  it('shopping merge only sees its own partition', () => {
    const db = makeTestDb();
    addItems(db, 'h1', [item], 'merge');
    addItems(db, 'h2', [item], 'merge');
    addItems(db, 'h1', [item], 'merge'); // merges into h1's row only

    const rowsIn = (householdId: string | null) =>
      db.select().from(shoppingItems).where(inHousehold(shoppingItems, householdId)).all();

    expect(rowsIn('h1')).toHaveLength(1);
    expect(rowsIn('h1')[0].quantity).toBe(2);
    expect(rowsIn('h2')).toHaveLength(1);
    expect(rowsIn('h2')[0].quantity).toBe(1);
    expect(rowsIn(null)).toHaveLength(0);
  });
});
```

Calling `inHousehold` from a test is fine — the global constraint bans ad-hoc `household_id` comparisons, not consumers of the one predicate.

- [ ] **Step 7: Update the existing tests**

- `recipes-repository.test.ts`, `meal-plan-repository.test.ts`, `shopping-list-repository.test.ts`, `sample-data.test.ts`, `habits.test.ts` (and `recipe-ideas`/`staples` db-level tests if they call the getters): every changed-signature call gains the partition argument — use `null` (the NULL bucket) so fixtures stay minimal; the tests' behavior is otherwise identical, which itself proves the bucket works like any partition.
- Screen tests (`recipes-screen`, `shop-screen`, `plan-screen`, `today-screen`, `plan-add`, `plan-pick-day`, `plan-entry`, `recipe-detail`, `recipe-edit`, `habits-screen`, `staples-section`, `quantity-editor` if it asserts `setItemQuantity` args): the real `lib/household` module is safe to load (module state defaults to `null` and the hook touches no native APIs) — only update assertions that check repo-call arguments (e.g. `expect(seedMock).toHaveBeenCalledWith(db, null)` shapes) and any test that needs a non-null partition can `jest.mock('../lib/household', () => ({ useActiveHouseholdId: () => 'h1' }))`.

- [ ] **Step 8: Run everything**

Run: `npm test`
Expected: all suites passing (425 from Task 3 + isolation suite + any new repo cases), 0 failures.
Run: `npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add lib/db/ lib/suggestions/ lib/dev/sampleData.ts app/ components/ __tests__/
git commit -m "feat: scope every query and write to the active household partition"
```
