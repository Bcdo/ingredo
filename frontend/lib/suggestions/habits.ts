import { and, eq, isNotNull } from 'drizzle-orm';

import { notDeleted } from '../db/predicates';
import { mealPlanEntries, recipes, shoppingItems } from '../db/schema';
import type { DB } from '../db/types';

// The habits screen's numbers: pure aggregation, language-neutral.
// Honesty rules: tombstones never count; a deleted recipe leaves the
// most-cooked list (no title left to show) but its plannings still
// happened and stay in the totals.
const TOP_COUNT = 5;

export type HabitsData = {
  recipes: { id: string; title: string }[];
  planEntries: { recipeId: string }[];
  purchases: { normalizedName: string; name: string; purchasedAt: number }[];
};

export type Habits = {
  totals: { recipeCount: number; plannedCount: number; purchasedCount: number };
  topRecipes: { title: string; count: number }[];
  topItems: { name: string; count: number }[];
};

export function getHabitsData(db: DB): HabitsData {
  return {
    recipes: db
      .select({ id: recipes.id, title: recipes.title })
      .from(recipes)
      .where(notDeleted(recipes))
      .all(),
    planEntries: db
      .select({ recipeId: mealPlanEntries.recipeId })
      .from(mealPlanEntries)
      .where(notDeleted(mealPlanEntries))
      .all(),
    purchases: db
      .select({
        normalizedName: shoppingItems.normalizedName,
        name: shoppingItems.name,
        purchasedAt: shoppingItems.purchasedAt,
      })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.status, 'purchased'),
          notDeleted(shoppingItems),
          isNotNull(shoppingItems.purchasedAt)
        )
      )
      .all()
      .map((row) => ({ ...row, purchasedAt: row.purchasedAt ?? 0 })),
  };
}

function topOf<T>(counts: Map<string, { display: T; count: number }>, byName: (display: T) => string) {
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || byName(a.display).localeCompare(byName(b.display)))
    .slice(0, TOP_COUNT);
}

export function computeHabits(data: HabitsData): Habits {
  const titleById = new Map(data.recipes.map((recipe) => [recipe.id, recipe.title]));

  const recipeCounts = new Map<string, { display: string; count: number }>();
  for (const entry of data.planEntries) {
    const title = titleById.get(entry.recipeId);
    if (title === undefined) continue;
    const current = recipeCounts.get(entry.recipeId);
    if (current) current.count += 1;
    else recipeCounts.set(entry.recipeId, { display: title, count: 1 });
  }

  const itemCounts = new Map<string, { display: { name: string; purchasedAt: number }; count: number }>();
  for (const purchase of data.purchases) {
    const current = itemCounts.get(purchase.normalizedName);
    if (!current) {
      itemCounts.set(purchase.normalizedName, {
        display: { name: purchase.name, purchasedAt: purchase.purchasedAt },
        count: 1,
      });
    } else {
      current.count += 1;
      if (purchase.purchasedAt > current.display.purchasedAt) {
        current.display = { name: purchase.name, purchasedAt: purchase.purchasedAt };
      }
    }
  }

  return {
    totals: {
      recipeCount: data.recipes.length,
      plannedCount: data.planEntries.length,
      purchasedCount: data.purchases.length,
    },
    topRecipes: topOf(recipeCounts, (title) => title).map(({ display, count }) => ({
      title: display,
      count,
    })),
    topItems: topOf(itemCounts, (display) => display.name).map(({ display, count }) => ({
      name: display.name,
      count,
    })),
  };
}
