import { eq } from 'drizzle-orm';

import { makeTestDb } from './helpers/testDb';
import { recipes, recipeIngredients, settings } from '../lib/db/schema';

describe('schema', () => {
  it('round-trips a recipe row', () => {
    const db = makeTestDb();
    db.insert(recipes)
      .values({
        id: 'r1',
        title: 'Pancakes',
        description: null,
        servings: 4,
        notes: null,
        createdAt: 1000,
        updatedAt: 1000,
        deletedAt: null,
      })
      .run();

    const rows = db.select().from(recipes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Pancakes');
    expect(rows[0].deletedAt).toBeNull();
  });

  it('cascades ingredient deletes with the recipe', () => {
    const db = makeTestDb();
    db.insert(recipes)
      .values({ id: 'r1', title: 'Soup', servings: 2, createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(recipeIngredients)
      .values({ id: 'i1', recipeId: 'r1', name: 'Onion', quantity: 1, unit: 'stk', sortOrder: 0 })
      .run();

    db.delete(recipes).where(eq(recipes.id, 'r1')).run();

    expect(db.select().from(recipeIngredients).all()).toHaveLength(0);
  });

  it('rejects ingredients pointing at a missing recipe', () => {
    const db = makeTestDb();
    expect(() =>
      db
        .insert(recipeIngredients)
        .values({
          id: 'i1',
          recipeId: 'nope',
          name: 'Ghost',
          quantity: null,
          unit: null,
          sortOrder: 0,
        })
        .run()
    ).toThrow();
  });

  it('defaults ingredient scaling to linear when not provided', () => {
    const db = makeTestDb();
    db.insert(recipes)
      .values({ id: 'r1', title: 'Soup', servings: 4, createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(recipeIngredients)
      .values({ id: 'i1', recipeId: 'r1', name: 'Salt', quantity: null, unit: null, sortOrder: 0 })
      .run();
    const row = db.select().from(recipeIngredients).get();
    expect(row?.scaling).toBe('linear');
  });

  it('has a settings table with key/value', () => {
    const db = makeTestDb();
    db.insert(settings).values({ key: 'unit_system', value: 'us' }).run();
    const row = db.select().from(settings).get();
    expect(row).toEqual({ key: 'unit_system', value: 'us' });
  });
});
