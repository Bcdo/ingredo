# Recipe Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ideas rail in the add-to-plan flow proposing often-cooked favorites and dishes you haven't had in a while, from your own plan history — one tap selects, exactly like tapping the list.

**Architecture:** Pure heuristic + one-shot history read (`lib/suggestions/recipeIdeas.ts` — no live query, so the existing plan-add test's `useLiveQuery` counting mock keeps working); a props-driven `IdeasRail` component; a mount in `app/plan/add.tsx` gated on empty search. One disclosed mock addition to the existing plan-add test (its chain-stub db lacks `.all()`).

**Tech Stack:** existing frontend stack. No new dependencies, no schema changes, no backend contact.

**Spec:** `docs/superpowers/specs/2026-07-25-recipe-ideas-design.md`

## Global Constraints

- Heuristic (spec decision 2): **favorite** = planned ≥ 2 times AND last planned MORE than 7 days before today, ranked by count desc, ties by staleness desc; **while** = planned ≥ 1 AND last planned ≥ 21 days before today, ranked by staleness desc. Merge favorites-then-while, dedup by recipeId (favorite wins), cap 6.
- Exclusions (decision 3): recipes planned on the TARGET date; recipes outside the caller-supplied universe (the picker's ids). Dates are `yyyy-MM-dd` strings; string comparison is chronological; day-difference math via `Date.parse` on the string (UTC midnight both sides — differences are exact days).
- Surface (decision 4): rail between search box and list, ONLY when `query === ''` AND ideas exist; heading + horizontal chips (title 2-line clamp over reason caption); tap → the screen's existing `select(item)`. No ideas or active search → nothing rendered.
- i18n: `suggestions.ideasTitle` / `suggestions.reasonFavorite` / `suggestions.reasonWhile` in BOTH nb and en (parity test).
- Existing tests pass untouched EXCEPT one disclosed mock addition to `__tests__/plan-add.test.tsx` (mock `../lib/suggestions/recipeIdeas` with empty results — its db chain-stub has no `.all()`). Mock-prefix rule; RNTL v13.
- Green bar per task: `npx jest`, `npx eslint . --max-warnings 0`, `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`. Baseline: 369 tests.

## File Structure

- Create: `lib/suggestions/recipeIdeas.ts`, `components/plan/IdeasRail.tsx`
- Modify: `app/plan/add.tsx`, `lib/i18n/{nb,en}.json`, `__tests__/plan-add.test.tsx` (mock only), root `docs/TESTING.md`
- Tests: `__tests__/recipe-ideas-heuristic.test.ts`, `__tests__/ideas-rail.test.tsx`

---

### Task 1: The ideas heuristic and history reader

**Files:**
- Create: `lib/suggestions/recipeIdeas.ts`
- Test: `__tests__/recipe-ideas-heuristic.test.ts`

**Interfaces:**
- Produces (used by Task 2): `PlanHistoryRow = { recipeId: string; date: string }`, `RecipeIdea = { recipeId: string; kind: 'favorite' | 'while' }`, `computeRecipeIdeas(history: PlanHistoryRow[], recipeIds: Set<string>, targetDate: string, today: string): RecipeIdea[]`, `getPlanHistory(db: DB): PlanHistoryRow[]`.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/recipe-ideas
cd frontend
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/recipe-ideas-heuristic.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/recipe-ideas-heuristic.test.ts`
Expected: FAIL — cannot find module `../lib/suggestions/recipeIdeas`.

- [ ] **Step 3: Implement**

Create `lib/suggestions/recipeIdeas.ts`:

```ts
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
```

Note the dedup: a recipe qualifying as favorite never reaches the `while` branch (the `else if`), so the merge cannot duplicate — matching the spec's "appears once, as a favorite".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/recipe-ideas-heuristic.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 10/10; full suite green (369 + 10 = 379).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add recipe ideas heuristic"
```

---

### Task 2: The rail, mount, i18n, docs

**Files:**
- Create: `components/plan/IdeasRail.tsx`
- Modify: `app/plan/add.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`, `__tests__/plan-add.test.tsx` (one disclosed mock), root `docs/TESTING.md`
- Test: `__tests__/ideas-rail.test.tsx`

**Interfaces:**
- Consumes: Task 1 `computeRecipeIdeas`, `getPlanHistory`, `RecipeIdea`.
- Produces: `IdeasRail({ ideas, items, onSelect })` where `items` are the screen's `PickerItem`s and `onSelect(item)` is the screen's `select`.

- [ ] **Step 1: i18n keys**

Add inside the EXISTING `"suggestions"` object in `lib/i18n/en.json`:

```json
    "ideasTitle": "Ideas",
    "reasonFavorite": "A favorite",
    "reasonWhile": "It's been a while"
```

and in `lib/i18n/nb.json`:

```json
    "ideasTitle": "Forslag",
    "reasonFavorite": "Ofte laget",
    "reasonWhile": "Lenge siden sist"
```

- [ ] **Step 2: Write the failing rail tests**

Create `__tests__/ideas-rail.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { IdeasRail } from '../components/plan/IdeasRail';
import type { RecipeIdea } from '../lib/suggestions/recipeIdeas';

const items = [
  { id: 'taco', title: 'Fredagstaco', servings: 4, ingredientNames: [] },
  { id: 'suppe', title: 'Tomatsuppe', servings: 2, ingredientNames: [] },
];

const ideas: RecipeIdea[] = [
  { recipeId: 'taco', kind: 'favorite' },
  { recipeId: 'suppe', kind: 'while' },
];

describe('IdeasRail', () => {
  it('renders both kinds with their reason captions', () => {
    render(<IdeasRail ideas={ideas} items={items} onSelect={jest.fn()} />);

    expect(screen.getByText('Ideas')).toBeOnTheScreen();
    expect(screen.getByText('Fredagstaco')).toBeOnTheScreen();
    expect(screen.getByText('A favorite')).toBeOnTheScreen();
    expect(screen.getByText('Tomatsuppe')).toBeOnTheScreen();
    expect(screen.getByText("It's been a while")).toBeOnTheScreen();
  });

  it('tapping a chip selects the picker item', () => {
    const onSelect = jest.fn();
    render(<IdeasRail ideas={ideas} items={items} onSelect={onSelect} />);

    fireEvent.press(screen.getByText('Fredagstaco'));

    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('renders nothing with no ideas', () => {
    const { toJSON } = render(<IdeasRail ideas={[]} items={items} onSelect={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it('skips ideas whose recipe is missing from the items', () => {
    const { toJSON } = render(
      <IdeasRail ideas={[{ recipeId: 'ghost', kind: 'favorite' }]} items={items} onSelect={jest.fn()} />
    );
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/ideas-rail.test.tsx`
Expected: FAIL — cannot find module `../components/plan/IdeasRail`.

- [ ] **Step 4: Implement the rail**

Create `components/plan/IdeasRail.tsx`:

```tsx
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '../../lib/i18n';
import type { RecipeIdea } from '../../lib/suggestions/recipeIdeas';

type RailItem = { id: string; title: string };

type IdeasRailProps<T extends RailItem> = {
  ideas: RecipeIdea[];
  items: T[];
  onSelect: (item: T) => void;
};

// Quiet by design: nothing renders when history has nothing to say.
export function IdeasRail<T extends RailItem>({ ideas, items, onSelect }: IdeasRailProps<T>) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const resolved = ideas.flatMap((idea) => {
    const item = byId.get(idea.recipeId);
    return item ? [{ idea, item }] : [];
  });
  if (resolved.length === 0) return null;

  return (
    <View className="pt-3">
      <Text className="px-4 font-body-bold text-sm text-ink opacity-60">
        {t('suggestions.ideasTitle')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pt-2">
        {resolved.map(({ idea, item }) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => onSelect(item)}
            className="max-w-48 rounded-card bg-linen px-4 py-3 active:opacity-80">
            <Text className="font-display text-base text-ink" numberOfLines={2}>
              {item.title}
            </Text>
            <Text className="font-body text-xs text-ink opacity-60">
              {t(idea.kind === 'favorite' ? 'suggestions.reasonFavorite' : 'suggestions.reasonWhile')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 5: Mount in the add screen + the disclosed test mock**

In `app/plan/add.tsx`:

1. Imports: `import { IdeasRail } from '../../components/plan/IdeasRail';`, `import { computeRecipeIdeas, getPlanHistory } from '../../lib/suggestions/recipeIdeas';`, and `import { todayLocal } from '../../lib/dates';`.
2. Below the `filtered` memo, add:

```tsx
  const planHistory = useMemo(() => getPlanHistory(db), []);
  const ideas = useMemo(() => {
    if (typeof date !== 'string') return [];
    return computeRecipeIdeas(
      planHistory,
      new Set(items.map((item) => item.id)),
      date,
      todayLocal()
    );
  }, [planHistory, items, date]);
```

3. In the JSX, directly below the search-box `View` (before the `FlatList`), add:

```tsx
          {query === '' ? (
            <IdeasRail ideas={ideas} items={items} onSelect={select} />
          ) : null}
```

In `__tests__/plan-add.test.tsx`, add ONE mock next to the existing mocks (disclosed — the file's chain-stub db has no `.all()`, and empty ideas keep every existing assertion untouched):

```tsx
jest.mock('../lib/suggestions/recipeIdeas', () => ({
  getPlanHistory: jest.fn(() => []),
  computeRecipeIdeas: jest.fn(() => []),
}));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/ideas-rail.test.tsx __tests__/plan-add.test.tsx` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: rail 4/4; plan-add tests pass with ONLY the mock block added (no assertion changes). Full suite green (379 + 4 = 383). Export bundles.

- [ ] **Step 7: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Recipe ideas (manual pass)

Needs plan history: plan a recipe on 2+ past dates (the plan screen lets you add to any day; or back-date `date` values in a SQLite browser).

- Open plan → add on an empty day: an "Ideas" rail appears between search and the list — often-cooked recipes labeled "A favorite", long-unseen ones "It's been a while".
- Tap a chip → it selects exactly like tapping the list row (servings footer appears); confirm adds it to the day.
- A recipe planned within the last week does NOT appear as a favorite.
- A recipe already planned on the target day never appears.
- Type in the search box → the rail disappears; clear it → the rail returns.
- With no qualifying history (fresh install), the rail is completely absent.
- Language switch: title and captions follow nb/en.
```

- [ ] **Step 8: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: add recipe ideas rail to the plan-add flow"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (one-shot read + pure heuristic → T1; `getPlanHistory` tombstone-filter tested on the real test DB), 2 (both kinds' thresholds/ranking/dedup/cap → T1 tests one-per-rule), 3 (target-date + universe exclusions → T1), 4 (rail placement, empty-query gating, select-passthrough, null-render → T2), 5 (test matrix incl. the single disclosed plan-add mock → T1/T2). i18n parity via the existing test.
- **Judgment calls:** `daysBetween` uses `Date.parse` on `yyyy-MM-dd` (UTC midnight both sides — exact day differences, no DST hazard). The favorite recency check is strict `>` 7 days and the while check `≥` 21, matching the spec's "more than 7" / "≥ 21" wording; test fixtures sit on both sides of each boundary. `IdeasRail` is generic over the item type so the screen's `PickerItem` flows through `onSelect` without casts. The rail resolves titles from the picker items — a deleted recipe can't render even if the heuristic were fed stale history. The mount memoizes history once per screen mount (`[]` deps) per the spec's one-shot decision.
- **Type consistency check:** `RecipeIdea`/`PlanHistoryRow` match between T1 definition and T2 usage; `computeRecipeIdeas(history, recipeIds: Set, targetDate, today)` arity matches the mount; `IdeasRail` props match the test usage; i18n keys match JSON ↔ `t()` calls; `todayLocal()` exists in `lib/dates.ts`.
- **Placeholder scan:** clean — every step carries complete code.
