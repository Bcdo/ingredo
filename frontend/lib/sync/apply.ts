import { eq } from 'drizzle-orm';

import { mealPlanEntries, recipeIngredients, recipeInstructions, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import type {
  SyncMealPlanRowDto,
  SyncPullResponseDto,
  SyncRecipeRowDto,
  SyncShoppingRowDto,
} from '../api/types';

// Apply-writers for pulled rows. These NEVER go through the repository
// functions: repos stamp dirty = 1 (a local change to upload); applying
// server state must land with dirty = 0 or every pull would re-push.
//
// LWW rule per row (lookup by id, tombstones included):
//   absent            -> insert server state
//   local clean       -> apply server state unconditionally (server is truth)
//   local dirty       -> apply iff server updatedAt >= local updatedAt
//                        (a tied push returns superseded, so ties defer to
//                        the server); otherwise local wins the next push.
function shouldApply(local: { dirty: number; updatedAt: number } | undefined, serverUpdatedAt: number): boolean {
  if (!local) return true;
  if (local.dirty === 0) return true;
  return serverUpdatedAt >= local.updatedAt;
}

function applyRecipe(db: DB, row: SyncRecipeRowDto): void {
  const local = db.select().from(recipes).where(eq(recipes.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    title: row.title,
    description: row.description,
    servings: row.servings,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(recipes).set(values).where(eq(recipes.id, row.id)).run();
  } else {
    db.insert(recipes).values({ id: row.id, ...values }).run();
  }

  // Aggregate replace, mirroring the local updateRecipe semantics.
  db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, row.id)).run();
  db.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, row.id)).run();
  for (const ing of row.ingredients) {
    db.insert(recipeIngredients)
      .values({
        id: ing.id,
        recipeId: row.id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling === 'fixed' ? 'fixed' : 'linear',
        sortOrder: ing.sortOrder,
      })
      .run();
  }
  for (const step of row.instructions) {
    db.insert(recipeInstructions)
      .values({ id: step.id, recipeId: row.id, text: step.text, sortOrder: step.sortOrder })
      .run();
  }
}

function applyMealPlanEntry(db: DB, row: SyncMealPlanRowDto): void {
  const local = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    date: row.date,
    recipeId: row.recipeId,
    servings: row.servings,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(mealPlanEntries).set(values).where(eq(mealPlanEntries.id, row.id)).run();
  } else {
    db.insert(mealPlanEntries).values({ id: row.id, ...values }).run();
  }
}

function applyShoppingItem(db: DB, row: SyncShoppingRowDto): void {
  const local = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get();
  if (!shouldApply(local, row.updatedAt)) return;

  const values = {
    name: row.name,
    normalizedName: row.normalizedName,
    quantity: row.quantity,
    unit: row.unit,
    sources: row.sources,
    status: row.status === 'purchased' ? ('purchased' as const) : ('active' as const),
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    dirty: 0,
  };
  if (local) {
    db.update(shoppingItems).set(values).where(eq(shoppingItems.id, row.id)).run();
  } else {
    db.insert(shoppingItems).values({ id: row.id, ...values }).run();
  }
}

export function applyPull(db: DB, pull: SyncPullResponseDto): void {
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    // Recipes first: same-pull meal-plan rows may reference them (FK).
    for (const row of pull.recipes) applyRecipe(txDb, row);
    for (const row of pull.mealPlanEntries) applyMealPlanEntry(txDb, row);
    for (const row of pull.shoppingItems) applyShoppingItem(txDb, row);
  });
}
