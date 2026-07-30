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
// One transaction: a process kill between the tables must not leave the
// bucket half-adopted — a later cycle pinned to a DIFFERENT household
// would otherwise adopt the remainder, splitting a plan entry from its
// recipe across partitions.
export function adoptNullBucket(db: DB, householdId: string): void {
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    txDb.update(recipes).set({ householdId, dirty: 1 }).where(inHousehold(recipes, null)).run();
    txDb
      .update(mealPlanEntries)
      .set({ householdId, dirty: 1 })
      .where(inHousehold(mealPlanEntries, null))
      .run();
    txDb
      .update(shoppingItems)
      .set({ householdId, dirty: 1 })
      .where(inHousehold(shoppingItems, null))
      .run();
  });
}
