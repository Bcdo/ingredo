import { isNull } from 'drizzle-orm';

import { createRecipe, getRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { recipes } from '../lib/db/schema';
import type { DB } from '../lib/db/types';
import { SAMPLE_RECIPES, seedSampleData } from '../lib/dev/sampleData';
import { filterRecipes } from '../lib/search';
import { UNITS } from '../lib/units';

import { makeTestDb } from './helpers/testDb';

function liveRecipes(db: DB) {
  return db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(isNull(recipes.deletedAt))
    .all();
}

describe('seedSampleData', () => {
  it('inserts every sample with full details into an empty database', () => {
    const db = makeTestDb();

    const inserted = seedSampleData(db, null);

    expect(inserted).toBe(SAMPLE_RECIPES.length);
    const rows = liveRecipes(db);
    expect(rows).toHaveLength(SAMPLE_RECIPES.length);
    for (const row of rows) {
      const details = getRecipe(db, null, row.id);
      expect(details).not.toBeNull();
      expect(details!.ingredients.length).toBeGreaterThan(0);
      expect(details!.instructions.length).toBeGreaterThan(0);
    }
  });

  it('inserts nothing on a second run', () => {
    const db = makeTestDb();
    seedSampleData(db, null);

    expect(seedSampleData(db, null)).toBe(0);
    expect(liveRecipes(db)).toHaveLength(SAMPLE_RECIPES.length);
  });

  it('leaves user recipes alone and restores only deleted samples', () => {
    const db = makeTestDb();
    createRecipe(db, null, {
      title: 'Bestemors lapskaus',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [{ name: 'Poteter', quantity: 500, unit: 'g' }],
      instructions: [{ text: 'Kok alt sammen.' }],
    });
    seedSampleData(db, null);

    const firstSample = liveRecipes(db).find((r) => r.title === SAMPLE_RECIPES[0].title)!;
    softDeleteRecipe(db, null, firstSample.id);

    expect(seedSampleData(db, null)).toBe(1);
    const titles = liveRecipes(db).map((r) => r.title);
    expect(titles).toContain('Bestemors lapskaus');
    expect(titles.filter((t) => t === SAMPLE_RECIPES[0].title)).toHaveLength(1);
    expect(liveRecipes(db)).toHaveLength(SAMPLE_RECIPES.length + 1);
  });
});

describe('SAMPLE_RECIPES data shape', () => {
  it('has exactly 8 recipes', () => {
    expect(SAMPLE_RECIPES).toHaveLength(8);
  });

  it('uses only canonical units or null', () => {
    const valid: readonly string[] = UNITS;
    for (const recipe of SAMPLE_RECIPES) {
      for (const ing of recipe.ingredients) {
        if (ing.unit !== null) expect(valid).toContain(ing.unit);
      }
    }
  });

  it('exercises fixed scaling and varied servings', () => {
    const hasFixed = SAMPLE_RECIPES.some((r) => r.ingredients.some((i) => i.scaling === 'fixed'));
    expect(hasFixed).toBe(true);
    expect(new Set(SAMPLE_RECIPES.map((r) => r.servings)).size).toBeGreaterThanOrEqual(3);
  });

  it('includes a recipe findable only via an ingredient name', () => {
    const items = SAMPLE_RECIPES.map((r) => ({
      title: r.title,
      ingredientNames: r.ingredients.map((i) => i.name),
    }));
    const hits = filterRecipes(items, 'chorizo');
    expect(hits).toHaveLength(1);
    expect(hits[0].title.toLowerCase()).not.toContain('chorizo');
  });
});
