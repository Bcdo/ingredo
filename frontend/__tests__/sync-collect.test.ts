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
