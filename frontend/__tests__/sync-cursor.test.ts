import { newId } from '../lib/db/id';
import { mealPlanEntries, recipes, shoppingItems } from '../lib/db/schema';
import {
  adoptNullBucket,
  getLastSyncedAt,
  getSyncCursor,
  storePullResult,
} from '../lib/sync/cursor';
import { makeTestDb } from './helpers/testDb';
import type { DB } from '../lib/db/types';

function seedRows(
  db: DB,
  householdId: string | null,
  options: { dirty: 0 | 1; deletedAt?: number | null } = { dirty: 0 }
): void {
  const deletedAt = options.deletedAt ?? null;
  const recipeId = newId();
  db.insert(recipes)
    .values({
      id: recipeId,
      title: 'Suppe',
      servings: 2,
      householdId,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
      dirty: options.dirty,
    })
    .run();
  db.insert(mealPlanEntries)
    .values({
      id: newId(),
      date: '2026-07-27',
      recipeId,
      servings: 2,
      sortOrder: 0,
      householdId,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
      dirty: options.dirty,
    })
    .run();
  db.insert(shoppingItems)
    .values({
      id: newId(),
      name: 'Melk',
      normalizedName: 'melk',
      sources: '[]',
      status: 'active',
      householdId,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
      dirty: options.dirty,
    })
    .run();
}

const contentTables = [recipes, mealPlanEntries, shoppingItems] as const;

describe('sync cursor store', () => {
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
});

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
