import { makeTestDb } from './helpers/testDb';
import {
  createRecipe,
  updateRecipe,
  softDeleteRecipe,
  getRecipe,
  type RecipeInput,
} from '../lib/db/recipes';
import { recipes, recipeIngredients } from '../lib/db/schema';
import { eq, isNull } from 'drizzle-orm';

const input = (overrides: Partial<RecipeInput> = {}): RecipeInput => ({
  title: 'Tomato Soup',
  description: 'Simple and warm',
  servings: 4,
  notes: null,
  ingredients: [
    { name: 'Tomatoes', quantity: 1, unit: 'kg' },
    { name: 'Salt', quantity: null, unit: null },
  ],
  instructions: [{ text: 'Chop tomatoes' }, { text: 'Simmer 20 min' }],
  ...overrides,
});

describe('recipes repository', () => {
  it('creates a recipe with ingredients and instructions in order', () => {
    const db = makeTestDb();
    const id = createRecipe(db, input());

    const details = getRecipe(db, id);
    expect(details).not.toBeNull();
    expect(details!.recipe.title).toBe('Tomato Soup');
    expect(details!.ingredients.map((i) => i.name)).toEqual(['Tomatoes', 'Salt']);
    expect(details!.ingredients.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(details!.instructions.map((s) => s.text)).toEqual(['Chop tomatoes', 'Simmer 20 min']);
  });

  it('updates by replacing child rows and bumping updatedAt', () => {
    const db = makeTestDb();
    const id = createRecipe(db, input());
    const before = getRecipe(db, id)!.recipe;

    updateRecipe(
      db,
      id,
      input({
        title: 'Roasted Tomato Soup',
        ingredients: [{ name: 'Tomatoes', quantity: 2, unit: 'kg' }],
        instructions: [{ text: 'Roast, then simmer' }],
      })
    );

    const after = getRecipe(db, id)!;
    expect(after.recipe.title).toBe('Roasted Tomato Soup');
    expect(after.recipe.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
    expect(after.ingredients).toHaveLength(1);
    expect(after.instructions.map((s) => s.text)).toEqual(['Roast, then simmer']);
    // no orphaned child rows
    expect(db.select().from(recipeIngredients).all()).toHaveLength(1);
  });

  it('soft-deletes: getRecipe returns null, row remains', () => {
    const db = makeTestDb();
    const id = createRecipe(db, input());

    softDeleteRecipe(db, id);

    expect(getRecipe(db, id)).toBeNull();
    const all = db.select().from(recipes).all();
    expect(all).toHaveLength(1);
    expect(all[0].deletedAt).not.toBeNull();
    const live = db.select().from(recipes).where(isNull(recipes.deletedAt)).all();
    expect(live).toHaveLength(0);
  });

  it('rolls back the whole create when a child row fails', () => {
    const db = makeTestDb();
    const bad = input();
    // name is NOT NULL — force a constraint failure on the second ingredient
    (bad.ingredients[1] as { name: string | null }).name = null;

    expect(() => createRecipe(db, bad)).toThrow();
    expect(db.select().from(recipes).all()).toHaveLength(0);
    expect(db.select().from(recipeIngredients).all()).toHaveLength(0);
  });

  it('round-trips the ingredient scaling flag and defaults it to linear', () => {
    const db = makeTestDb();
    const id = createRecipe(db, {
      title: 'Chili',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [
        { name: 'Beans', quantity: 400, unit: 'g' },
        { name: 'Chili flakes', quantity: 1, unit: 'ts', scaling: 'fixed' },
      ],
      instructions: [],
    });
    const details = getRecipe(db, id);
    expect(details?.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);
  });
});

describe('sync prep', () => {
  it('create, update, and soft delete stamp the dirty flag', () => {
    const db = makeTestDb();
    const id = createRecipe(db, input());
    expect(db.select().from(recipes).where(eq(recipes.id, id)).get()!.dirty).toBe(1);

    db.update(recipes).set({ dirty: 0 }).where(eq(recipes.id, id)).run();
    updateRecipe(db, id, input());
    expect(db.select().from(recipes).where(eq(recipes.id, id)).get()!.dirty).toBe(1);

    db.update(recipes).set({ dirty: 0 }).where(eq(recipes.id, id)).run();
    softDeleteRecipe(db, id);
    const row = db.select().from(recipes).where(eq(recipes.id, id)).get()!;
    expect(row.dirty).toBe(1);
    expect(row.deletedAt).not.toBeNull();
  });
});
