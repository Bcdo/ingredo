import { eq } from 'drizzle-orm';

import { addPlanEntry } from '../lib/db/mealPlan';
import { createRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipeIngredients, recipes, shoppingItems } from '../lib/db/schema';
import { addManualItem } from '../lib/db/shoppingList';
import { remintConflicted } from '../lib/sync/remint';
import { makeTestDb } from './helpers/testDb';

const sampleRecipe = () => ({
  title: 'Taco',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
  instructions: [{ text: 'Bland.' }],
});

describe('remintConflicted', () => {
  it('re-mints a recipe with fresh child ids and re-points plan entries', () => {
    const db = makeTestDb();
    const oldId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-25', recipeId: oldId, servings: 2 });
    const oldChildIds = db.select().from(recipeIngredients).all().map((c) => c.id);

    const count = remintConflicted(db, { recipes: [oldId], mealPlanEntries: [], shoppingItems: [] });

    expect(count).toBe(1);
    expect(db.select().from(recipes).where(eq(recipes.id, oldId)).get()).toBeUndefined();
    const fresh = db.select().from(recipes).all()[0];
    expect(fresh.id).not.toBe(oldId);
    expect(fresh.title).toBe('Taco');
    expect(fresh.dirty).toBe(1);
    const children = db.select().from(recipeIngredients).all();
    expect(children).toHaveLength(1);
    expect(children[0].recipeId).toBe(fresh.id);
    expect(oldChildIds).not.toContain(children[0].id);
    const entry = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()!;
    expect(entry.recipeId).toBe(fresh.id);
    expect(entry.dirty).toBe(1);
  });

  it('re-mints entries and shopping items by copy+delete', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, sampleRecipe());
    const entryId = addPlanEntry(db, { date: '2026-07-25', recipeId, servings: 2 });
    addManualItem(db, 'Melk');
    const itemId = db.select().from(shoppingItems).all()[0].id;

    const count = remintConflicted(db, {
      recipes: [],
      mealPlanEntries: [entryId],
      shoppingItems: [itemId],
    });

    expect(count).toBe(2);
    expect(db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()).toBeUndefined();
    expect(db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).get()).toBeUndefined();
    expect(db.select().from(mealPlanEntries).all()[0].dirty).toBe(1);
    expect(db.select().from(shoppingItems).all()[0].dirty).toBe(1);
  });

  it('skips ids with no local row', () => {
    const db = makeTestDb();
    expect(
      remintConflicted(db, { recipes: ['ghost'], mealPlanEntries: [], shoppingItems: [] })
    ).toBe(0);
  });
});
