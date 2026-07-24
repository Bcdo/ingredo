# Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Phase 5 sync engine: one serialized `syncNow()` cycle (collect dirty → push → pull → LWW-merge → store cursor), adoption/household-switch handling, triggers, a quiet status line — plus the inherited repo hardening (tombstone write-guards, `notDeleted()`, refresh quiesce).

**Architecture:** `lib/sync/` with six small modules: `cursor` (settings-backed cursor/household/lastSynced + switch-reset), `status` (module state + hook), `collect` (dirty rows → wire DTOs + compare-and-clear stamps), `apply` (pull merge writers, always `dirty: 0`), `engine` (`syncNow()` mutex + cycle), `trigger` (debounce + AppState, engine loaded lazily so repos never drag native modules into node tests). Push-before-pull is structural; the cursor is stored only from pulls.

**Tech Stack:** existing frontend stack (Expo SDK 54, drizzle/expo-sqlite, Jest + better-sqlite3 test DB). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-24-sync-engine-design.md`

## Global Constraints

- Signed out or `restoring`: every trigger and `syncNow()` is a no-op (`'skipped'`, zero fetches). Existing signed-out behavior byte-identical.
- Cursor stored ONLY from pull responses; a push's `cursor` is never adopted. Settings keys (device-local, never synced): `sync_cursor`, `sync_household_id`, `last_synced_at`.
- Household switch (stored id ≠ `session.householdId`): reset cursor to 0 + mark EVERY row in recipes/meal_plan_entries/shopping_items dirty (tombstones included). `sync_household_id` is written only together with a successful pull's cursor.
- Push outcomes: `applied`/`superseded` → compare-and-clear (`dirty = 0` only `WHERE updated_at =` the value read at collect); `conflict` → stays dirty, counted. Batch failure clears nothing.
- Pull merge rule per row (lookup by id, ignoring tombstone state): absent → insert `dirty: 0`; present with local `dirty = 0` → apply server unconditionally; present with local `dirty = 1` → apply iff server `updatedAt` ≥ local `updatedAt` (tie applies server), clearing dirty. Recipes apply as aggregate replace (delete children, reinsert). Apply-writers NEVER call repo functions (they stamp `dirty: 1`).
- Wire format (slice-② contract): epoch-ms numbers, `yyyy-MM-dd` date strings, lowercase `scaling`/`status` strings, `sources` opaque string; routes `POST /api/v1/sync/push`, `GET /api/v1/sync/changes?since=`.
- All user-facing strings in BOTH `lib/i18n/nb.json` and `lib/i18n/en.json` (`sync.*`; parity test enforces). i18n-js interpolation uses `%{name}` placeholders.
- Jest rules: `mock`-prefix rule in `jest.mock` factories; RNTL v13 sync render; `act()` around async state changes. Existing tests pass UNTOUCHED except compile-forced mock additions (disclose).
- Green bar per task: `npx jest`, `npx eslint . --max-warnings 0`, `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`.

## File Structure

- Create: `lib/db/predicates.ts`, `lib/sync/cursor.ts`, `lib/sync/status.ts`, `lib/sync/collect.ts`, `lib/sync/apply.ts`, `lib/sync/engine.ts`, `lib/sync/trigger.ts`
- Modify: `lib/db/{recipes,mealPlan,shoppingList}.ts` (guards, `notDeleted`, `scheduleSync`), 8 screen files + `lib/dev/sampleData.ts` (`notDeleted`), `lib/api/types.ts` (sync DTOs), `lib/api/client.ts` (`pendingRefresh`), `lib/api/auth.ts` (quiesce), `app/_layout.tsx` (restore-then-sync + triggers), `components/settings/AccountSection.tsx` (status line + sync now), `lib/i18n/{nb,en}.json`, root `docs/TESTING.md`
- Tests: additions to the two repository test files; `__tests__/api-client.test.ts`, `__tests__/api-auth.test.ts`; new `__tests__/sync-cursor.test.ts`, `__tests__/sync-status.test.ts`, `__tests__/sync-collect.test.ts`, `__tests__/sync-apply.test.ts`, `__tests__/sync-engine.test.ts`, `__tests__/sync-trigger.test.ts`; additions to `__tests__/account-section.test.tsx`

---

### Task 1: `notDeleted()` predicate and tombstone write-guards

**Files:**
- Create: `lib/db/predicates.ts`
- Modify: `lib/db/recipes.ts`, `lib/db/mealPlan.ts`, `lib/db/shoppingList.ts`, `app/(tabs)/recipes.tsx`, `app/(tabs)/plan.tsx`, `app/(tabs)/shop.tsx`, `app/(tabs)/index.tsx`, `app/plan/add.tsx`, `app/plan/pick-day.tsx`, `app/plan/entry/[id].tsx`, `app/recipe/[id]/index.tsx`, `lib/dev/sampleData.ts`
- Test: append to the existing meal-plan and shopping repository test files in `__tests__/` (find exact names with `ls __tests__ | grep -i -e meal -e shop`)

**Interfaces:**
- Produces: `notDeleted(table: { deletedAt: SQLiteColumn }): SQL` — used by every tombstone filter from now on. Guarded mutations: `movePlanEntry`, `setPlanEntryServings`, `purchaseItem`, `restoreItem` no-op on tombstoned rows.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/sync-engine
cd frontend
```

- [ ] **Step 1: Write the failing guard tests**

Append to the meal-plan repository test file (inside the top-level describe, using its existing `makeTestDb` setup — adapt fixture helpers to what the file already uses for creating a recipe + entry):

```ts
describe('tombstone write-guards', () => {
  it('movePlanEntry no-ops on a tombstoned entry', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    removePlanEntry(db, entryId);
    const before = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;

    movePlanEntry(db, entryId, '2026-07-21');

    const after = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;
    expect(after.date).toBe('2026-07-20');
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('setPlanEntryServings no-ops on a tombstoned entry', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    removePlanEntry(db, entryId);

    setPlanEntryServings(db, entryId, 6);

    const after = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;
    expect(after.servings).toBe(2);
  });
});
```

Append to the shopping repository test file (same adaptation rules; it has helpers for adding items — a tombstoned row is produced by setting `deletedAt` directly since no repo delete exists for shopping):

```ts
describe('tombstone write-guards', () => {
  function tombstone(db: DB, id: string) {
    db.update(shoppingItems)
      .set({ deletedAt: Date.now(), updatedAt: Date.now(), dirty: 1 })
      .where(eq(shoppingItems.id, id))
      .run();
  }

  it('purchaseItem no-ops on a tombstoned item', () => {
    const db = makeTestDb();
    addManualItem(db, 'Melk');
    const row = db.select().from(shoppingItems).all()[0];
    tombstone(db, row.id);

    purchaseItem(db, row.id);

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.status).toBe('active');
    expect(after.purchasedAt).toBeNull();
  });

  it('restoreItem no-ops on a tombstoned item', () => {
    const db = makeTestDb();
    addManualItem(db, 'Melk');
    const row = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, row.id);
    tombstone(db, row.id);
    const before = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;

    restoreItem(db, row.id);

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.status).toBe('purchased');
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest <the two repo test files>`
Expected: the four new tests FAIL (mutations currently apply to tombstoned rows); every pre-existing test still passes.

- [ ] **Step 3: Implement**

Create `lib/db/predicates.ts`:

```ts
import { isNull, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

// The one tombstone filter. Every read of a synced table that should see
// only live rows goes through this — grep for isNull(...deletedAt) should
// return nothing outside this file.
export function notDeleted(table: { deletedAt: SQLiteColumn }): SQL {
  return isNull(table.deletedAt);
}
```

Guards — in `lib/db/mealPlan.ts` change the two by-id mutations' WHERE clauses:

```ts
export function movePlanEntry(db: DB, id: string, toDate: string): void {
  const now = Date.now();
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    txDb
      .update(mealPlanEntries)
      .set({ date: toDate, sortOrder: nextSortOrder(txDb, toDate), updatedAt: now, dirty: 1 })
      .where(and(eq(mealPlanEntries.id, id), notDeleted(mealPlanEntries)))
      .run();
  });
}

export function setPlanEntryServings(db: DB, id: string, servings: number): void {
  db.update(mealPlanEntries)
    .set({ servings, updatedAt: Date.now(), dirty: 1 })
    .where(and(eq(mealPlanEntries.id, id), notDeleted(mealPlanEntries)))
    .run();
}
```

In `lib/db/shoppingList.ts` likewise:

```ts
export function purchaseItem(db: DB, id: string): void {
  const now = Date.now();
  db.update(shoppingItems)
    .set({ status: 'purchased', purchasedAt: now, updatedAt: now, dirty: 1 })
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .run();
}

export function restoreItem(db: DB, id: string): void {
  db.update(shoppingItems)
    .set({ status: 'active', purchasedAt: null, updatedAt: Date.now(), dirty: 1 })
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .run();
}
```

(Import `notDeleted` from `./predicates` in both; `and` is already imported.)

Then the mechanical sweep: replace every `isNull(<table>.deletedAt)` in the files listed above with `notDeleted(<table>)` (imports: `../lib/db/predicates` from screens, `./predicates` from lib/db, `../db/predicates` from lib/dev). Remove `isNull` from each file's drizzle import when it becomes unused. Verify completeness:

```bash
grep -rn "isNull(" app lib --include='*.ts' --include='*.tsx' | grep deletedAt | grep -v predicates
```

Expected: no output.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 294/294 (290 + 4). ZERO changes to any screen test file — the sweep is behavior-identical.

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "harden: tombstone write-guards and centralized notDeleted predicate"
```

---

### Task 2: Refresh quiesce in sign-out

**Files:**
- Modify: `lib/api/client.ts`, `lib/api/auth.ts`
- Test: `__tests__/api-client.test.ts`, `__tests__/api-auth.test.ts`

**Interfaces:**
- Produces: `pendingRefresh(): Promise<unknown>` from `lib/api/client.ts` — resolves immediately when no refresh is in flight, otherwise settles with it. `signOut` awaits it before clearing.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/api-client.test.ts` (new describe; `pendingRefresh` joins the existing import from `../lib/api/client`):

```ts
describe('pendingRefresh', () => {
  it('resolves immediately when no refresh is in flight', async () => {
    await expect(pendingRefresh()).resolves.toBeUndefined();
  });

  it('settles together with an in-flight refresh', async () => {
    await setStoredRefreshToken('refresh-1');
    let release: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const refreshing = refreshSession();
    let settled = false;
    const waiter = pendingRefresh().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release(jsonResponse(200, auth));
    await refreshing;
    await waiter;
    expect(settled).toBe(true);
  });
});
```

In `__tests__/api-auth.test.ts`: add `pendingRefresh: jest.fn(async () => {})` to the `jest.mock('../lib/api/client', ...)` factory, import it alongside `apiFetch`, and append to the auth wrappers describe:

```ts
  it('signOut quiesces any in-flight refresh before clearing', async () => {
    await setStoredRefreshToken('refresh-1');
    apiFetchMock.mockResolvedValueOnce(undefined);

    await signOut();

    expect(pendingRefresh).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/api-client.test.ts __tests__/api-auth.test.ts`
Expected: FAIL — `pendingRefresh` is not exported.

- [ ] **Step 3: Implement**

In `lib/api/client.ts`, below the `refreshSession` definition:

```ts
// Settles when any in-flight refresh does (resolved immediately otherwise).
// signOut awaits this so a refresh completion can never interleave its
// token persist with sign-out's clear.
export function pendingRefresh(): Promise<unknown> {
  return refreshInFlight ?? Promise.resolve();
}
```

In `lib/api/auth.ts`, import `pendingRefresh` from `./client` and make it `signOut`'s first statement:

```ts
export async function signOut(): Promise<void> {
  await pendingRefresh();
  const refreshToken = await getStoredRefreshToken();
  // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 297/297 (294 + 3).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "harden: sign-out quiesces in-flight refresh"
```

---

### Task 3: Sync DTO types, cursor store, status store

**Files:**
- Modify: `lib/api/types.ts`
- Create: `lib/sync/cursor.ts`, `lib/sync/status.ts`
- Test: `__tests__/sync-cursor.test.ts`, `__tests__/sync-status.test.ts`

**Interfaces:**
- Produces (used by Tasks 4–7):
  - `lib/api/types.ts` additions: `SyncIngredientRowDto`, `SyncInstructionRowDto`, `SyncRecipeRowDto`, `SyncMealPlanRowDto`, `SyncShoppingRowDto`, `SyncPullResponseDto`, `SyncPushRequestDto`, `SyncPushResponseDto` (exact shapes in Step 3).
  - `lib/sync/cursor.ts`: `getSyncCursor(db: DB): number`, `getSyncHouseholdId(db: DB): string | null`, `getLastSyncedAt(db: DB): number | null`, `storePullResult(db: DB, cursor: number, householdId: string): void`, `ensureHousehold(db: DB, householdId: string): boolean`.
  - `lib/sync/status.ts`: `SyncState = 'idle' | 'syncing' | 'error'`, `SyncStatus = { state: SyncState; lastSyncedAt: number | null; pendingConflicts: number }`, `getSyncStatus()`, `useSyncStatus()`, `markSyncing()`, `markIdle(lastSyncedAt: number, pendingConflicts: number)`, `markError()`, `initLastSyncedAt(value: number | null)`, `resetSyncStatusForTests()`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sync-cursor.test.ts`:

```ts
import { eq } from 'drizzle-orm';

import { addPlanEntry, removePlanEntry } from '../lib/db/mealPlan';
import { createRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipes, shoppingItems } from '../lib/db/schema';
import { addManualItem } from '../lib/db/shoppingList';
import {
  ensureHousehold,
  getLastSyncedAt,
  getSyncCursor,
  getSyncHouseholdId,
  storePullResult,
} from '../lib/sync/cursor';
import { makeTestDb } from './helpers/testDb';

const sampleRecipe = () => ({
  title: 'Taco',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
  instructions: [{ text: 'Bland.' }],
});

describe('sync cursor store', () => {
  it('starts at cursor 0 with no household and no lastSyncedAt', () => {
    const db = makeTestDb();
    expect(getSyncCursor(db)).toBe(0);
    expect(getSyncHouseholdId(db)).toBeNull();
    expect(getLastSyncedAt(db)).toBeNull();
  });

  it('storePullResult persists cursor, household and lastSyncedAt together', () => {
    const db = makeTestDb();
    storePullResult(db, 1042, 'household-1');
    expect(getSyncCursor(db)).toBe(1042);
    expect(getSyncHouseholdId(db)).toBe('household-1');
    expect(getLastSyncedAt(db)).toBeGreaterThan(0);
  });

  it('ensureHousehold is a no-op when the household matches', () => {
    const db = makeTestDb();
    storePullResult(db, 1042, 'household-1');
    expect(ensureHousehold(db, 'household-1')).toBe(false);
    expect(getSyncCursor(db)).toBe(1042);
  });

  it('ensureHousehold on a switch resets the cursor and marks everything dirty, tombstones included', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    removePlanEntry(db, entryId);
    addManualItem(db, 'Melk');
    // Simulate a completed sync: everything clean, cursor advanced.
    db.update(recipes).set({ dirty: 0 }).run();
    db.update(mealPlanEntries).set({ dirty: 0 }).run();
    db.update(shoppingItems).set({ dirty: 0 }).run();
    storePullResult(db, 500, 'household-1');

    expect(ensureHousehold(db, 'household-2')).toBe(true);

    expect(getSyncCursor(db)).toBe(0);
    expect(db.select().from(recipes).where(eq(recipes.dirty, 0)).all()).toHaveLength(0);
    expect(db.select().from(mealPlanEntries).where(eq(mealPlanEntries.dirty, 0)).all()).toHaveLength(0);
    expect(db.select().from(shoppingItems).where(eq(shoppingItems.dirty, 0)).all()).toHaveLength(0);
    // The stored household id is NOT updated by the reset — only a
    // successful pull writes it.
    expect(getSyncHouseholdId(db)).toBe('household-1');
  });

  it('ensureHousehold with no stored household treats first sign-in as a switch', () => {
    const db = makeTestDb();
    expect(ensureHousehold(db, 'household-1')).toBe(true);
    expect(getSyncCursor(db)).toBe(0);
  });
});
```

Create `__tests__/sync-status.test.ts`:

```ts
import {
  getSyncStatus,
  initLastSyncedAt,
  markError,
  markIdle,
  markSyncing,
  resetSyncStatusForTests,
} from '../lib/sync/status';

describe('sync status store', () => {
  beforeEach(() => resetSyncStatusForTests());

  it('starts idle with nothing synced', () => {
    expect(getSyncStatus()).toEqual({ state: 'idle', lastSyncedAt: null, pendingConflicts: 0 });
  });

  it('walks syncing → idle with timestamp and conflicts', () => {
    markSyncing();
    expect(getSyncStatus().state).toBe('syncing');
    markIdle(1753350000000, 2);
    expect(getSyncStatus()).toEqual({
      state: 'idle',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 2,
    });
  });

  it('error keeps the previous lastSyncedAt', () => {
    markIdle(1753350000000, 0);
    markSyncing();
    markError();
    expect(getSyncStatus()).toEqual({
      state: 'error',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 0,
    });
  });

  it('initLastSyncedAt seeds the persisted value on startup', () => {
    initLastSyncedAt(1753340000000);
    expect(getSyncStatus().lastSyncedAt).toBe(1753340000000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/sync-cursor.test.ts __tests__/sync-status.test.ts`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

Append to `lib/api/types.ts`:

```ts
// Sync wire DTOs (slice-② contract): epoch-ms numbers, yyyy-MM-dd date
// strings, lowercase enum strings, sources as an opaque string.
export type SyncIngredientRowDto = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling: string;
  sortOrder: number;
};

export type SyncInstructionRowDto = {
  id: string;
  text: string;
  sortOrder: number;
};

export type SyncRecipeRowDto = {
  id: string;
  title: string;
  description: string | null;
  servings: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  ingredients: SyncIngredientRowDto[];
  instructions: SyncInstructionRowDto[];
};

export type SyncMealPlanRowDto = {
  id: string;
  date: string;
  recipeId: string;
  servings: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncShoppingRowDto = {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  sources: string;
  status: string;
  purchasedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncPullResponseDto = {
  recipes: SyncRecipeRowDto[];
  mealPlanEntries: SyncMealPlanRowDto[];
  shoppingItems: SyncShoppingRowDto[];
  cursor: number;
};

export type SyncPushRequestDto = {
  recipes: SyncRecipeRowDto[] | null;
  mealPlanEntries: SyncMealPlanRowDto[] | null;
  shoppingItems: SyncShoppingRowDto[] | null;
};

export type SyncPushResponseDto = {
  results: Record<string, string>;
  cursor: number;
};
```

Create `lib/sync/cursor.ts`:

```ts
import { eq } from 'drizzle-orm';

import { mealPlanEntries, recipes, settings, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';

// Device-local sync bookkeeping — must be excluded if settings ever sync.
const CURSOR_KEY = 'sync_cursor';
const HOUSEHOLD_KEY = 'sync_household_id';
const LAST_SYNCED_KEY = 'last_synced_at';

function read(db: DB, key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

function write(db: DB, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function getSyncCursor(db: DB): number {
  const stored = read(db, CURSOR_KEY);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSyncHouseholdId(db: DB): string | null {
  return read(db, HOUSEHOLD_KEY);
}

export function getLastSyncedAt(db: DB): number | null {
  const stored = read(db, LAST_SYNCED_KEY);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

// Only a successful pull moves the cursor — and the household id moves
// with it, so a failed adoption cycle re-runs the switch reset next time.
export function storePullResult(db: DB, cursor: number, householdId: string): void {
  write(db, CURSOR_KEY, String(cursor));
  write(db, HOUSEHOLD_KEY, householdId);
  write(db, LAST_SYNCED_KEY, String(Date.now()));
}

// The adoption flow: any household change (first sign-in, join, leave,
// account switch) restarts sync from zero with everything marked for
// upload — tombstones included, so deletes replicate too.
export function ensureHousehold(db: DB, householdId: string): boolean {
  if (getSyncHouseholdId(db) === householdId) return false;
  write(db, CURSOR_KEY, '0');
  db.update(recipes).set({ dirty: 1 }).run();
  db.update(mealPlanEntries).set({ dirty: 1 }).run();
  db.update(shoppingItems).set({ dirty: 1 }).run();
  return true;
}
```

Create `lib/sync/status.ts`:

```ts
import { useSyncExternalStore } from 'react';

export type SyncState = 'idle' | 'syncing' | 'error';

export type SyncStatus = {
  state: SyncState;
  lastSyncedAt: number | null;
  pendingConflicts: number;
};

let status: SyncStatus = { state: 'idle', lastSyncedAt: null, pendingConflicts: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus);
}

export function markSyncing(): void {
  status = { ...status, state: 'syncing' };
  emit();
}

export function markIdle(lastSyncedAt: number, pendingConflicts: number): void {
  status = { state: 'idle', lastSyncedAt, pendingConflicts };
  emit();
}

export function markError(): void {
  status = { ...status, state: 'error' };
  emit();
}

// Seeds the persisted last_synced_at into memory at startup.
export function initLastSyncedAt(value: number | null): void {
  status = { ...status, lastSyncedAt: value };
  emit();
}

export function resetSyncStatusForTests(): void {
  status = { state: 'idle', lastSyncedAt: null, pendingConflicts: 0 };
  listeners.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 306/306 (297 + 9).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add sync wire types, cursor store and status store"
```

---

### Task 4: Dirty collection and wire mapping

**Files:**
- Create: `lib/sync/collect.ts`
- Test: `__tests__/sync-collect.test.ts`

**Interfaces:**
- Consumes: Task 3 DTO types.
- Produces (used by Task 6): `DirtyBatch = { request: SyncPushRequestDto; stamps: { recipes: Map<string, number>; mealPlanEntries: Map<string, number>; shoppingItems: Map<string, number> }; isEmpty: boolean }`, `collectDirty(db: DB): DirtyBatch`. Stamps map row id → the `updatedAt` read at collect time (compare-and-clear input).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sync-collect.test.ts`:

```ts
import { addPlanEntry, removePlanEntry } from '../lib/db/mealPlan';
import { createRecipe, softDeleteRecipe, updateRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipes, shoppingItems } from '../lib/db/schema';
import { addManualItem, purchaseItem } from '../lib/db/shoppingList';
import { collectDirty } from '../lib/sync/collect';
import { makeTestDb } from './helpers/testDb';

const sampleRecipe = () => ({
  title: 'Taco',
  description: 'Fredagstaco',
  servings: 4,
  notes: null,
  ingredients: [
    { name: 'Mel', quantity: 400, unit: 'g' },
    { name: 'Salt', quantity: null, unit: null, scaling: 'fixed' as const },
  ],
  instructions: [{ text: 'Bland.' }, { text: 'Stek.' }],
});

function markAllClean(db: ReturnType<typeof makeTestDb>) {
  db.update(recipes).set({ dirty: 0 }).run();
  db.update(mealPlanEntries).set({ dirty: 0 }).run();
  db.update(shoppingItems).set({ dirty: 0 }).run();
}

describe('collectDirty', () => {
  it('is empty when nothing is dirty', () => {
    const db = makeTestDb();
    createRecipe(db, sampleRecipe());
    markAllClean(db);

    const batch = collectDirty(db);

    expect(batch.isEmpty).toBe(true);
    expect(batch.request.recipes).toBeNull();
    expect(batch.request.mealPlanEntries).toBeNull();
    expect(batch.request.shoppingItems).toBeNull();
  });

  it('maps a dirty recipe as a full aggregate with ordered children', () => {
    const db = makeTestDb();
    const id = createRecipe(db, sampleRecipe());

    const batch = collectDirty(db);

    expect(batch.isEmpty).toBe(false);
    const recipe = batch.request.recipes!.find((r) => r.id === id)!;
    expect(recipe.title).toBe('Taco');
    expect(recipe.deletedAt).toBeNull();
    expect(recipe.ingredients.map((i) => i.name)).toEqual(['Mel', 'Salt']);
    expect(recipe.ingredients[1].scaling).toBe('fixed');
    expect(recipe.instructions.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(batch.stamps.recipes.get(id)).toBe(recipe.updatedAt);
  });

  it('includes tombstones', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    markAllClean(db);
    removePlanEntry(db, entryId);
    softDeleteRecipe(db, recipeId);

    const batch = collectDirty(db);

    expect(batch.request.recipes!.find((r) => r.id === recipeId)!.deletedAt).not.toBeNull();
    expect(batch.request.mealPlanEntries!.find((e) => e.id === entryId)!.deletedAt).not.toBeNull();
  });

  it('maps meal-plan and shopping fields onto the wire shapes', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    addManualItem(db, 'Melk');
    const item = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, item.id);

    const batch = collectDirty(db);

    const entry = batch.request.mealPlanEntries!.find((e) => e.id === entryId)!;
    expect(entry).toMatchObject({ date: '2026-07-20', recipeId, servings: 2, sortOrder: 0 });
    const wireItem = batch.request.shoppingItems!.find((i) => i.id === item.id)!;
    expect(wireItem).toMatchObject({
      name: 'Melk',
      normalizedName: 'melk',
      status: 'purchased',
      sources: '[]',
    });
    expect(wireItem.purchasedAt).toBeGreaterThan(0);
    expect(batch.stamps.shoppingItems.get(item.id)).toBe(wireItem.updatedAt);
  });

  it('only dirty rows are collected', () => {
    const db = makeTestDb();
    const keptClean = createRecipe(db, sampleRecipe());
    markAllClean(db);
    const dirtyOne = createRecipe(db, { ...sampleRecipe(), title: 'Ny' });

    const batch = collectDirty(db);

    expect(batch.request.recipes!.map((r) => r.id)).toEqual([dirtyOne]);
    expect(batch.stamps.recipes.has(keptClean)).toBe(false);
  });

  it('an edited recipe carries its edited state', () => {
    const db = makeTestDb();
    const id = createRecipe(db, sampleRecipe());
    markAllClean(db);
    updateRecipe(db, id, { ...sampleRecipe(), title: 'Taco 2.0' });

    const batch = collectDirty(db);

    expect(batch.request.recipes![0].title).toBe('Taco 2.0');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/sync-collect.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/sync/collect.ts`:

```ts
import { asc, eq } from 'drizzle-orm';

import { mealPlanEntries, recipeIngredients, recipeInstructions, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import type {
  DirtyStamps,
  SyncMealPlanRowDto,
  SyncPushRequestDto,
  SyncRecipeRowDto,
  SyncShoppingRowDto,
} from '../api/types';

export type { DirtyStamps } from '../api/types';

export type DirtyBatch = {
  request: SyncPushRequestDto;
  stamps: DirtyStamps;
  isEmpty: boolean;
};

export function collectDirty(db: DB): DirtyBatch {
  const dirtyRecipes = db.select().from(recipes).where(eq(recipes.dirty, 1)).all();
  const dirtyEntries = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.dirty, 1)).all();
  const dirtyItems = db.select().from(shoppingItems).where(eq(shoppingItems.dirty, 1)).all();

  const recipeRows: SyncRecipeRowDto[] = dirtyRecipes.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ingredients: db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, row.id))
      .orderBy(asc(recipeIngredients.sortOrder))
      .all()
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling,
        sortOrder: ing.sortOrder,
      })),
    instructions: db
      .select()
      .from(recipeInstructions)
      .where(eq(recipeInstructions.recipeId, row.id))
      .orderBy(asc(recipeInstructions.sortOrder))
      .all()
      .map((step) => ({ id: step.id, text: step.text, sortOrder: step.sortOrder })),
  }));

  const entryRows: SyncMealPlanRowDto[] = dirtyEntries.map((row) => ({
    id: row.id,
    date: row.date,
    recipeId: row.recipeId,
    servings: row.servings,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }));

  const itemRows: SyncShoppingRowDto[] = dirtyItems.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    quantity: row.quantity,
    unit: row.unit,
    sources: row.sources,
    status: row.status,
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }));

  return {
    request: {
      recipes: recipeRows.length > 0 ? recipeRows : null,
      mealPlanEntries: entryRows.length > 0 ? entryRows : null,
      shoppingItems: itemRows.length > 0 ? itemRows : null,
    },
    stamps: {
      recipes: new Map(dirtyRecipes.map((row) => [row.id, row.updatedAt])),
      mealPlanEntries: new Map(dirtyEntries.map((row) => [row.id, row.updatedAt])),
      shoppingItems: new Map(dirtyItems.map((row) => [row.id, row.updatedAt])),
    },
    isEmpty: recipeRows.length === 0 && entryRows.length === 0 && itemRows.length === 0,
  };
}
```

And append the stamps type to `lib/api/types.ts`:

```ts
export type DirtyStamps = {
  recipes: Map<string, number>;
  mealPlanEntries: Map<string, number>;
  shoppingItems: Map<string, number>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 312/312 (306 + 6).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add dirty-row collection and wire mapping"
```

---

### Task 5: Pull apply-writers and LWW merge

**Files:**
- Create: `lib/sync/apply.ts`
- Test: `__tests__/sync-apply.test.ts`

**Interfaces:**
- Consumes: Task 3 DTO types.
- Produces (used by Task 6): `applyPull(db: DB, pull: SyncPullResponseDto): void`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sync-apply.test.ts`:

```ts
import { eq } from 'drizzle-orm';

import { createRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipeIngredients, recipes, shoppingItems } from '../lib/db/schema';
import { applyPull } from '../lib/sync/apply';
import type { SyncPullResponseDto, SyncRecipeRowDto } from '../lib/api/types';
import { makeTestDb } from './helpers/testDb';

const emptyPull = (over: Partial<SyncPullResponseDto>): SyncPullResponseDto => ({
  recipes: [],
  mealPlanEntries: [],
  shoppingItems: [],
  cursor: 0,
  ...over,
});

const serverRecipe = (over: Partial<SyncRecipeRowDto>): SyncRecipeRowDto => ({
  id: 'server-recipe-1',
  title: 'Fra serveren',
  description: null,
  servings: 4,
  notes: null,
  createdAt: 1000,
  updatedAt: 2000,
  deletedAt: null,
  ingredients: [
    { id: 'ing-1', name: 'Mel', quantity: 400, unit: 'g', scaling: 'linear', sortOrder: 0 },
  ],
  instructions: [{ id: 'ins-1', text: 'Bland.', sortOrder: 0 }],
  ...over,
});

const sampleRecipe = () => ({
  title: 'Lokal',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Sukker', quantity: 100, unit: 'g' }],
  instructions: [{ text: 'Rør.' }],
});

describe('applyPull', () => {
  it('inserts absent rows with dirty 0, aggregates included', () => {
    const db = makeTestDb();

    applyPull(db, emptyPull({ recipes: [serverRecipe({})] }));

    const row = db.select().from(recipes).where(eq(recipes.id, 'server-recipe-1')).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.dirty).toBe(0);
    expect(row.updatedAt).toBe(2000);
    const children = db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, 'server-recipe-1'))
      .all();
    expect(children.map((c) => c.id)).toEqual(['ing-1']);
  });

  it('applies server state unconditionally over clean local rows, even older', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0, updatedAt: 9999 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 500 })] }));

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.updatedAt).toBe(500);
    expect(row.dirty).toBe(0);
  });

  it('keeps a dirty local row that is newer than the server row', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ updatedAt: 3000 }).run(); // dirty stays 1 from create

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 2000 })] }));

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Lokal');
    expect(row.dirty).toBe(1);
  });

  it('replaces a dirty local row on server tie or newer, clearing dirty', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ updatedAt: 2000 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 2000 })] }));

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.dirty).toBe(0);
    const children = db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, localId))
      .all();
    expect(children.map((c) => c.name)).toEqual(['Mel']);
  });

  it('applies tombstones and hides nothing physically', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();

    applyPull(
      db,
      emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 5000, deletedAt: 5000 })] })
    );

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.deletedAt).toBe(5000);
    expect(row.dirty).toBe(0);
  });

  it('inserts tombstones for rows never seen locally', () => {
    const db = makeTestDb();

    applyPull(
      db,
      emptyPull({
        recipes: [serverRecipe({ id: 'ghost', updatedAt: 5000, deletedAt: 5000, ingredients: [], instructions: [] })],
      })
    );

    const row = db.select().from(recipes).where(eq(recipes.id, 'ghost')).get()!;
    expect(row.deletedAt).toBe(5000);
  });

  it('resurrects a local tombstone from a newer live server row', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    const now = db.select().from(recipes).get()!.updatedAt;
    db.update(recipes).set({ deletedAt: now, dirty: 0 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: now + 1000 })] }));

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.deletedAt).toBeNull();
    expect(row.title).toBe('Fra serveren');
  });

  it('merges meal-plan rows (needs the recipe present) and shopping rows', () => {
    const db = makeTestDb();

    applyPull(
      db,
      emptyPull({
        recipes: [serverRecipe({})],
        mealPlanEntries: [
          {
            id: 'entry-1',
            date: '2026-07-25',
            recipeId: 'server-recipe-1',
            servings: 2,
            sortOrder: 0,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
        shoppingItems: [
          {
            id: 'item-1',
            name: 'Melk',
            normalizedName: 'melk',
            quantity: 1000,
            unit: 'ml',
            sources: '[]',
            status: 'active',
            purchasedAt: null,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
      })
    );

    expect(db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, 'entry-1')).get()!.dirty).toBe(0);
    const item = db.select().from(shoppingItems).where(eq(shoppingItems.id, 'item-1')).get()!;
    expect(item.status).toBe('active');
    expect(item.dirty).toBe(0);
  });

  it('dirty shopping edits older than server are replaced', () => {
    const db = makeTestDb();
    db.insert(shoppingItems)
      .values({
        id: 'item-1',
        name: 'Melk',
        normalizedName: 'melk',
        quantity: 500,
        unit: 'ml',
        sources: '[]',
        status: 'active',
        purchasedAt: null,
        createdAt: 1000,
        updatedAt: 1500,
        dirty: 1,
      })
      .run();

    applyPull(
      db,
      emptyPull({
        shoppingItems: [
          {
            id: 'item-1',
            name: 'Melk',
            normalizedName: 'melk',
            quantity: 1000,
            unit: 'ml',
            sources: '[]',
            status: 'purchased',
            purchasedAt: 2000,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
      })
    );

    const item = db.select().from(shoppingItems).where(eq(shoppingItems.id, 'item-1')).get()!;
    expect(item.status).toBe('purchased');
    expect(item.quantity).toBe(1000);
    expect(item.dirty).toBe(0);
  });

  it('applies recipes before meal-plan entries so same-pull references resolve', () => {
    const db = makeTestDb();
    // Entry referencing a recipe arriving in the SAME pull — FK requires
    // insertion order recipes → entries.
    expect(() =>
      applyPull(
        db,
        emptyPull({
          recipes: [serverRecipe({})],
          mealPlanEntries: [
            {
              id: 'entry-1',
              date: '2026-07-25',
              recipeId: 'server-recipe-1',
              servings: 2,
              sortOrder: 0,
              createdAt: 1000,
              updatedAt: 2000,
              deletedAt: null,
            },
          ],
        })
      )
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/sync-apply.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/sync/apply.ts`:

```ts
import { eq } from 'drizzle-orm';

import { mealPlanEntries, recipeIngredients, recipeInstructions, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import type {
  SyncMealPlanRowDto,
  SyncPullResponseDto,
  SyncRecipeRowDto,
  SyncShoppingRowDto,
} from '../api/types';

// Apply-writers for pulled rows. These NEVER go through the repository
// functions: repos stamp dirty = 1 (a local change to upload); applying
// server state must land with dirty = 0 or every pull would re-push.
//
// LWW rule per row (lookup by id, tombstones included):
//   absent            -> insert server state
//   local clean       -> apply server state unconditionally (server is truth)
//   local dirty       -> apply iff server updatedAt >= local updatedAt
//                        (a tied push returns superseded, so ties defer to
//                        the server); otherwise local wins the next push.
function shouldApply(local: { dirty: number; updatedAt: number } | undefined, serverUpdatedAt: number): boolean {
  if (!local) return true;
  if (local.dirty === 0) return true;
  return serverUpdatedAt >= local.updatedAt;
}

function applyRecipe(db: DB, row: SyncRecipeRowDto): void {
  const local = db.select().from(recipes).where(eq(recipes.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    title: row.title,
    description: row.description,
    servings: row.servings,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(recipes).set(values).where(eq(recipes.id, row.id)).run();
  } else {
    db.insert(recipes).values({ id: row.id, ...values }).run();
  }

  // Aggregate replace, mirroring the local updateRecipe semantics.
  db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, row.id)).run();
  db.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, row.id)).run();
  for (const ing of row.ingredients) {
    db.insert(recipeIngredients)
      .values({
        id: ing.id,
        recipeId: row.id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling === 'fixed' ? 'fixed' : 'linear',
        sortOrder: ing.sortOrder,
      })
      .run();
  }
  for (const step of row.instructions) {
    db.insert(recipeInstructions)
      .values({ id: step.id, recipeId: row.id, text: step.text, sortOrder: step.sortOrder })
      .run();
  }
}

function applyMealPlanEntry(db: DB, row: SyncMealPlanRowDto): void {
  const local = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    date: row.date,
    recipeId: row.recipeId,
    servings: row.servings,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(mealPlanEntries).set(values).where(eq(mealPlanEntries.id, row.id)).run();
  } else {
    db.insert(mealPlanEntries).values({ id: row.id, ...values }).run();
  }
}

function applyShoppingItem(db: DB, row: SyncShoppingRowDto): void {
  const local = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    name: row.name,
    normalizedName: row.normalizedName,
    quantity: row.quantity,
    unit: row.unit,
    sources: row.sources,
    status: row.status === 'purchased' ? ('purchased' as const) : ('active' as const),
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(shoppingItems).set(values).where(eq(shoppingItems.id, row.id)).run();
  } else {
    db.insert(shoppingItems).values({ id: row.id, ...values }).run();
  }
}

export function applyPull(db: DB, pull: SyncPullResponseDto): void {
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    // Recipes first: same-pull meal-plan rows may reference them (FK).
    for (const row of pull.recipes) applyRecipe(txDb, row);
    for (const row of pull.mealPlanEntries) applyMealPlanEntry(txDb, row);
    for (const row of pull.shoppingItems) applyShoppingItem(txDb, row);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 322/322 (312 + 10).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add pull apply-writers with LWW merge"
```

---

### Task 6: The engine — `syncNow()`

**Files:**
- Create: `lib/sync/engine.ts`
- Test: `__tests__/sync-engine.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5 (`ensureHousehold`, `getSyncCursor`, `storePullResult`, `getLastSyncedAt`, status marks, `collectDirty`, `applyPull`), slice ③ `apiFetch` + `getSession`.
- Produces (used by Task 7): `SyncResult = 'synced' | 'failed' | 'skipped'`, `syncNow(): Promise<SyncResult>`, `resetEngineForTests(): void`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sync-engine.test.ts`:

```ts
import { eq } from 'drizzle-orm';

import { apiFetch } from '../lib/api/client';
import { getSession } from '../lib/api/session';
import { createRecipe } from '../lib/db/recipes';
import { recipes } from '../lib/db/schema';
import { updateRecipe } from '../lib/db/recipes';
import { resetEngineForTests, syncNow } from '../lib/sync/engine';
import { getSyncCursor, getSyncHouseholdId, storePullResult } from '../lib/sync/cursor';
import { getSyncStatus, resetSyncStatusForTests } from '../lib/sync/status';
import { makeTestDb } from './helpers/testDb';

jest.mock('../lib/api/client', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
}));

const mockDbHolder: { db: unknown } = { db: null };
jest.mock('../lib/db/client', () => ({
  get db() {
    return mockDbHolder.db;
  },
}));

const apiFetchMock = apiFetch as jest.Mock;
const getSessionMock = getSession as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'user-1', email: 'kari@example.test', displayName: 'Kari' },
  householdId: 'household-1',
  householdName: 'Hjemme',
};

const emptyPull = { recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 7 };

const sampleRecipe = () => ({
  title: 'Taco',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
  instructions: [{ text: 'Bland.' }],
});

function freshDb() {
  const db = makeTestDb();
  mockDbHolder.db = db;
  return db;
}

beforeEach(() => {
  resetEngineForTests();
  resetSyncStatusForTests();
  apiFetchMock.mockReset();
  getSessionMock.mockReturnValue(signedIn);
});

describe('syncNow gating', () => {
  it.each(['signedOut', 'restoring'])('skips with zero fetches when %s', async (status) => {
    freshDb();
    getSessionMock.mockReturnValue({ ...signedIn, status, householdId: null, user: null });

    await expect(syncNow()).resolves.toBe('skipped');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('syncNow cycle', () => {
  it('pushes dirty rows then pulls, storing the pull cursor only', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/push');
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncCursor(db)).toBe(7); // pull cursor, never the push's 999
    expect(getSyncHouseholdId(db)).toBe('household-1');
    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(0);
    expect(getSyncStatus().state).toBe('idle');
    expect(getSyncStatus().lastSyncedAt).toBeGreaterThan(0);
  });

  it('skips the push entirely when nothing is dirty', async () => {
    const db = freshDb();
    createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();
    storePullResult(db, 7, 'household-1');
    apiFetchMock.mockResolvedValueOnce({ ...emptyPull, cursor: 8 });

    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/changes?since=7');
  });

  it('a mid-flight edit stays dirty (compare-and-clear)', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockImplementationOnce(async () => {
        // The user edits while the push request is on the wire.
        updateRecipe(db, recipeId, { ...sampleRecipe(), title: 'Redigert' });
        return { results: { [recipeId]: 'applied' }, cursor: 999 };
      })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
  });

  it('conflict outcomes stay dirty and are counted', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'conflict' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
    expect(getSyncStatus().pendingConflicts).toBe(1);
  });

  it('a failed push fails the cycle without clearing or moving the cursor', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    storePullResult(db, 7, 'household-1');
    apiFetchMock.mockRejectedValueOnce(new Error('down'));

    await expect(syncNow()).resolves.toBe('failed');

    expect(db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!.dirty).toBe(1);
    expect(getSyncCursor(db)).toBe(7);
    expect(getSyncStatus().state).toBe('error');
  });

  it('household switch resets cursor and re-marks everything before pushing', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();
    storePullResult(db, 500, 'old-household');
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce(emptyPull);

    await syncNow();

    // The push happened (row was re-marked dirty by the switch)...
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/push');
    // ...and the pull ran from zero.
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncHouseholdId(db)).toBe('household-1');
  });

  it('coalesces concurrent callers into the running cycle plus one follow-up', async () => {
    const db = freshDb();
    createRecipe(db, sampleRecipe());
    let releasePush: (value: unknown) => void = () => {};
    apiFetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releasePush = resolve;
          })
      )
      .mockResolvedValue(emptyPull);

    const first = syncNow();
    const second = syncNow();
    const third = syncNow();
    expect(second).toBe(first);
    expect(third).toBe(first);

    releasePush({ results: {}, cursor: 1 });
    await first;
    // Allow the queued follow-up cycle to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // First cycle: push + pull. Follow-up: pull only (nothing dirty after... 
    // the push cleared nothing here, rows stay dirty -> push + pull again).
    expect(apiFetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('applies pulled rows through the merge', async () => {
    const db = freshDb();
    storePullResult(db, 0, 'household-1');
    apiFetchMock.mockResolvedValueOnce({
      recipes: [
        {
          id: 'server-1',
          title: 'Fra serveren',
          description: null,
          servings: 4,
          notes: null,
          createdAt: 1000,
          updatedAt: 2000,
          deletedAt: null,
          ingredients: [],
          instructions: [],
        },
      ],
      mealPlanEntries: [],
      shoppingItems: [],
      cursor: 3,
    });

    await syncNow();

    expect(db.select().from(recipes).where(eq(recipes.id, 'server-1')).get()!.dirty).toBe(0);
    expect(getSyncCursor(db)).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/sync-engine.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/sync/engine.ts`:

```ts
import { and, eq } from 'drizzle-orm';

import { apiFetch } from '../api/client';
import { getSession } from '../api/session';
import type { SyncPullResponseDto, SyncPushResponseDto } from '../api/types';
import { db } from '../db/client';
import { mealPlanEntries, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import { applyPull } from './apply';
import { collectDirty, type DirtyBatch } from './collect';
import { ensureHousehold, getSyncCursor, storePullResult } from './cursor';
import { markError, markIdle, markSyncing } from './status';

export type SyncResult = 'synced' | 'failed' | 'skipped';

let running: Promise<SyncResult> | null = null;
let queued = false;

// One cycle at a time; triggers landing mid-cycle coalesce into exactly one
// follow-up run (their data is picked up by that run's collect).
export function syncNow(): Promise<SyncResult> {
  if (running) {
    queued = true;
    return running;
  }
  running = runCycle().finally(() => {
    running = null;
    if (queued) {
      queued = false;
      void syncNow();
    }
  });
  return running;
}

async function runCycle(): Promise<SyncResult> {
  const session = getSession();
  if (session.status !== 'signedIn' || !session.householdId) return 'skipped';

  markSyncing();
  try {
    ensureHousehold(db, session.householdId);

    const batch = collectDirty(db);
    let conflicts = 0;
    if (!batch.isEmpty) {
      const response = await apiFetch<SyncPushResponseDto>('/api/v1/sync/push', {
        method: 'POST',
        body: batch.request,
      });
      conflicts = clearPushed(db, batch, response.results);
    }

    const since = getSyncCursor(db);
    const pull = await apiFetch<SyncPullResponseDto>(`/api/v1/sync/changes?since=${since}`);
    applyPull(db, pull);
    storePullResult(db, pull.cursor, session.householdId);

    markIdle(Date.now(), conflicts);
    return 'synced';
  } catch {
    markError();
    return 'failed';
  }
}

// Compare-and-clear: dirty drops to 0 only if updatedAt still equals the
// value we pushed — an edit landing mid-flight keeps its dirty flag and
// wins the next cycle. Conflicts stay dirty and are surfaced in status.
function clearPushed(database: DB, batch: DirtyBatch, results: Record<string, string>): number {
  let conflicts = 0;
  const tables = [
    { table: recipes, stamps: batch.stamps.recipes },
    { table: mealPlanEntries, stamps: batch.stamps.mealPlanEntries },
    { table: shoppingItems, stamps: batch.stamps.shoppingItems },
  ] as const;
  for (const { table, stamps } of tables) {
    for (const [id, readUpdatedAt] of stamps) {
      const outcome = results[id];
      if (outcome === 'applied' || outcome === 'superseded') {
        database
          .update(table)
          .set({ dirty: 0 })
          .where(and(eq(table.id, id), eq(table.updatedAt, readUpdatedAt)))
          .run();
      } else if (outcome === 'conflict') {
        conflicts += 1;
      }
    }
  }
  return conflicts;
}

export function resetEngineForTests(): void {
  running = null;
  queued = false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 331/331 (322 + 9).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add the sync engine cycle"
```

---

### Task 7: Triggers, status line, wiring, docs

**Files:**
- Create: `lib/sync/trigger.ts`
- Modify: `lib/db/recipes.ts`, `lib/db/mealPlan.ts`, `lib/db/shoppingList.ts`, `app/_layout.tsx`, `components/settings/AccountSection.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`, root `docs/TESTING.md`
- Test: `__tests__/sync-trigger.test.ts`, additions to `__tests__/account-section.test.tsx`

**Interfaces:**
- Consumes: Task 6 `syncNow` (loaded LAZILY via dynamic import — repos must not pull the engine's `lib/db/client` import into node tests); Task 3 `useSyncStatus`, `getLastSyncedAt`, `initLastSyncedAt`; slice ③ `getSession`.
- Produces: `scheduleSync(): void` (debounced ~2 s, signed-in gated), `initSyncTriggers(): () => void` (AppState wiring, returns unsubscribe).

- [ ] **Step 1: Write the failing trigger tests**

Create `__tests__/sync-trigger.test.ts`:

```ts
import { getSession } from '../lib/api/session';
import { syncNow } from '../lib/sync/engine';
import { scheduleSync } from '../lib/sync/trigger';

jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
}));

jest.mock('../lib/sync/engine', () => ({
  syncNow: jest.fn(async () => 'synced'),
}));

const getSessionMock = getSession as jest.Mock;
const syncNowMock = syncNow as jest.Mock;

const signedIn = {
  status: 'signedIn',
  user: { id: 'u', email: 'e', displayName: 'd' },
  householdId: 'h',
  householdName: 'n',
};
const signedOut = { status: 'signedOut', user: null, householdId: null, householdName: null };

beforeEach(() => {
  jest.useFakeTimers();
  syncNowMock.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('scheduleSync', () => {
  it('debounces bursts into one sync', async () => {
    getSessionMock.mockReturnValue(signedIn);

    scheduleSync();
    scheduleSync();
    scheduleSync();
    expect(syncNowMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).toHaveBeenCalledTimes(1);
  });

  it('is a no-op signed out — the timer never even starts', () => {
    getSessionMock.mockReturnValue(signedOut);

    scheduleSync();
    jest.advanceTimersByTime(5000);

    expect(syncNowMock).not.toHaveBeenCalled();
  });

  it('gates again at fire time (sign-out during the debounce window)', async () => {
    getSessionMock.mockReturnValueOnce(signedIn).mockReturnValue(signedOut);

    scheduleSync();
    jest.advanceTimersByTime(2100);
    await Promise.resolve();
    await Promise.resolve();

    expect(syncNowMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/sync-trigger.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the trigger module**

Create `lib/sync/trigger.ts`:

```ts
import { AppState } from 'react-native';

import { getSession } from '../api/session';

// The engine is imported LAZILY at fire time: repositories call
// scheduleSync(), and a static engine import would drag lib/db/client
// (expo-sqlite) into every node-side repository test. Fire only happens
// signed in, which node tests never are.
async function fireSync(): Promise<void> {
  if (getSession().status !== 'signedIn') return;
  const engine = await import('./engine');
  void engine.syncNow();
}

let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

export function scheduleSync(): void {
  if (getSession().status !== 'signedIn') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void fireSync();
  }, DEBOUNCE_MS);
}

// Foreground trigger. Returns the unsubscribe for the layout effect.
export function initSyncTriggers(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void fireSync();
  });
  return () => subscription.remove();
}
```

- [ ] **Step 4: Hook the repositories**

In `lib/db/recipes.ts`, `lib/db/mealPlan.ts`, `lib/db/shoppingList.ts`: `import { scheduleSync } from '../sync/trigger';` and add `scheduleSync();` as the last statement (after the transaction/write, before `return` where present) of: `createRecipe`, `updateRecipe`, `softDeleteRecipe`; `addPlanEntry`, `movePlanEntry`, `setPlanEntryServings`, `removePlanEntry`; `addItems`, `purchaseItem`, `restoreItem`. (`addManualItem`/`readdItem` route through `addItems`.) Example for `createRecipe`:

```ts
export function createRecipe(db: DB, input: RecipeInput): string {
  const id = newId();
  const now = Date.now();
  db.transaction((tx) => {
    // ... unchanged ...
  });
  scheduleSync();
  return id;
}
```

Run the repository test files now: `npx jest __tests__ -t repository` (or the three repo files directly).
Expected: still green — `scheduleSync` no-ops because node tests are never signed in (session module is real; secure-store mock holds no token; status is `signedOut`).

- [ ] **Step 5: Wire the layout and the Account section**

In `app/_layout.tsx`: add imports

```tsx
import { restoreSession } from '../lib/api/client';
import { getLastSyncedAt } from '../lib/sync/cursor';
import { syncNow } from '../lib/sync/engine';
import { initLastSyncedAt } from '../lib/sync/status';
import { initSyncTriggers } from '../lib/sync/trigger';
```

and replace the existing restore effect with:

```tsx
  useEffect(() => {
    initLastSyncedAt(getLastSyncedAt(db));
    void restoreSession().then(() => syncNow());
    return initSyncTriggers();
  }, []);
```

In `components/settings/AccountSection.tsx`: add imports

```tsx
import { syncNow } from '../../lib/sync/engine';
import { useSyncStatus } from '../../lib/sync/status';
```

call `const syncStatus = useSyncStatus();` next to `useSession()`, add a formatter above the component:

```tsx
function syncStatusLine(status: ReturnType<typeof useSyncStatus>): string {
  if (status.state === 'syncing') return t('sync.syncing');
  if (status.state === 'error') return t('sync.failed');
  if (status.lastSyncedAt === null) return t('sync.never');
  const time = new Date(status.lastSyncedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return t('sync.lastSynced', { time });
}
```

and insert, in the signed-in branch directly under the email `<Text>` block:

```tsx
      <View className="mb-3 flex-row items-center gap-3">
        <Text testID="sync-status-line" className="font-body text-sm text-ink">
          {syncStatusLine(syncStatus)}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void syncNow()}>
          <Text className="font-body text-sm text-ink underline">{t('sync.now')}</Text>
        </Pressable>
      </View>
```

i18n — add to `lib/i18n/en.json` (top-level `"sync"` key):

```json
  "sync": {
    "lastSynced": "Last synced %{time}",
    "never": "Not synced yet",
    "syncing": "Syncing…",
    "failed": "Sync failed — will retry",
    "now": "Sync now"
  }
```

and to `lib/i18n/nb.json`:

```json
  "sync": {
    "lastSynced": "Sist synkronisert %{time}",
    "never": "Ikke synkronisert ennå",
    "syncing": "Synkroniserer…",
    "failed": "Synkronisering feilet — prøver igjen",
    "now": "Synkroniser nå"
  }
```

- [ ] **Step 6: Account-section tests**

Append to `__tests__/account-section.test.tsx` — the file needs two new mocks (compile-forced by the new imports; add them next to the existing ones):

```tsx
jest.mock('../lib/sync/engine', () => ({
  syncNow: jest.fn(async () => 'synced'),
}));
jest.mock('../lib/sync/status', () => ({
  useSyncStatus: jest.fn(() => ({ state: 'idle', lastSyncedAt: null, pendingConflicts: 0 })),
}));
```

with imports `import { syncNow } from '../lib/sync/engine';` and `import { useSyncStatus } from '../lib/sync/status';`, then new tests in the signed-in describe:

```tsx
  it('shows the sync status line and triggers a manual sync', async () => {
    (useSyncStatus as jest.Mock).mockReturnValue({
      state: 'idle',
      lastSyncedAt: null,
      pendingConflicts: 0,
    });
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('Not synced yet')).toBeOnTheScreen();
    await act(async () => {
      fireEvent.press(screen.getByText('Sync now'));
    });
    expect(syncNow).toHaveBeenCalled();
  });

  it('shows the error state', async () => {
    (useSyncStatus as jest.Mock).mockReturnValue({
      state: 'error',
      lastSyncedAt: 1753350000000,
      pendingConflicts: 0,
    });
    render(<AccountSection />);
    await act(async () => {});

    expect(screen.getByText('Sync failed — will retry')).toBeOnTheScreen();
  });
```

The settings-screen test renders the section too — if compilation now demands the same two mocks there, add exactly those `jest.mock` entries and nothing else (disclose it).

- [ ] **Step 7: Run the full gate**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: 336/336 (331 + 3 trigger + 2 section). Existing screen tests untouched beyond the disclosed compile-forced mocks. Export bundles cleanly.

- [ ] **Step 8: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Sync engine (manual pass)

Backend running (`docker compose up -d` in `backend/`). Two devices (or emulator + phone) signed into the SAME household give the full picture.

- First sign-in on a device with local recipes: within a couple of seconds the Account section shows "Last synced …"; the other device gets the recipes on its next sync (foreground it, or Sync now).
- Edit a recipe on device A → appears on device B after foregrounding B.
- Delete a recipe on A → disappears from B. Re-add-style flows (shelf re-add) sync as new items.
- Edit the SAME recipe on both devices while B is backgrounded → the later edit wins everywhere, silently.
- Airplane mode on A, make edits → "Sync failed — will retry" after a trigger; disable airplane mode, foreground → edits flow, status recovers.
- Join a household with local content → your content appears in the joined household on both devices; leave → your device re-populates your fresh personal household.
- Sign out → status line gone, app fully local; sign back in → converges again without duplicates.
- Purchased-shelf history, plan entries and shopping items all travel, including their tombstones (deleted things stay deleted on both sides).
```

- [ ] **Step 9: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: wire sync triggers, status line and startup sync"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (serialized orchestrator + coalescing + push-before-pull → T6), 2 (settings keys, pull-cursor-only → T3/T6), 3 (switch reset = adoption, household id written only with pulls → T3/T6), 4 (collect/mapping/compare-and-clear/conflict-count/empty-skip → T4/T6), 5 (apply-writers dirty:0, merge matrix, aggregate replace, tombstone insert, resurrect → T5), 6 (gating, restore-then-sync, AppState, debounced repo trigger, manual → T7 + T6 gating tests), 7 (status store + persisted lastSyncedAt + Account line → T3/T7), 8 (guards + notDeleted → T1; quiesce → T2), 9 (failure semantics → T6 tests). Goals' signed-out invariance: T6 gating tests + T7 trigger no-op tests.
- **Judgment calls:** the engine imports `db` statically (it is only ever loaded lazily via trigger.ts or from _layout/AccountSection where `lib/db/client` is either real or already mocked); the engine test therefore mocks `lib/db/client` with a getter-backed holder. `ensureHousehold` runs inside the cycle (not at trigger time) so a failed adoption re-runs naturally. `clearPushed` runs after the push, before the pull — pull-applied rows then overwrite cleanly by the merge rules. Conflict count resets each cycle (it is a per-cycle surface, not an accumulator). The trigger double-gates (schedule time + fire time) so a sign-out during the debounce window stays silent. `toLocaleTimeString` for the status time — no new date helper needed.
- **Type consistency check:** `DirtyStamps`/`DirtyBatch` shapes match between T4 definition and T6 usage; DTO names (`SyncPullResponseDto` etc.) consistent across T3/T4/T5/T6; `syncNow`/`resetEngineForTests`/`scheduleSync`/`initSyncTriggers`/status function names identical across definition and usage; `notDeleted` signature matches all call sites; `pendingRefresh` name matches T2 test/impl and mock addition.
- **Mock-prefix rule:** engine test uses `mockDbHolder` (prefixed) inside its `jest.mock` factory; trigger and section tests reference only imported jest.fn mocks re-cast after import — compliant.
