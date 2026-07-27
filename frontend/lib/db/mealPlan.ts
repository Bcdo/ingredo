import { and, eq, sql } from 'drizzle-orm';

import { newId } from './id';
import { inHousehold, notDeleted } from './predicates';
import { mealPlanEntries } from './schema';
import type { DB } from './types';
import { scheduleSync } from '../sync/trigger';

export type PlanEntryInput = { date: string; recipeId: string; servings: number };

function nextSortOrder(db: DB, householdId: string | null, date: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${mealPlanEntries.sortOrder})` })
    .from(mealPlanEntries)
    .where(
      and(
        eq(mealPlanEntries.date, date),
        notDeleted(mealPlanEntries),
        inHousehold(mealPlanEntries, householdId)
      )
    )
    .get();
  return (row?.max ?? -1) + 1;
}

export function addPlanEntry(db: DB, householdId: string | null, input: PlanEntryInput): string {
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
        householdId,
        sortOrder: nextSortOrder(txDb, householdId, input.date),
        createdAt: now,
        updatedAt: now,
        dirty: 1,
      })
      .run();
  });
  scheduleSync();
  return id;
}

export function movePlanEntry(
  db: DB,
  householdId: string | null,
  id: string,
  toDate: string
): void {
  const now = Date.now();
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    txDb
      .update(mealPlanEntries)
      .set({
        date: toDate,
        sortOrder: nextSortOrder(txDb, householdId, toDate),
        updatedAt: now,
        dirty: 1,
      })
      .where(
        and(
          eq(mealPlanEntries.id, id),
          notDeleted(mealPlanEntries),
          inHousehold(mealPlanEntries, householdId)
        )
      )
      .run();
  });
  scheduleSync();
}

export function setPlanEntryServings(
  db: DB,
  householdId: string | null,
  id: string,
  servings: number
): void {
  db.update(mealPlanEntries)
    .set({ servings, updatedAt: Date.now(), dirty: 1 })
    .where(
      and(
        eq(mealPlanEntries.id, id),
        notDeleted(mealPlanEntries),
        inHousehold(mealPlanEntries, householdId)
      )
    )
    .run();
  scheduleSync();
}

// Tombstone, not delete: the row must survive locally so sync can tell the
// server about the deletion (architecture decision 1).
export function removePlanEntry(db: DB, householdId: string | null, id: string): void {
  const now = Date.now();
  db.update(mealPlanEntries)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(and(eq(mealPlanEntries.id, id), inHousehold(mealPlanEntries, householdId)))
    .run();
  scheduleSync();
}
