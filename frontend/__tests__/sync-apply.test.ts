import { eq } from 'drizzle-orm';

import { createRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipeIngredients, recipes, shoppingItems } from '../lib/db/schema';
import { applyPull } from '../lib/sync/apply';
import type { SyncPullResponseDto, SyncRecipeRowDto } from '../lib/api/types';
import { makeTestDb } from './helpers/testDb';

const emptyPull = (over: Partial<SyncPullResponseDto>): SyncPullResponseDto => ({
  recipes: [],
  mealPlanEntries: [],
  shoppingItems: [],
  cursor: 0,
  ...over,
});

const serverRecipe = (over: Partial<SyncRecipeRowDto>): SyncRecipeRowDto => ({
  id: 'server-recipe-1',
  title: 'Fra serveren',
  description: null,
  servings: 4,
  notes: null,
  createdAt: 1000,
  updatedAt: 2000,
  deletedAt: null,
  ingredients: [
    { id: 'ing-1', name: 'Mel', quantity: 400, unit: 'g', scaling: 'linear', sortOrder: 0 },
  ],
  instructions: [{ id: 'ins-1', text: 'Bland.', sortOrder: 0 }],
  ...over,
});

const sampleRecipe = () => ({
  title: 'Lokal',
  description: null,
  servings: 4,
  notes: null,
  ingredients: [{ name: 'Sukker', quantity: 100, unit: 'g' }],
  instructions: [{ text: 'Rør.' }],
});

const pullWithOneRowPerTable = (): SyncPullResponseDto =>
  emptyPull({
    recipes: [serverRecipe({})],
    mealPlanEntries: [
      {
        id: 'entry-1',
        date: '2026-07-25',
        recipeId: 'server-recipe-1',
        servings: 2,
        sortOrder: 0,
        createdAt: 1000,
        updatedAt: 2000,
        deletedAt: null,
      },
    ],
    shoppingItems: [
      {
        id: 'item-1',
        name: 'Melk',
        normalizedName: 'melk',
        quantity: 1000,
        unit: 'ml',
        sources: '[]',
        status: 'active',
        purchasedAt: null,
        createdAt: 1000,
        updatedAt: 2000,
        deletedAt: null,
      },
    ],
  });

describe('applyPull', () => {
  it('inserts absent rows with dirty 0, aggregates included', () => {
    const db = makeTestDb();

    applyPull(db, emptyPull({ recipes: [serverRecipe({})] }), 'h1');

    const row = db.select().from(recipes).where(eq(recipes.id, 'server-recipe-1')).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.dirty).toBe(0);
    expect(row.updatedAt).toBe(2000);
    const children = db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, 'server-recipe-1'))
      .all();
    expect(children.map((c) => c.id)).toEqual(['ing-1']);
  });

  it('applies server state unconditionally over clean local rows, even older', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0, updatedAt: 9999 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 500 })] }), 'h1');

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.updatedAt).toBe(500);
    expect(row.dirty).toBe(0);
  });

  it('keeps a dirty local row that is newer than the server row', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ updatedAt: 3000 }).run(); // dirty stays 1 from create

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 2000 })] }), 'h1');

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Lokal');
    expect(row.dirty).toBe(1);
    const children = db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, localId))
      .all();
    expect(children.map((c) => c.name)).toEqual(['Sukker']);
  });

  it('replaces a dirty local row on server tie or newer, clearing dirty', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ updatedAt: 2000 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 2000 })] }), 'h1');

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.title).toBe('Fra serveren');
    expect(row.dirty).toBe(0);
    const children = db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, localId))
      .all();
    expect(children.map((c) => c.name)).toEqual(['Mel']);
  });

  it('applies tombstones and hides nothing physically', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    db.update(recipes).set({ dirty: 0 }).run();

    applyPull(
      db,
      emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: 5000, deletedAt: 5000 })] }),
      'h1'
    );

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.deletedAt).toBe(5000);
    expect(row.dirty).toBe(0);
  });

  it('inserts tombstones for rows never seen locally', () => {
    const db = makeTestDb();

    applyPull(
      db,
      emptyPull({
        recipes: [serverRecipe({ id: 'ghost', updatedAt: 5000, deletedAt: 5000, ingredients: [], instructions: [] })],
      }),
      'h1'
    );

    const row = db.select().from(recipes).where(eq(recipes.id, 'ghost')).get()!;
    expect(row.deletedAt).toBe(5000);
  });

  it('resurrects a local tombstone from a newer live server row', () => {
    const db = makeTestDb();
    const localId = createRecipe(db, sampleRecipe());
    const now = db.select().from(recipes).get()!.updatedAt;
    db.update(recipes).set({ deletedAt: now, dirty: 0 }).run();

    applyPull(db, emptyPull({ recipes: [serverRecipe({ id: localId, updatedAt: now + 1000 })] }), 'h1');

    const row = db.select().from(recipes).where(eq(recipes.id, localId)).get()!;
    expect(row.deletedAt).toBeNull();
    expect(row.title).toBe('Fra serveren');
  });

  it('merges meal-plan rows (needs the recipe present) and shopping rows', () => {
    const db = makeTestDb();

    applyPull(
      db,
      emptyPull({
        recipes: [serverRecipe({})],
        mealPlanEntries: [
          {
            id: 'entry-1',
            date: '2026-07-25',
            recipeId: 'server-recipe-1',
            servings: 2,
            sortOrder: 0,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
        shoppingItems: [
          {
            id: 'item-1',
            name: 'Melk',
            normalizedName: 'melk',
            quantity: 1000,
            unit: 'ml',
            sources: '[]',
            status: 'active',
            purchasedAt: null,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
      }),
      'h1'
    );

    expect(db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, 'entry-1')).get()!.dirty).toBe(0);
    const item = db.select().from(shoppingItems).where(eq(shoppingItems.id, 'item-1')).get()!;
    expect(item.status).toBe('active');
    expect(item.dirty).toBe(0);
  });

  it('dirty shopping edits older than server are replaced', () => {
    const db = makeTestDb();
    db.insert(shoppingItems)
      .values({
        id: 'item-1',
        name: 'Melk',
        normalizedName: 'melk',
        quantity: 500,
        unit: 'ml',
        sources: '[]',
        status: 'active',
        purchasedAt: null,
        createdAt: 1000,
        updatedAt: 1500,
        dirty: 1,
      })
      .run();

    applyPull(
      db,
      emptyPull({
        shoppingItems: [
          {
            id: 'item-1',
            name: 'Melk',
            normalizedName: 'melk',
            quantity: 1000,
            unit: 'ml',
            sources: '[]',
            status: 'purchased',
            purchasedAt: 2000,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: null,
          },
        ],
      }),
      'h1'
    );

    const item = db.select().from(shoppingItems).where(eq(shoppingItems.id, 'item-1')).get()!;
    expect(item.status).toBe('purchased');
    expect(item.quantity).toBe(1000);
    expect(item.dirty).toBe(0);
  });

  it('applies recipes before meal-plan entries so same-pull references resolve', () => {
    const db = makeTestDb();
    // Entry referencing a recipe arriving in the SAME pull — FK requires
    // insertion order recipes → entries.
    expect(() =>
      applyPull(
        db,
        emptyPull({
          recipes: [serverRecipe({})],
          mealPlanEntries: [
            {
              id: 'entry-1',
              date: '2026-07-25',
              recipeId: 'server-recipe-1',
              servings: 2,
              sortOrder: 0,
              createdAt: 1000,
              updatedAt: 2000,
              deletedAt: null,
            },
          ],
        }),
        'h1'
      )
    ).not.toThrow();
  });

  it('stamps pulled rows with the pulled household', () => {
    const db = makeTestDb();
    applyPull(db, pullWithOneRowPerTable(), 'h1');
    expect(db.select().from(recipes).get()?.householdId).toBe('h1');
    expect(db.select().from(mealPlanEntries).get()?.householdId).toBe('h1');
    expect(db.select().from(shoppingItems).get()?.householdId).toBe('h1');
  });
});
