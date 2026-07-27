# Per-Household Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync becomes per-household — each household has its own pull cursor, collect is scoped to the active partition, adoption shrinks to the NULL bucket, switch-as-adoption is retired, and a household change triggers a prompt sync.

**Architecture:** `sync_cursor.<householdId>` settings keys with a pure-DML migration carrying the legacy cursor forward; `ensureHousehold` replaced by idempotent `adoptNullBucket`; `collectDirty` scoped via `inHousehold`; the engine pins its household at cycle start and re-verifies before push, before pull, and before apply/store, aborting as `skipped` + queuing a follow-up on mismatch; `initSyncTriggers` gains a session subscription firing on household transitions.

**Tech Stack:** Expo SDK 54, drizzle/expo-sqlite (better-sqlite3 in tests), drizzle-kit `--custom` migration, Jest.

**Spec:** `docs/superpowers/specs/2026-07-27-per-household-sync-design.md`

## Global Constraints

- **No new user-facing strings** (bilingual app — nb/en untouched).
- **`household_id` comparisons live ONLY in `lib/db/predicates.ts`** — sync modules become legitimate CONSUMERS of `inHousehold` this slice (adoption's `WHERE` and collect's scoping call the predicate; writes in `set`/`values` remain plain tagging).
- **Switch moves and duplicates NOTHING** (headline): syncing household B never touches household A's rows, cursor, or dirty flags; re-mint fires only on true push conflicts.
- **Cursor-from-pulls-only is preserved per household**: only a successful pull writes `sync_cursor.<id>`.
- **Test replacements are named and disclosed** — the retired `ensureHousehold`/switch-as-adoption tests are replaced by adoption/isolation invariants, never silently deleted.
- **Repo signature convention:** `householdId` immediately after `db` in every changed function.
- Run all frontend commands from `frontend/`. Baseline: 431 tests passing, `npx tsc --noEmit` clean. Each task ends with `npm test` green, tsc clean, and a commit.
- `remint.ts`, `apply.ts`, `realtime.ts`, and all screens are UNTOUCHED this slice.

---

### Task 1: Migration 0006 — per-household cursor keys

**Files:**
- Generate+Modify: `frontend/drizzle/0006_per_household_cursors.sql` (+ `meta/_journal.json`, `meta/0006_snapshot.json`, `migrations.js` — via drizzle-kit)
- Test: `frontend/__tests__/household-migration.test.ts` (extend)

**Interfaces:**
- Produces: settings key `sync_cursor.<householdId>` seeded from the legacy pair; `sync_cursor` and `sync_household_id` keys removed. Task 2's `cursor.ts` reads the new key shape.

- [ ] **Step 1: Generate the custom migration**

Run: `npx drizzle-kit generate --custom --name per_household_cursors`
Expected: creates an empty `drizzle/0006_per_household_cursors.sql`, appends the journal entry, copies the snapshot (no schema change), and wires `m0006` into `migrations.js`.

- [ ] **Step 2: Write the migration SQL**

Full content of `drizzle/0006_per_household_cursors.sql`:

```sql
UPDATE `settings` SET `key` = 'sync_cursor.' || (SELECT `value` FROM `settings` WHERE `key` = 'sync_household_id') WHERE `key` = 'sync_cursor' AND EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'sync_household_id');--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('sync_cursor', 'sync_household_id');
```

The `DELETE` of `sync_cursor` only bites when the rename did not fire — a device where adoption started (`sync_cursor` = `'0'`) but no pull ever succeeded (`sync_household_id` absent, since `storePullResult` writes both together); dropping it restores clean cursor-0 semantics.

- [ ] **Step 3: Extend the migration test**

In `frontend/__tests__/household-migration.test.ts`, generalize the tag plumbing (the file currently splits tags around `0005`): derive `legacyTags` = every tag before `0005`, keep `partitionTag` (`0005…`), add `cursorTag` = the tag starting with `0006`. Add a new describe block:

```ts
describe('migration 0006 per-household cursors', () => {
  function makePartitionedDb(): InstanceType<typeof Database> {
    const sqlite = makeLegacyDb();
    applyMigration(sqlite, partitionTag);
    return sqlite;
  }

  function settingValue(sqlite: InstanceType<typeof Database>, key: string): string | undefined {
    const row = sqlite.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  it('carries a synced device cursor forward under its household key', () => {
    const sqlite = makePartitionedDb();
    sqlite.prepare(`INSERT INTO settings (key, value) VALUES ('sync_cursor', '42')`).run();
    sqlite.prepare(`INSERT INTO settings (key, value) VALUES ('sync_household_id', 'h1')`).run();

    applyMigration(sqlite, cursorTag);

    expect(settingValue(sqlite, 'sync_cursor.h1')).toBe('42');
    expect(settingValue(sqlite, 'sync_cursor')).toBeUndefined();
    expect(settingValue(sqlite, 'sync_household_id')).toBeUndefined();
  });

  it('drops an orphaned cursor from a never-completed first sync', () => {
    const sqlite = makePartitionedDb();
    sqlite.prepare(`INSERT INTO settings (key, value) VALUES ('sync_cursor', '0')`).run();

    applyMigration(sqlite, cursorTag);

    expect(settingValue(sqlite, 'sync_cursor')).toBeUndefined();
    const rows = sqlite.prepare(`SELECT key FROM settings WHERE key LIKE 'sync_cursor%'`).all();
    expect(rows).toHaveLength(0);
  });

  it('is a no-op on a device that never synced', () => {
    const sqlite = makePartitionedDb();

    applyMigration(sqlite, cursorTag);

    const rows = sqlite
      .prepare(`SELECT key FROM settings WHERE key IN ('sync_cursor', 'sync_household_id')`)
      .all();
    expect(rows).toHaveLength(0);
  });
});
```

Note: the two existing `0005` tests must keep passing — when generalizing `legacyTags`, keep them applying only `0000`–`0004` before their seeding (that is what "every tag before `0005`" preserves).

- [ ] **Step 4: Run tests**

Run: `npm test -- household-migration`
Expected: 5 passing (2 existing + 3 new).
Run: `npm test`
Expected: 434 passing. (`makeTestDb` now also applies 0006, but no code reads the legacy keys in ways these tests exercise — the engine suite writes its own keys via `storePullResult` at runtime, after migrations.)
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add drizzle/ __tests__/household-migration.test.ts
git commit -m "feat: migrate sync cursor to per-household settings keys"
```

---

### Task 2: Per-household engine cycle (cursor, adoption, collect, pinned household)

**Files:**
- Modify: `frontend/lib/sync/cursor.ts`, `frontend/lib/sync/collect.ts`, `frontend/lib/sync/engine.ts`, `frontend/lib/sync/status.ts`
- Test: `frontend/__tests__/sync-cursor.test.ts`, `frontend/__tests__/sync-collect.test.ts`, `frontend/__tests__/sync-engine.test.ts` (updates + replacements), `frontend/__tests__/per-household-sync.test.ts` (new)

**Interfaces:**
- Consumes: `inHousehold` (predicates), `applyPull(db, pull, householdId)` (slice ②), slice ②'s `householdId` columns, Task 1's key shape.
- Produces (exact signatures):
  - `getSyncCursor(db, householdId: string): number`
  - `storePullResult(db, householdId: string, cursor: number): void`
  - `adoptNullBucket(db, householdId: string): void`
  - `collectDirty(db, householdId: string): DirtyBatch`
  - `markSkipped(): void` (status)
  - REMOVED: `ensureHousehold`, `getSyncHouseholdId` (grep for both must return only tests being replaced in this task)

- [ ] **Step 1: Rewrite `lib/sync/cursor.ts`**

Complete new file content:

```ts
import { eq } from 'drizzle-orm';

import { inHousehold } from '../db/predicates';
import { mealPlanEntries, recipes, settings, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';

// Device-local sync bookkeeping — must be excluded if settings ever sync.
const CURSOR_KEY_PREFIX = 'sync_cursor.';
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

// Each household carries its own cursor: switching back resumes
// incrementally instead of re-downloading. A missing key is a fresh
// start for THAT household.
export function getSyncCursor(db: DB, householdId: string): number {
  const stored = read(db, CURSOR_KEY_PREFIX + householdId);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getLastSyncedAt(db: DB): number | null {
  const stored = read(db, LAST_SYNCED_KEY);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) ? parsed : null;
}

// Only a successful pull moves the household's cursor.
export function storePullResult(db: DB, householdId: string, cursor: number): void {
  write(db, CURSOR_KEY_PREFIX + householdId, String(cursor));
  write(db, LAST_SYNCED_KEY, String(Date.now()));
}

// Adoption shrank to the NULL bucket: rows created before first sign-in
// join the active household, dirty so they upload — tombstones included,
// so pre-sign-in deletes replicate too. Idempotent, a no-op every cycle
// after the bucket empties. Rows of OTHER households are never touched:
// switching is not adoption (that machinery retired with this slice).
export function adoptNullBucket(db: DB, householdId: string): void {
  db.update(recipes).set({ householdId, dirty: 1 }).where(inHousehold(recipes, null)).run();
  db.update(mealPlanEntries)
    .set({ householdId, dirty: 1 })
    .where(inHousehold(mealPlanEntries, null))
    .run();
  db.update(shoppingItems)
    .set({ householdId, dirty: 1 })
    .where(inHousehold(shoppingItems, null))
    .run();
}
```

- [ ] **Step 2: Scope `lib/sync/collect.ts`**

`collectDirty(db: DB, householdId: string): DirtyBatch`. Add the import `import { inHousehold } from '../db/predicates';` and `and` from drizzle. The three dirty queries become:

```ts
  const dirtyRecipes = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.dirty, 1), inHousehold(recipes, householdId)))
    .all();
  const dirtyEntries = db
    .select()
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.dirty, 1), inHousehold(mealPlanEntries, householdId)))
    .all();
  const dirtyItems = db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.dirty, 1), inHousehold(shoppingItems, householdId)))
    .all();
```

Everything else (children mapping, stamps, isEmpty) unchanged.

- [ ] **Step 3: Add `markSkipped` to `lib/sync/status.ts`**

After `markError`:

```ts
// An aborted cycle (mid-flight household switch or sign-out) returns to
// idle without pretending a sync completed — lastSyncedAt and the
// conflict count stay as they were.
export function markSkipped(): void {
  status = { ...status, state: 'idle' };
  emit();
}
```

- [ ] **Step 4: Rewrite `runCycle` in `lib/sync/engine.ts`**

Update imports: `adoptNullBucket, getSyncCursor, storePullResult` from `./cursor` (drop `ensureHousehold`), add `markSkipped` to the `./status` import. New `runCycle`:

```ts
async function runCycle(): Promise<SyncResult> {
  const session = getSession();
  if (session.status !== 'signedIn' || !session.householdId) return 'skipped';
  const householdId = session.householdId;

  // The cycle is pinned to the household captured above. Requests carry
  // whatever token is CURRENT, so a rotation mid-cycle (switch, join,
  // leave, sign-out) would push this partition's rows into the new
  // claim's household or store a cursor under the wrong key — re-verify
  // at every await boundary and abort instead. The queued follow-up
  // syncs whatever household is active by then. The pre-push check also
  // guards the synchronous collect window against future refactors that
  // introduce earlier awaits.
  const stillCurrent = () => getSession().householdId === householdId;
  const abort = (): SyncResult => {
    queued = true;
    markSkipped();
    return 'skipped';
  };

  markSyncing();
  try {
    adoptNullBucket(db, householdId);

    const batch = collectDirty(db, householdId);
    let pendingConflicts = 0;
    if (!batch.isEmpty) {
      if (!stillCurrent()) return abort();
      const response = await apiFetch<SyncPushResponseDto>('/api/v1/sync/push', {
        method: 'POST',
        body: batch.request,
      });
      const { conflicts, conflictIds } = clearPushed(db, batch, response.results);
      const reminted = remintConflicted(db, conflictIds);
      if (reminted > 0) {
        // Re-minted rows are fresh inserts for the current household —
        // deliver them in an immediate follow-up cycle.
        queued = true;
      }
      pendingConflicts = conflicts - reminted;
    }

    if (!stillCurrent()) return abort();
    const since = getSyncCursor(db, householdId);
    const pull = await apiFetch<SyncPullResponseDto>(`/api/v1/sync/changes?since=${since}`);
    if (!stillCurrent()) return abort();
    applyPull(db, pull, householdId);
    storePullResult(db, householdId, pull.cursor);

    markIdle(Date.now(), pendingConflicts);
    return 'synced';
  } catch {
    markError();
    return 'failed';
  }
}
```

(`clearPushed` and everything else in the file unchanged.)

- [ ] **Step 5: Update `sync-cursor.test.ts` — disclosed replacements**

Retired WITH replacement (the switch-as-adoption contract is gone; the NULL-bucket contract replaces it):
- `'ensureHousehold is a no-op when the household matches'` → replaced by `'adoptNullBucket is idempotent — a second run adopts nothing'`
- `'ensureHousehold on a switch resets the cursor and marks everything dirty, tombstones included'` → replaced by `'adoptNullBucket adopts NULL rows with dirty set, tombstones included'`
- `'ensureHousehold with no stored household treats first sign-in as a switch'` → subsumed by the adoption tests (adoption no longer keys on stored state)
- `'re-tags every content row onto the adopted household'` (slice ②'s) → replaced by `'adoptNullBucket never touches other households rows'`

Updated in place: the two cursor-store tests use the new signatures and per-household keys:

```ts
  it('starts at cursor 0 per household with no lastSyncedAt', () => {
    const db = makeTestDb();
    expect(getSyncCursor(db, 'h1')).toBe(0);
    expect(getLastSyncedAt(db)).toBeNull();
  });

  it('storePullResult persists the household cursor and lastSyncedAt, independently per household', () => {
    const db = makeTestDb();
    storePullResult(db, 'h1', 7);
    expect(getSyncCursor(db, 'h1')).toBe(7);
    expect(getSyncCursor(db, 'h2')).toBe(0);
    storePullResult(db, 'h2', 3);
    expect(getSyncCursor(db, 'h1')).toBe(7);
    expect(getSyncCursor(db, 'h2')).toBe(3);
    expect(getLastSyncedAt(db)).toBeGreaterThan(0);
  });
```

New adoption tests — complete code (add a seeding helper at the top of the file; if the file already has row fixtures, reuse their field literals but keep this helper's shape):

```ts
function seedRows(
  db: DB,
  householdId: string | null,
  options: { dirty: 0 | 1; deletedAt?: number | null } = { dirty: 0 }
): void {
  const deletedAt = options.deletedAt ?? null;
  db.insert(recipes)
    .values({
      id: newId(), title: 'Suppe', servings: 2, householdId,
      createdAt: 1, updatedAt: 1, deletedAt, dirty: options.dirty,
    })
    .run();
  db.insert(mealPlanEntries)
    .values({
      id: newId(), date: '2026-07-27', recipeId: db.select().from(recipes).all()[0].id,
      servings: 2, sortOrder: 0, householdId,
      createdAt: 1, updatedAt: 1, deletedAt, dirty: options.dirty,
    })
    .run();
  db.insert(shoppingItems)
    .values({
      id: newId(), name: 'Melk', normalizedName: 'melk', sources: '[]', status: 'active',
      householdId, createdAt: 1, updatedAt: 1, deletedAt, dirty: options.dirty,
    })
    .run();
}

const contentTables = [recipes, mealPlanEntries, shoppingItems] as const;

describe('adoptNullBucket', () => {
  it('adopts NULL rows with dirty set, tombstones included', () => {
    const db = makeTestDb();
    seedRows(db, null, { dirty: 0 });
    seedRows(db, null, { dirty: 0, deletedAt: 5 });

    adoptNullBucket(db, 'h1');

    for (const table of contentTables) {
      const rows = db.select().from(table).all();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.householdId === 'h1')).toBe(true);
      expect(rows.every((row) => row.dirty === 1)).toBe(true);
    }
  });

  it('is idempotent — a second run adopts nothing', () => {
    const db = makeTestDb();
    seedRows(db, null, { dirty: 0 });
    adoptNullBucket(db, 'h1');
    for (const table of contentTables) db.update(table).set({ dirty: 0 }).run();

    adoptNullBucket(db, 'h1');

    for (const table of contentTables) {
      const rows = db.select().from(table).all();
      expect(rows.every((row) => row.householdId === 'h1')).toBe(true);
      expect(rows.every((row) => row.dirty === 0)).toBe(true);
    }
  });

  it('never touches other households rows', () => {
    const db = makeTestDb();
    seedRows(db, 'h2', { dirty: 0 });

    adoptNullBucket(db, 'h1');

    for (const table of contentTables) {
      const rows = db.select().from(table).all();
      expect(rows.every((row) => row.householdId === 'h2')).toBe(true);
      expect(rows.every((row) => row.dirty === 0)).toBe(true);
    }
  });
});
```

(`seedRows`'s meal-plan entry references the recipe inserted in the same call via the first-recipe lookup — if the FK ordering trips on the second `seedRows` call, thread the recipe id explicitly instead; the assertions are mandated, the plumbing follows the file.)

- [ ] **Step 6: Update `sync-collect.test.ts`**

All existing `collectDirty(db)` calls change signature. `collectDirty` now REQUIRES a `string` household — but the file's fixtures create rows via repos with the `null` partition. Resolve by adopting first, matching the real engine order: in each existing test, after the fixture writes, run `adoptNullBucket(db, 'h1')` and call `collectDirty(db, 'h1')` (import `adoptNullBucket` from `../lib/sync/cursor`). Where a test's assertions depend on `dirty: 0` rows staying clean (e.g. `'only dirty rows are collected'`), seed those rows AFTER the adopt call or insert them directly with `householdId: 'h1'` so adoption's dirty-marking doesn't invalidate the fixture — preserve each test's original point.

Add one scoping test (complete code):

```ts
  it('collects only the active household — other partitions and the NULL bucket stay home', () => {
    const db = makeTestDb();
    const insertRecipe = (id: string, householdId: string | null) =>
      db.insert(recipes)
        .values({ id, title: id, servings: 2, householdId, createdAt: 1, updatedAt: 1, dirty: 1 })
        .run();
    insertRecipe('r-h1', 'h1');
    insertRecipe('r-h2', 'h2');
    insertRecipe('r-null', null);
    db.insert(shoppingItems)
      .values({
        id: 's-h1', name: 'Melk', normalizedName: 'melk', sources: '[]', status: 'active',
        householdId: 'h1', createdAt: 1, updatedAt: 1, dirty: 1,
      })
      .run();
    db.insert(mealPlanEntries)
      .values({
        id: 'e-h2', date: '2026-07-27', recipeId: 'r-h2', servings: 2, sortOrder: 0,
        householdId: 'h2', createdAt: 1, updatedAt: 1, dirty: 1,
      })
      .run();

    const batch = collectDirty(db, 'h1');
    expect(batch.isEmpty).toBe(false);
    expect(batch.request.recipes?.map((row) => row.id)).toEqual(['r-h1']);
    expect(batch.request.shoppingItems?.map((row) => row.id)).toEqual(['s-h1']);
    expect(batch.request.mealPlanEntries).toBeNull();

    expect(collectDirty(db, 'h3').isEmpty).toBe(true);
  });
```

- [ ] **Step 7: Update `sync-engine.test.ts` — disclosed replacement + signature updates**

- Remove `getSyncHouseholdId` from the imports; thread the new `getSyncCursor(db, 'household-1')` / `storePullResult(db, 'household-1', 7)` signatures everywhere.
- The assertion `expect(getSyncHouseholdId(db)).toBe('household-1')` in the first cycle test is deleted (the concept retired); the cursor assertion stays.
- Retired WITH replacement: `'household switch resets cursor and re-marks everything before pushing'` → the new invariants live in `per-household-sync.test.ts` (Step 8) — note the replacement in the test file where the old test sat, as a one-line comment: `// switch-as-adoption retired in slice ③ — see per-household-sync.test.ts for the switch invariants.`
- The mid-flight-edit test's comment mentioning `ensureHousehold` re-tagging: reword to reference `adoptNullBucket` adoption of the NULL-bucket fixture (`createRecipe(db, null, …)` rows get adopted at cycle start — behavior equivalent for the fixture, comment must not name retired machinery).

- [ ] **Step 8: Write `__tests__/per-household-sync.test.ts` (headline invariants)**

Same mock rig as `sync-engine.test.ts` (copy its module-mock header: apiFetch, getSession, trigger, db holder). Sessions: `asHousehold('h1')` / `asHousehold('h2')` helpers returning signedIn sessions with that householdId. Tests:

```ts
  it('switching households moves and duplicates nothing', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, 'h1', sampleRecipe());
    // cycle as h1: push applied, pull empty cursor 5
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 999 })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 5 });
    await expect(syncNow()).resolves.toBe('synced');

    // switch to h2, cycle again: NOTHING to push (h1's row is clean and
    // out of scope), pull only
    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 2 });
    await expect(syncNow()).resolves.toBe('synced');

    expect(apiFetchMock).toHaveBeenCalledTimes(3); // one push total, two pulls
    const row = db.select().from(recipes).where(eq(recipes.id, recipeId)).get()!;
    expect(row.householdId).toBe('h1');
    expect(row.dirty).toBe(0);
    expect(db.select().from(recipes).all()).toHaveLength(1); // no duplicate, no re-mint
  });

  it('cursors are independent per household', async () => {
    const db = freshDb();
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock.mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 5 });
    await syncNow();
    expect(apiFetchMock.mock.calls[0][0]).toBe('/api/v1/sync/changes?since=0');

    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 9 });
    await syncNow();
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0'); // h2 starts fresh

    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock.mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 6 });
    await syncNow();
    expect(apiFetchMock.mock.calls[2][0]).toBe('/api/v1/sync/changes?since=5'); // h1 resumes

    expect(getSyncCursor(db, 'h1')).toBe(6);
    expect(getSyncCursor(db, 'h2')).toBe(9);
  });

  it('adopts the NULL bucket exactly once, into the first synced household', async () => {
    const db = freshDb();
    const recipeId = createRecipe(db, null, sampleRecipe());
    getSessionMock.mockReturnValue(asHousehold('h1'));
    apiFetchMock
      .mockResolvedValueOnce({ results: { [recipeId]: 'applied' }, cursor: 1 })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 1 });
    await expect(syncNow()).resolves.toBe('synced');
    expect(db.select().from(recipes).get()!.householdId).toBe('h1');

    // second cycle as h2: the row belongs to h1 now — nothing adopted,
    // nothing pushed
    getSessionMock.mockReturnValue(asHousehold('h2'));
    apiFetchMock.mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 1 });
    await expect(syncNow()).resolves.toBe('synced');
    expect(db.select().from(recipes).get()!.householdId).toBe('h1');
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
  });

  it('a household switch during the push aborts before the pull and queues a follow-up', async () => {
    const db = freshDb();
    createRecipe(db, 'h1', sampleRecipe());
    getSessionMock.mockReturnValue(asHousehold('h1'));
    let resolvedFollowUp = false;
    apiFetchMock
      .mockImplementationOnce(async () => {
        // token rotates mid-push: the session now claims h2
        getSessionMock.mockReturnValue(asHousehold('h2'));
        return { results: {}, cursor: 1 };
      })
      // the queued follow-up cycle runs as h2: pull only
      .mockImplementationOnce(async () => {
        resolvedFollowUp = true;
        return { recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 4 };
      });

    await expect(syncNow()).resolves.toBe('skipped');
    await Promise.resolve(); // let the queued follow-up start
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolvedFollowUp).toBe(true);
    expect(apiFetchMock.mock.calls[1][0]).toBe('/api/v1/sync/changes?since=0');
    expect(getSyncCursor(db, 'h1')).toBe(0); // nothing stored under h1
    expect(getSyncCursor(db, 'h2')).toBe(4); // follow-up synced h2
  });

  it('a household switch during the pull discards the response — no cross-partition apply or cursor', async () => {
    const db = freshDb();
    getSessionMock.mockReturnValue(asHousehold('h1'));
    const foreignRow = {
      id: 'r-foreign', title: 'Suppe', description: null, servings: 2, notes: null,
      createdAt: 1, updatedAt: 1, deletedAt: null, ingredients: [], instructions: [],
    };
    apiFetchMock
      .mockImplementationOnce(async () => {
        getSessionMock.mockReturnValue(asHousehold('h2'));
        return { recipes: [foreignRow], mealPlanEntries: [], shoppingItems: [], cursor: 8 };
      })
      .mockResolvedValueOnce({ recipes: [], mealPlanEntries: [], shoppingItems: [], cursor: 2 });

    await expect(syncNow()).resolves.toBe('skipped');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.select().from(recipes).all()).toHaveLength(0); // response discarded
    expect(getSyncCursor(db, 'h1')).toBe(0);
    expect(getSyncCursor(db, 'h2')).toBe(2); // follow-up synced h2 cleanly
  });
```

Adapt the mock-header and coalescing-wait plumbing to what `sync-engine.test.ts` actually does for its follow-up test (`'conflicted rows are re-minted and delivered by an automatic follow-up'`) — reuse its await pattern for queued cycles rather than the sketched `setTimeout` if the file has an established one. The assertions are mandated.

- [ ] **Step 9: Run everything**

Run: `npm test`
Expected: all suites green — 434 from Task 1, minus 4 retired cursor tests and 1 retired engine test, plus 3 adoption + 2 cursor-shape (rewritten in place, no count change) + 1 collect + 5 invariant tests ≈ 438; report the exact count.
Run: `npx tsc --noEmit` — clean. `npm run lint` — no new issues.
Also grep: `grep -rn "ensureHousehold\|getSyncHouseholdId" lib __tests__` must return nothing.

- [ ] **Step 10: Commit**

```bash
git add lib/sync/ __tests__/sync-cursor.test.ts __tests__/sync-collect.test.ts __tests__/sync-engine.test.ts __tests__/per-household-sync.test.ts
git commit -m "feat: per-household cursors, NULL-bucket adoption, pinned sync cycle"
```

---

### Task 3: Household-change sync trigger

**Files:**
- Modify: `frontend/lib/sync/trigger.ts`
- Test: `frontend/__tests__/sync-trigger.test.ts` (extend)

**Interfaces:**
- Consumes: `subscribeSession`/`getSession` (`lib/api/session.ts`), `fireSync` (module-internal).
- Produces: `initSyncTriggers()` now also fires a sync when the session household transitions to a different non-null value. Signature unchanged.

- [ ] **Step 1: Add the household-change subscription to `trigger.ts`**

Add `subscribeSession` to the session import. Replace `initSyncTriggers` with:

```ts
// Foreground + household-change triggers. Returns the unsubscribe for the
// layout effect. A household transition (sign-in, join, leave, switch)
// syncs the newly-active household promptly; a same-household session
// emit (token refresh) does not. Sign-out records null so signing back
// into the SAME household still counts as a transition.
export function initSyncTriggers(): () => void {
  let lastHouseholdId = getSession().householdId;
  const unsubscribeSession = subscribeSession(() => {
    const next = getSession().householdId;
    if (next === lastHouseholdId) return;
    lastHouseholdId = next;
    if (next !== null) void fireSync();
  });
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void fireSync();
  });
  return () => {
    unsubscribeSession();
    subscription.remove();
  };
}
```

`_layout.tsx` is untouched: the launch `restoreSession().then(() => syncNow())` stays (the engine's mutex+coalescing makes the overlap with this trigger free), and `initSyncTriggers` is already called in the same effect.

- [ ] **Step 2: Extend `sync-trigger.test.ts`**

The file mocks `../lib/api/session` with only `getSession`; extend the mock to capture the subscriber:

```ts
jest.mock('../lib/api/session', () => ({
  getSession: jest.fn(),
  subscribeSession: jest.fn(),
}));
```

Import `subscribeSession`, add `const subscribeSessionMock = subscribeSession as jest.Mock;`, and in the new describe block wire a manual emitter:

```ts
describe('household-change trigger', () => {
  function initWithSession(session: unknown): { emit: () => void; teardown: () => void } {
    getSessionMock.mockReturnValue(session);
    let subscriber: () => void = () => {};
    subscribeSessionMock.mockImplementation((listener: () => void) => {
      subscriber = listener;
      return () => {};
    });
    const teardown = initSyncTriggers();
    return { emit: () => subscriber(), teardown };
  }

  it('fires a sync when the session household changes', () => {
    const { emit, teardown } = initWithSession(signedOut);
    getSessionMock.mockReturnValue(signedIn); // householdId 'h'
    emit();
    expect(syncNowMock).toHaveBeenCalledTimes(1);
    teardown();
  });

  it('does not fire on a same-household emit (token refresh)', () => {
    const { emit, teardown } = initWithSession(signedIn);
    emit();
    expect(syncNowMock).not.toHaveBeenCalled();
    teardown();
  });

  it('sign-out then sign-in to the same household fires again', () => {
    const { emit, teardown } = initWithSession(signedIn);
    getSessionMock.mockReturnValue(signedOut);
    emit(); // records null, no fire
    expect(syncNowMock).not.toHaveBeenCalled();
    getSessionMock.mockReturnValue(signedIn);
    emit();
    expect(syncNowMock).toHaveBeenCalledTimes(1);
    teardown();
  });
});
```

Note: `fireSync` awaits a dynamic `import('./engine')` before calling `syncNow` — if the assertions race the microtask, follow the file's existing await pattern for `fireSync` (its debounce tests already handle this; reuse whatever flush idiom they use, e.g. `await Promise.resolve()` after `emit()` with the assertions made async).

Also verify the existing `initSyncTriggers` test coverage (AppState) still passes — the mock addition must not break the other describe blocks (they don't call `initSyncTriggers`; if any does, give it the `subscribeSessionMock.mockImplementation` returning a no-op unsubscribe in `beforeEach`).

- [ ] **Step 3: Run everything**

Run: `npm test -- sync-trigger`
Expected: existing 3 + new 3 passing.
Run: `npm test` — all green (Task 2's count + 3). `npx tsc --noEmit` — clean. `npm run lint` — no new issues.

- [ ] **Step 4: Commit**

```bash
git add lib/sync/trigger.ts __tests__/sync-trigger.test.ts
git commit -m "feat: sync promptly on household change"
```
