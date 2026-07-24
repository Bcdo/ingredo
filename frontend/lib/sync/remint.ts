import { eq } from 'drizzle-orm';

import { newId } from '../db/id';
import {
  mealPlanEntries,
  recipeIngredients,
  recipeInstructions,
  recipes,
  shoppingItems,
} from '../db/schema';
import type { DB } from '../db/types';

export type ConflictIds = {
  recipes: string[];
  mealPlanEntries: string[];
  shoppingItems: string[];
};

// A push `conflict` means: this id belongs to another household server-side
// (the old household after a leave, or another account's data). The local
// row is THIS device's copy — re-minting its identity (and its children's,
// which are globally unique server-side too) turns the next push into a
// clean insert into the current household. Rows stay dirty; the engine
// queues a follow-up cycle to deliver them.
export function remintConflicted(db: DB, conflicts: ConflictIds): number {
  let reminted = 0;
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;

    for (const oldId of conflicts.recipes) {
      const row = txDb.select().from(recipes).where(eq(recipes.id, oldId)).get();
      if (!row) continue;
      const freshId = newId();
      txDb.insert(recipes).values({ ...row, id: freshId, dirty: 1 }).run();
      const ingredients = txDb
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, oldId))
        .all();
      for (const child of ingredients) {
        txDb.insert(recipeIngredients).values({ ...child, id: newId(), recipeId: freshId }).run();
      }
      const instructions = txDb
        .select()
        .from(recipeInstructions)
        .where(eq(recipeInstructions.recipeId, oldId))
        .all();
      for (const child of instructions) {
        txDb.insert(recipeInstructions).values({ ...child, id: newId(), recipeId: freshId }).run();
      }
      // Plan entries follow their recipe to its new identity and must
      // re-push with the corrected reference.
      txDb
        .update(mealPlanEntries)
        .set({ recipeId: freshId, dirty: 1 })
        .where(eq(mealPlanEntries.recipeId, oldId))
        .run();
      txDb.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, oldId)).run();
      txDb.delete(recipeInstructions).where(eq(recipeInstructions.recipeId, oldId)).run();
      txDb.delete(recipes).where(eq(recipes.id, oldId)).run();
      reminted += 1;
    }

    for (const oldId of conflicts.mealPlanEntries) {
      const row = txDb.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, oldId)).get();
      if (!row) continue;
      txDb.insert(mealPlanEntries).values({ ...row, id: newId(), dirty: 1 }).run();
      txDb.delete(mealPlanEntries).where(eq(mealPlanEntries.id, oldId)).run();
      reminted += 1;
    }

    for (const oldId of conflicts.shoppingItems) {
      const row = txDb.select().from(shoppingItems).where(eq(shoppingItems.id, oldId)).get();
      if (!row) continue;
      txDb.insert(shoppingItems).values({ ...row, id: newId(), dirty: 1 }).run();
      txDb.delete(shoppingItems).where(eq(shoppingItems.id, oldId)).run();
      reminted += 1;
    }
  });
  return reminted;
}
