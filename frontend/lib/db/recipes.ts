import { and, asc, eq, isNull } from 'drizzle-orm';

import { newId } from './id';
import {
  recipes,
  recipeIngredients,
  recipeInstructions,
  type RecipeRow,
  type IngredientRow,
  type InstructionRow,
} from './schema';
import type { DB } from './types';

export type IngredientInput = {
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling?: 'linear' | 'fixed';
};
export type InstructionInput = { text: string };

export type RecipeInput = {
  title: string;
  description: string | null;
  servings: number;
  notes: string | null;
  ingredients: IngredientInput[];
  instructions: InstructionInput[];
};

export type RecipeWithDetails = {
  recipe: RecipeRow;
  ingredients: IngredientRow[];
  instructions: InstructionRow[];
};

function insertChildren(tx: DB, recipeId: string, input: RecipeInput) {
  input.ingredients.forEach((ing, index) => {
    tx.insert(recipeIngredients)
      .values({
        id: newId(),
        recipeId,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling ?? 'linear',
        sortOrder: index,
      })
      .run();
  });
  input.instructions.forEach((step, index) => {
    tx.insert(recipeInstructions)
      .values({ id: newId(), recipeId, text: step.text, sortOrder: index })
      .run();
  });
}

export function createRecipe(db: DB, input: RecipeInput): string {
  const id = newId();
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(recipes)
      .values({
        id,
        title: input.title,
        description: input.description,
        servings: input.servings,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        dirty: 1,
      })
      .run();
    insertChildren(tx as unknown as DB, id, input);
  });
  return id;
}

export function updateRecipe(db: DB, id: string, input: RecipeInput): void {
  const now = Date.now();
  db.transaction((tx) => {
    tx.update(recipes)
      .set({
        title: input.title,
        description: input.description,
        servings: input.servings,
        notes: input.notes,
        updatedAt: now,
        dirty: 1,
      })
      .where(eq(recipes.id, id))
      .run();
    tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).run();
    tx.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, id)).run();
    insertChildren(tx as unknown as DB, id, input);
  });
}

export function softDeleteRecipe(db: DB, id: string): void {
  const now = Date.now();
  db.update(recipes)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(recipes.id, id))
    .run();
}

export function getRecipe(db: DB, id: string): RecipeWithDetails | null {
  const recipe = db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
    .get();
  if (!recipe) return null;

  const ingredients = db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(asc(recipeIngredients.sortOrder))
    .all();
  const instructions = db
    .select()
    .from(recipeInstructions)
    .where(eq(recipeInstructions.recipeId, id))
    .orderBy(asc(recipeInstructions.sortOrder))
    .all();

  return { recipe, ingredients, instructions };
}
