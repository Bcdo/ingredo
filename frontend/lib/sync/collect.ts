import { and, asc, eq } from 'drizzle-orm';

import { inHousehold } from '../db/predicates';
import { mealPlanEntries, recipeIngredients, recipeInstructions, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';
import type {
  DirtyStamps,
  SyncMealPlanRowDto,
  SyncPushRequestDto,
  SyncRecipeRowDto,
  SyncShoppingRowDto,
} from '../api/types';

export type { DirtyStamps } from '../api/types';

export type DirtyBatch = {
  request: SyncPushRequestDto;
  stamps: DirtyStamps;
  isEmpty: boolean;
};

export function collectDirty(db: DB, householdId: string): DirtyBatch {
  const dirtyRecipes = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.dirty, 1), inHousehold(recipes, householdId)))
    .all();
  const dirtyEntries = db
    .select()
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.dirty, 1), inHousehold(mealPlanEntries, householdId)))
    .all();
  const dirtyItems = db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.dirty, 1), inHousehold(shoppingItems, householdId)))
    .all();

  const recipeRows: SyncRecipeRowDto[] = dirtyRecipes.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    ingredients: db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, row.id))
      .orderBy(asc(recipeIngredients.sortOrder))
      .all()
      .map((ing) => ({
        id: ing.id,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling,
        sortOrder: ing.sortOrder,
      })),
    instructions: db
      .select()
      .from(recipeInstructions)
      .where(eq(recipeInstructions.recipeId, row.id))
      .orderBy(asc(recipeInstructions.sortOrder))
      .all()
      .map((step) => ({ id: step.id, text: step.text, sortOrder: step.sortOrder })),
  }));

  const entryRows: SyncMealPlanRowDto[] = dirtyEntries.map((row) => ({
    id: row.id,
    date: row.date,
    recipeId: row.recipeId,
    servings: row.servings,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }));

  const itemRows: SyncShoppingRowDto[] = dirtyItems.map((row) => ({
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    quantity: row.quantity,
    unit: row.unit,
    sources: row.sources,
    status: row.status,
    purchasedAt: row.purchasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }));

  return {
    request: {
      recipes: recipeRows.length > 0 ? recipeRows : null,
      mealPlanEntries: entryRows.length > 0 ? entryRows : null,
      shoppingItems: itemRows.length > 0 ? itemRows : null,
    },
    stamps: {
      recipes: new Map(dirtyRecipes.map((row) => [row.id, row.updatedAt])),
      mealPlanEntries: new Map(dirtyEntries.map((row) => [row.id, row.updatedAt])),
      shoppingItems: new Map(dirtyItems.map((row) => [row.id, row.updatedAt])),
    },
    isEmpty: recipeRows.length === 0 && entryRows.length === 0 && itemRows.length === 0,
  };
}
