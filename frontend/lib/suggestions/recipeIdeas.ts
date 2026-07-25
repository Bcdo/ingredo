import { mealPlanEntries } from '../db/schema';
import { notDeleted } from '../db/predicates';
import type { DB } from '../db/types';

// Recipe ideas: what your own plan history recommends. Pure and
// language-neutral — only ids and yyyy-MM-dd date strings.
const DAY_MS = 24 * 60 * 60 * 1000;
const FAVORITE_MIN_PLANNINGS = 2;
const FAVORITE_RECENCY_DAYS = 7; // never suggest what you just had
const WHILE_MIN_STALENESS_DAYS = 21;
const MAX_IDEAS = 6;

export type PlanHistoryRow = { recipeId: string; date: string };

export type RecipeIdea = { recipeId: string; kind: 'favorite' | 'while' };

export function getPlanHistory(db: DB): PlanHistoryRow[] {
  return db
    .select({ recipeId: mealPlanEntries.recipeId, date: mealPlanEntries.date })
    .from(mealPlanEntries)
    .where(notDeleted(mealPlanEntries))
    .all();
}

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / DAY_MS;
}

export function computeRecipeIdeas(
  history: PlanHistoryRow[],
  recipeIds: Set<string>,
  targetDate: string,
  today: string
): RecipeIdea[] {
  const plannedOnTarget = new Set(
    history.filter((row) => row.date === targetDate).map((row) => row.recipeId)
  );

  type Stats = { count: number; lastDate: string };
  const stats = new Map<string, Stats>();
  for (const row of history) {
    if (!recipeIds.has(row.recipeId)) continue;
    if (plannedOnTarget.has(row.recipeId)) continue;
    const current = stats.get(row.recipeId);
    if (!current) {
      stats.set(row.recipeId, { count: 1, lastDate: row.date });
    } else {
      current.count += 1;
      if (row.date > current.lastDate) current.lastDate = row.date;
    }
  }

  const favorites: { recipeId: string; count: number; staleness: number }[] = [];
  const rediscoveries: { recipeId: string; staleness: number }[] = [];
  for (const [recipeId, { count, lastDate }] of stats) {
    const staleness = daysBetween(lastDate, today);
    if (count >= FAVORITE_MIN_PLANNINGS && staleness > FAVORITE_RECENCY_DAYS) {
      favorites.push({ recipeId, count, staleness });
    } else if (staleness >= WHILE_MIN_STALENESS_DAYS) {
      rediscoveries.push({ recipeId, staleness });
    }
  }

  favorites.sort((a, b) => b.count - a.count || b.staleness - a.staleness);
  rediscoveries.sort((a, b) => b.staleness - a.staleness);

  const ideas: RecipeIdea[] = [
    ...favorites.map(({ recipeId }) => ({ recipeId, kind: 'favorite' as const })),
    ...rediscoveries.map(({ recipeId }) => ({ recipeId, kind: 'while' as const })),
  ];
  return ideas.slice(0, MAX_IDEAS);
}
