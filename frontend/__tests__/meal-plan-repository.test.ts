import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';

import {
  addPlanEntry,
  movePlanEntry,
  removePlanEntry,
  setPlanEntryServings,
} from '../lib/db/mealPlan';
import { createRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipes } from '../lib/db/schema';
import type { DB } from '../lib/db/types';

import { makeTestDb } from './helpers/testDb';

function seedRecipe(db: DB, title: string): string {
  return createRecipe(db, null, {
    title,
    description: null,
    servings: 4,
    notes: null,
    ingredients: [],
    instructions: [],
  });
}

describe('meal plan repository', () => {
  it('adds entries with per-day sort order and returns the id', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');

    const id1 = addPlanEntry(db, null, { date: '2026-07-07', recipeId, servings: 4 });
    const id2 = addPlanEntry(db, null, { date: '2026-07-07', recipeId, servings: 6 });
    addPlanEntry(db, null, { date: '2026-07-08', recipeId, servings: 2 });

    const rows = db
      .select()
      .from(mealPlanEntries)
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder))
      .all();
    expect(rows.map((r) => [r.id, r.date, r.sortOrder, r.servings])).toEqual([
      [id1, '2026-07-07', 0, 4],
      [id2, '2026-07-07', 1, 6],
      [rows[2].id, '2026-07-08', 0, 2],
    ]);
  });

  it('moves an entry to the end of the target day', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    addPlanEntry(db, null, { date: '2026-07-08', recipeId, servings: 4 });
    const moving = addPlanEntry(db, null, { date: '2026-07-07', recipeId, servings: 4 });

    movePlanEntry(db, null, moving, '2026-07-08');

    const moved = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, moving)).get();
    expect(moved?.date).toBe('2026-07-08');
    expect(moved?.sortOrder).toBe(1);
  });

  it('updates servings', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, null, { date: '2026-07-07', recipeId, servings: 4 });

    setPlanEntryServings(db, null, id, 7);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row?.servings).toBe(7);
  });

  it('tombstones an entry (not hard-delete)', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, null, { date: '2026-07-07', recipeId, servings: 4 });

    removePlanEntry(db, null, id);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
  });
});

describe('sync prep', () => {
  it('remove tombstones the entry instead of deleting it', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, null, { date: '2026-07-22', recipeId, servings: 2 });

    removePlanEntry(db, null, id);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.updatedAt).toBe(row!.deletedAt);
    expect(row!.dirty).toBe(1);
  });

  it('tombstoned entries do not consume sort orders', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const first = addPlanEntry(db, null, { date: '2026-07-22', recipeId, servings: 2 });
    removePlanEntry(db, null, first);

    const second = addPlanEntry(db, null, { date: '2026-07-22', recipeId, servings: 2 });

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, second)).get();
    expect(row!.sortOrder).toBe(0);
  });

  it('writes stamp the dirty flag', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, null, { date: '2026-07-22', recipeId, servings: 2 });
    db.update(mealPlanEntries).set({ dirty: 0 }).where(eq(mealPlanEntries.id, id)).run();

    setPlanEntryServings(db, null, id, 6);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row!.dirty).toBe(1);
  });

  it('window join excludes entries whose recipe is soft-deleted', () => {
    const db = makeTestDb();
    const keep = seedRecipe(db, 'Keeper');
    const gone = seedRecipe(db, 'Goner');
    addPlanEntry(db, null, { date: '2026-07-07', recipeId: keep, servings: 4 });
    addPlanEntry(db, null, { date: '2026-07-07', recipeId: gone, servings: 4 });

    softDeleteRecipe(db, null, gone);

    // Mirrors the screens' read query.
    const rows = db
      .select({ title: recipes.title })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, '2026-07-07'),
          lte(mealPlanEntries.date, '2026-07-13'),
          isNull(recipes.deletedAt)
        )
      )
      .all();
    expect(rows).toEqual([{ title: 'Keeper' }]);
  });
});

describe('tombstone write-guards', () => {
  it('movePlanEntry no-ops on a tombstoned entry', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const entryId = addPlanEntry(db, null, { date: '2026-07-20', recipeId, servings: 2 });
    removePlanEntry(db, null, entryId);
    const before = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;

    movePlanEntry(db, null, entryId, '2026-07-21');

    const after = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;
    expect(after.date).toBe('2026-07-20');
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('setPlanEntryServings no-ops on a tombstoned entry', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const entryId = addPlanEntry(db, null, { date: '2026-07-20', recipeId, servings: 2 });
    removePlanEntry(db, null, entryId);

    setPlanEntryServings(db, null, entryId, 6);

    const after = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;
    expect(after.servings).toBe(2);
  });
});
