import { and, eq, isNull, sql } from 'drizzle-orm';

import { newId } from './id';
import { mealPlanEntries } from './schema';
import type { DB } from './types';

export type PlanEntryInput = { date: string; recipeId: string; servings: number };

function nextSortOrder(db: DB, date: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${mealPlanEntries.sortOrder})` })
    .from(mealPlanEntries)
    .where(and(eq(mealPlanEntries.date, date), isNull(mealPlanEntries.deletedAt)))
    .get();
  return (row?.max ?? -1) + 1;
}

export function addPlanEntry(db: DB, input: PlanEntryInput): string {
  const id = newId();
  const now = Date.now();
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    txDb
      .insert(mealPlanEntries)
      .values({
        id,
        date: input.date,
        recipeId: input.recipeId,
        servings: input.servings,
        sortOrder: nextSortOrder(txDb, input.date),
        createdAt: now,
        updatedAt: now,
        dirty: 1,
      })
      .run();
  });
  return id;
}

export function movePlanEntry(db: DB, id: string, toDate: string): void {
  const now = Date.now();
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    txDb
      .update(mealPlanEntries)
      .set({ date: toDate, sortOrder: nextSortOrder(txDb, toDate), updatedAt: now, dirty: 1 })
      .where(eq(mealPlanEntries.id, id))
      .run();
  });
}

export function setPlanEntryServings(db: DB, id: string, servings: number): void {
  db.update(mealPlanEntries)
    .set({ servings, updatedAt: Date.now(), dirty: 1 })
    .where(eq(mealPlanEntries.id, id))
    .run();
}

// Tombstone, not delete: the row must survive locally so sync can tell the
// server about the deletion (architecture decision 1).
export function removePlanEntry(db: DB, id: string): void {
  const now = Date.now();
  db.update(mealPlanEntries)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(mealPlanEntries.id, id))
    .run();
}
