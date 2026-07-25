import { addPlanEntry, removePlanEntry } from '../lib/db/mealPlan';
import { createRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { shoppingItems } from '../lib/db/schema';
import { addManualItem, purchaseItem } from '../lib/db/shoppingList';
import { computeHabits, getHabitsData, type HabitsData } from '../lib/suggestions/habits';
import { makeTestDb } from './helpers/testDb';

const emptyData = (over: Partial<HabitsData>): HabitsData => ({
  recipes: [],
  planEntries: [],
  purchases: [],
  ...over,
});

function purchases(name: string, count: number, normalizedName = name.toLowerCase()) {
  return Array.from({ length: count }, (_, index) => ({
    normalizedName,
    name,
    purchasedAt: 1_000_000 + index,
  }));
}

describe('computeHabits', () => {
  it('counts totals honestly, including plannings of deleted recipes', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [{ id: 'taco', title: 'Taco' }],
        planEntries: [{ recipeId: 'taco' }, { recipeId: 'borte' }, { recipeId: 'borte' }],
        purchases: purchases('Melk', 3),
      })
    );

    expect(habits.totals).toEqual({ recipeCount: 1, plannedCount: 3, purchasedCount: 3 });
  });

  it('excludes deleted recipes from topRecipes but not plannedCount', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [{ id: 'taco', title: 'Taco' }],
        planEntries: [{ recipeId: 'taco' }, { recipeId: 'borte' }, { recipeId: 'borte' }],
      })
    );

    expect(habits.topRecipes).toEqual([{ title: 'Taco', count: 1 }]);
    expect(habits.totals.plannedCount).toBe(3);
  });

  it('ranks topRecipes by count with alphabetical tie-break', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [
          { id: 'a', title: 'Suppe' },
          { id: 'b', title: 'Brød' },
          { id: 'c', title: 'Taco' },
        ],
        planEntries: [
          { recipeId: 'c' },
          { recipeId: 'c' },
          { recipeId: 'a' },
          { recipeId: 'b' },
        ],
      })
    );

    expect(habits.topRecipes).toEqual([
      { title: 'Taco', count: 2 },
      { title: 'Brød', count: 1 },
      { title: 'Suppe', count: 1 },
    ]);
  });

  it('caps both lists at five', () => {
    const recipes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: id.toUpperCase() }));
    const habits = computeHabits(
      emptyData({
        recipes,
        planEntries: recipes.map(({ id }) => ({ recipeId: id })),
        purchases: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].flatMap((name) => purchases(name, 1)),
      })
    );

    expect(habits.topRecipes).toHaveLength(5);
    expect(habits.topItems).toHaveLength(5);
  });

  it('groups topItems by normalizedName with the freshest display name', () => {
    const habits = computeHabits(
      emptyData({
        purchases: [
          { normalizedName: 'melk', name: 'melk', purchasedAt: 1 },
          { normalizedName: 'melk', name: 'Melk', purchasedAt: 2 },
          { normalizedName: 'brød', name: 'Brød', purchasedAt: 3 },
        ],
      })
    );

    expect(habits.topItems).toEqual([
      { name: 'Melk', count: 2 },
      { name: 'Brød', count: 1 },
    ]);
  });

  it('handles empty data with honest zeros', () => {
    const habits = computeHabits(emptyData({}));

    expect(habits.totals).toEqual({ recipeCount: 0, plannedCount: 0, purchasedCount: 0 });
    expect(habits.topRecipes).toEqual([]);
    expect(habits.topItems).toEqual([]);
  });
});

describe('getHabitsData', () => {
  it('reads live recipes, non-tombstoned entries, purchased non-tombstoned items', () => {
    const db = makeTestDb();
    const keptId = createRecipe(db, {
      title: 'Taco',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
      instructions: [{ text: 'Bland.' }],
    });
    const goneId = createRecipe(db, {
      title: 'Borte',
      description: null,
      servings: 2,
      notes: null,
      ingredients: [{ name: 'Salt', quantity: null, unit: null }],
      instructions: [{ text: 'Glem.' }],
    });
    addPlanEntry(db, { date: '2026-07-20', recipeId: keptId, servings: 2 });
    const removedEntry = addPlanEntry(db, { date: '2026-07-21', recipeId: keptId, servings: 2 });
    removePlanEntry(db, removedEntry);
    softDeleteRecipe(db, goneId);
    addManualItem(db, 'Melk');
    const item = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, item.id);

    const data = getHabitsData(db);

    expect(data.recipes).toEqual([{ id: keptId, title: 'Taco' }]);
    expect(data.planEntries).toEqual([{ recipeId: keptId }]);
    expect(data.purchases).toEqual([
      expect.objectContaining({ normalizedName: 'melk', name: 'Melk' }),
    ]);
  });
});
