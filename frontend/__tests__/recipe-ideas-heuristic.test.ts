import { computeRecipeIdeas, getPlanHistory, type PlanHistoryRow } from '../lib/suggestions/recipeIdeas';
import { addPlanEntry, removePlanEntry } from '../lib/db/mealPlan';
import { createRecipe } from '../lib/db/recipes';
import { makeTestDb } from './helpers/testDb';

const TODAY = '2026-07-25';
const TARGET = '2026-07-27';

function history(recipeId: string, dates: string[]): PlanHistoryRow[] {
  return dates.map((date) => ({ recipeId, date }));
}

function universe(...ids: string[]): Set<string> {
  return new Set(ids);
}

describe('computeRecipeIdeas', () => {
  it('surfaces an often-cooked favorite not had this week', () => {
    const rows = history('taco', ['2026-06-05', '2026-06-26', '2026-07-10']);

    const ideas = computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY);

    expect(ideas).toEqual([{ recipeId: 'taco', kind: 'favorite' }]);
  });

  it('suppresses favorites planned within the last 7 days', () => {
    // Last planned 2026-07-19: 6 days before today — too recent.
    const rows = history('taco', ['2026-06-26', '2026-07-19']);

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([]);
  });

  it('a favorite exactly 7 days stale is still too recent (strict >)', () => {
    // 2026-07-18 is exactly 7 days before today; 7 is NOT > 7.
    const rows = history('taco', ['2026-06-18', '2026-07-18']);

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([]);
  });

  it('a single past planning becomes a rediscovery after 21 days', () => {
    const rows = history('suppe', ['2026-06-20']); // 35 days ago

    expect(computeRecipeIdeas(rows, universe('suppe'), TARGET, TODAY)).toEqual([
      { recipeId: 'suppe', kind: 'while' },
    ]);
  });

  it('a single planning fresher than 21 days yields nothing', () => {
    const rows = history('suppe', ['2026-07-10']); // 15 days ago

    expect(computeRecipeIdeas(rows, universe('suppe'), TARGET, TODAY)).toEqual([]);
  });

  it('a rediscovery exactly 21 days stale qualifies (inclusive ≥)', () => {
    // 2026-07-04 is exactly 21 days before today.
    const rows = history('suppe', ['2026-07-04']);

    expect(computeRecipeIdeas(rows, universe('suppe'), TARGET, TODAY)).toEqual([
      { recipeId: 'suppe', kind: 'while' },
    ]);
  });

  it('dedups: a recipe qualifying for both kinds appears once, as a favorite', () => {
    // Planned twice, last time 30 days ago: favorite AND while.
    const rows = history('taco', ['2026-05-25', '2026-06-25']);

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([
      { recipeId: 'taco', kind: 'favorite' },
    ]);
  });

  it('excludes recipes already planned on the target date', () => {
    const rows = [
      ...history('taco', ['2026-06-05', '2026-06-26']),
      { recipeId: 'taco', date: TARGET },
    ];

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([]);
  });

  it('ignores history for recipes outside the universe (deleted recipes)', () => {
    const rows = history('borte', ['2026-06-05', '2026-06-26']);

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([]);
  });

  it('ranks favorites by count then staleness, and favorites before rediscoveries', () => {
    const rows = [
      ...history('a', ['2026-05-01', '2026-05-15', '2026-06-01']), // favorite, 3 plannings
      ...history('b', ['2026-06-10', '2026-07-01']), // favorite, 2 plannings
      ...history('c', ['2026-06-20', '2026-07-05']), // favorite, 2 plannings, fresher than b
      ...history('d', ['2026-06-01']), // while
    ];

    const ideas = computeRecipeIdeas(rows, universe('a', 'b', 'c', 'd'), TARGET, TODAY);

    expect(ideas.map((idea) => idea.recipeId)).toEqual(['a', 'b', 'c', 'd']);
    expect(ideas[3].kind).toBe('while');
  });

  it('a recipe already planned for an upcoming day is never suggested', () => {
    // Real histories always contain future entries (planning ahead is the
    // point). The future lastDate makes staleness negative, failing both
    // thresholds — pin that so a refactor (clamping, abs, reordering)
    // cannot silently start suggesting already-planned dishes.
    const rows = history('taco', ['2026-05-25', '2026-06-25', '2026-07-28']);

    expect(computeRecipeIdeas(rows, universe('taco'), TARGET, TODAY)).toEqual([]);
  });

  it('caps at six', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].flatMap((id, index) =>
      history(id, ['2026-05-01', `2026-06-${String(10 + index).padStart(2, '0')}`])
    );

    const ideas = computeRecipeIdeas(
      rows,
      universe('a', 'b', 'c', 'd', 'e', 'f', 'g'),
      TARGET,
      TODAY
    );

    expect(ideas).toHaveLength(6);
  });
});

describe('getPlanHistory', () => {
  it('returns non-tombstoned entries only', () => {
    const db = makeTestDb();
    const recipeId = createRecipe(db, {
      title: 'Taco',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
      instructions: [{ text: 'Bland.' }],
    });
    addPlanEntry(db, { date: '2026-07-20', recipeId, servings: 2 });
    const removedId = addPlanEntry(db, { date: '2026-07-21', recipeId, servings: 2 });
    removePlanEntry(db, removedId);

    const rows = getPlanHistory(db);

    expect(rows).toEqual([{ recipeId, date: '2026-07-20' }]);
  });
});
