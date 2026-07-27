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

  it('re-tags every content row onto the adopted household', () => {
    const db = makeTestDb();
    // one row per table in the NULL bucket (repo helpers leave householdId
    // unset), one per table already tagged to a foreign household.
    const recipeId = createRecipe(db, sampleRecipe());
    addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    addManualItem(db, 'Melk');

    db.insert(recipes)
      .values({ id: 'foreign-recipe', title: 'Foreign', createdAt: 1000, updatedAt: 1000, householdId: 'old' })
      .run();
    db.insert(mealPlanEntries)
      .values({
        id: 'foreign-entry',
        date: '2026-07-21',
        recipeId,
        servings: 2,
        sortOrder: 0,
        createdAt: 1000,
        updatedAt: 1000,
        householdId: 'old',
      })
      .run();
    db.insert(shoppingItems)
      .values({
        id: 'foreign-item',
        name: 'Egg',
        normalizedName: 'egg',
        createdAt: 1000,
        updatedAt: 1000,
        householdId: 'old',
      })
      .run();

    ensureHousehold(db, 'h2');
    for (const table of [recipes, mealPlanEntries, shoppingItems]) {
      const rows = db.select().from(table).all();
      expect(rows.every((row) => row.householdId === 'h2')).toBe(true);
      expect(rows.every((row) => row.dirty === 1)).toBe(true);
    }
  });
});
