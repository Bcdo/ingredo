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
  return createRecipe(db, {
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

    const id1 = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });
    const id2 = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 6 });
    addPlanEntry(db, { date: '2026-07-08', recipeId, servings: 2 });

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
    addPlanEntry(db, { date: '2026-07-08', recipeId, servings: 4 });
    const moving = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    movePlanEntry(db, moving, '2026-07-08');

    const moved = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, moving)).get();
    expect(moved?.date).toBe('2026-07-08');
    expect(moved?.sortOrder).toBe(1);
  });

  it('updates servings', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    setPlanEntryServings(db, id, 7);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row?.servings).toBe(7);
  });

  it('hard-deletes an entry', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    removePlanEntry(db, id);

    expect(db.select().from(mealPlanEntries).all()).toHaveLength(0);
  });

  it('window join excludes entries whose recipe is soft-deleted', () => {
    const db = makeTestDb();
    const keep = seedRecipe(db, 'Keeper');
    const gone = seedRecipe(db, 'Goner');
    addPlanEntry(db, { date: '2026-07-07', recipeId: keep, servings: 4 });
    addPlanEntry(db, { date: '2026-07-07', recipeId: gone, servings: 4 });

    softDeleteRecipe(db, gone);

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
