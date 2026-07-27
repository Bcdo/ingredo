import { makeTestDb } from './helpers/testDb';
import { createRecipe, getRecipe, softDeleteRecipe, updateRecipe } from '../lib/db/recipes';
import { addPlanEntry } from '../lib/db/mealPlan';
import { addItems } from '../lib/db/shoppingList';
import { inHousehold } from '../lib/db/predicates';
import { shoppingItems } from '../lib/db/schema';
import { getPlanHistory } from '../lib/suggestions/recipeIdeas';
import { getHabitsData } from '../lib/suggestions/habits';

jest.mock('../lib/sync/trigger', () => ({ scheduleSync: jest.fn() }));

const recipeInput = {
  title: 'Tacos',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Melk', quantity: 1, unit: 'l' }],
  instructions: [{ text: 'Mix' }],
};

const item = {
  name: 'Melk',
  normalizedName: 'melk',
  quantity: 1,
  unit: 'l',
  sources: [],
};

describe('partition isolation', () => {
  it('reads never cross partitions — including the NULL bucket', () => {
    const db = makeTestDb();
    const inH1 = createRecipe(db, 'h1', recipeInput);
    const inNull = createRecipe(db, null, recipeInput);

    expect(getRecipe(db, 'h1', inH1)).not.toBeNull();
    expect(getRecipe(db, 'h2', inH1)).toBeNull();
    expect(getRecipe(db, null, inH1)).toBeNull();
    expect(getRecipe(db, null, inNull)).not.toBeNull();
    expect(getRecipe(db, 'h1', inNull)).toBeNull();
  });

  it('by-id mutations no-op across partitions', () => {
    const db = makeTestDb();
    const id = createRecipe(db, 'h1', recipeInput);

    softDeleteRecipe(db, 'h2', id);
    updateRecipe(db, 'h2', id, { ...recipeInput, title: 'Stolen' });

    const details = getRecipe(db, 'h1', id);
    expect(details).not.toBeNull();
    expect(details!.recipe.title).toBe('Tacos');
    expect(details!.ingredients).toHaveLength(1);
  });

  it('plan history and habits stay per-household', () => {
    const db = makeTestDb();
    const r1 = createRecipe(db, 'h1', recipeInput);
    const r2 = createRecipe(db, 'h2', recipeInput);
    addPlanEntry(db, 'h1', { date: '2026-07-27', recipeId: r1, servings: 2 });
    addPlanEntry(db, 'h2', { date: '2026-07-27', recipeId: r2, servings: 2 });

    expect(getPlanHistory(db, 'h1')).toHaveLength(1);
    expect(getPlanHistory(db, null)).toHaveLength(0);
    expect(getHabitsData(db, 'h1').recipes).toHaveLength(1);
  });

  it('shopping merge only sees its own partition', () => {
    const db = makeTestDb();
    addItems(db, 'h1', [item], 'merge');
    addItems(db, 'h2', [item], 'merge');
    addItems(db, 'h1', [item], 'merge'); // merges into h1's row only

    const rowsIn = (householdId: string | null) =>
      db.select().from(shoppingItems).where(inHousehold(shoppingItems, householdId)).all();

    expect(rowsIn('h1')).toHaveLength(1);
    expect(rowsIn('h1')[0].quantity).toBe(2);
    expect(rowsIn('h2')).toHaveLength(1);
    expect(rowsIn('h2')[0].quantity).toBe(1);
    expect(rowsIn(null)).toHaveLength(0);
  });
});
