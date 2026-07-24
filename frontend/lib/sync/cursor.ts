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
