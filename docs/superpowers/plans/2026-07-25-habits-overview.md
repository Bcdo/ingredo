# Habits Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Habits" stats screen opened from Settings: three all-time totals, top-5 most-cooked recipes, top-5 most-bought items — honest numbers from local history.

**Architecture:** Pure aggregator + one-shot readers in `lib/suggestions/habits.ts` (sibling to the two existing heuristics); a modal screen `app/habits.tsx` on the established Settings pattern (root-Stack registration); a navigation row in Settings. Screen tests mock the habits module wholesale (the chain-stub db in screen tests has no `.all()`).

**Tech Stack:** existing frontend stack. No new dependencies, no schema changes, no backend contact.

**Spec:** `docs/superpowers/specs/2026-07-25-habits-overview-design.md`

## Global Constraints

- Aggregation (spec decision 1): `totals` = live-recipe count / non-tombstoned plan-entry count (all-time incl. future) / purchased non-tombstoned shopping-row count; `topRecipes` = top 5 by times-planned joined to LIVE recipe titles (deleted recipes excluded from the list but still counted in `plannedCount`); `topItems` = top 5 by purchase count grouped by `normalizedName`, displayed with the most recent purchase's `name`; ties break alphabetically by display name.
- Screen (decision 2): modal like Settings (Stack registration `presentation: 'modal', headerShown: false`); totals row ALWAYS shown (zeros included); each top-list section renders only when non-empty; one-shot reads on mount.
- Entry (decision 3): "Vaner" / "Habits" row at the bottom of Settings → `router.push('/habits')`.
- i18n `habits.*` in BOTH nb and en (parity test): title, three totals captions, two section titles, `habits.times` = `× %{count}`.
- Existing tests pass untouched EXCEPT the sanctioned settings-test addition (nav-row assertion + `push` added to its router mock, nothing else changed). Mock-prefix rule; RNTL v13.
- Green bar per task: `npx jest`, `npx eslint . --max-warnings 0`, `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`. Baseline: 386 tests.

## File Structure

- Create: `lib/suggestions/habits.ts`, `app/habits.tsx`
- Modify: `app/_layout.tsx` (Stack.Screen), `app/settings.tsx` (row), `lib/i18n/{nb,en}.json`, `__tests__/settings-screen.test.tsx` (sanctioned addition), root `docs/TESTING.md`
- Tests: `__tests__/habits.test.ts`, `__tests__/habits-screen.test.tsx`

---

### Task 1: The habits aggregator and readers

**Files:**
- Create: `lib/suggestions/habits.ts`
- Test: `__tests__/habits.test.ts`

**Interfaces:**
- Produces (used by Task 2): `HabitsData = { recipes: { id: string; title: string }[]; planEntries: { recipeId: string }[]; purchases: { normalizedName: string; name: string; purchasedAt: number }[] }`, `Habits = { totals: { recipeCount: number; plannedCount: number; purchasedCount: number }; topRecipes: { title: string; count: number }[]; topItems: { name: string; count: number }[] }`, `computeHabits(data: HabitsData): Habits`, `getHabitsData(db: DB): HabitsData`.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/habits-overview
cd frontend
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/habits.test.ts`:

```ts
import { addPlanEntry, removePlanEntry } from '../lib/db/mealPlan';
import { createRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { shoppingItems } from '../lib/db/schema';
import { addManualItem, purchaseItem } from '../lib/db/shoppingList';
import { computeHabits, getHabitsData, type HabitsData } from '../lib/suggestions/habits';
import { makeTestDb } from './helpers/testDb';

const emptyData = (over: Partial<HabitsData>): HabitsData => ({
  recipes: [],
  planEntries: [],
  purchases: [],
  ...over,
});

function purchases(name: string, count: number, normalizedName = name.toLowerCase()) {
  return Array.from({ length: count }, (_, index) => ({
    normalizedName,
    name,
    purchasedAt: 1_000_000 + index,
  }));
}

describe('computeHabits', () => {
  it('counts totals honestly, including plannings of deleted recipes', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [{ id: 'taco', title: 'Taco' }],
        planEntries: [{ recipeId: 'taco' }, { recipeId: 'borte' }, { recipeId: 'borte' }],
        purchases: purchases('Melk', 3),
      })
    );

    expect(habits.totals).toEqual({ recipeCount: 1, plannedCount: 3, purchasedCount: 3 });
  });

  it('excludes deleted recipes from topRecipes but not plannedCount', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [{ id: 'taco', title: 'Taco' }],
        planEntries: [{ recipeId: 'taco' }, { recipeId: 'borte' }, { recipeId: 'borte' }],
      })
    );

    expect(habits.topRecipes).toEqual([{ title: 'Taco', count: 1 }]);
    expect(habits.totals.plannedCount).toBe(3);
  });

  it('ranks topRecipes by count with alphabetical tie-break', () => {
    const habits = computeHabits(
      emptyData({
        recipes: [
          { id: 'a', title: 'Suppe' },
          { id: 'b', title: 'Brød' },
          { id: 'c', title: 'Taco' },
        ],
        planEntries: [
          { recipeId: 'c' },
          { recipeId: 'c' },
          { recipeId: 'a' },
          { recipeId: 'b' },
        ],
      })
    );

    expect(habits.topRecipes).toEqual([
      { title: 'Taco', count: 2 },
      { title: 'Brød', count: 1 },
      { title: 'Suppe', count: 1 },
    ]);
  });

  it('caps both lists at five', () => {
    const recipes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: id.toUpperCase() }));
    const habits = computeHabits(
      emptyData({
        recipes,
        planEntries: recipes.map(({ id }) => ({ recipeId: id })),
        purchases: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].flatMap((name) => purchases(name, 1)),
      })
    );

    expect(habits.topRecipes).toHaveLength(5);
    expect(habits.topItems).toHaveLength(5);
  });

  it('groups topItems by normalizedName with the freshest display name', () => {
    const habits = computeHabits(
      emptyData({
        purchases: [
          { normalizedName: 'melk', name: 'melk', purchasedAt: 1 },
          { normalizedName: 'melk', name: 'Melk', purchasedAt: 2 },
          { normalizedName: 'brød', name: 'Brød', purchasedAt: 3 },
        ],
      })
    );

    expect(habits.topItems).toEqual([
      { name: 'Melk', count: 2 },
      { name: 'Brød', count: 1 },
    ]);
  });

  it('handles empty data with honest zeros', () => {
    const habits = computeHabits(emptyData({}));

    expect(habits.totals).toEqual({ recipeCount: 0, plannedCount: 0, purchasedCount: 0 });
    expect(habits.topRecipes).toEqual([]);
    expect(habits.topItems).toEqual([]);
  });
});

describe('getHabitsData', () => {
  it('reads live recipes, non-tombstoned entries, purchased non-tombstoned items', () => {
    const db = makeTestDb();
    const keptId = createRecipe(db, {
      title: 'Taco',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [{ name: 'Mel', quantity: 400, unit: 'g' }],
      instructions: [{ text: 'Bland.' }],
    });
    const goneId = createRecipe(db, {
      title: 'Borte',
      description: null,
      servings: 2,
      notes: null,
      ingredients: [{ name: 'Salt', quantity: null, unit: null }],
      instructions: [{ text: 'Glem.' }],
    });
    addPlanEntry(db, { date: '2026-07-20', recipeId: keptId, servings: 2 });
    const removedEntry = addPlanEntry(db, { date: '2026-07-21', recipeId: keptId, servings: 2 });
    removePlanEntry(db, removedEntry);
    softDeleteRecipe(db, goneId);
    addManualItem(db, 'Melk');
    const item = db.select().from(shoppingItems).all()[0];
    purchaseItem(db, item.id);

    const data = getHabitsData(db);

    expect(data.recipes).toEqual([{ id: keptId, title: 'Taco' }]);
    expect(data.planEntries).toEqual([{ recipeId: keptId }]);
    expect(data.purchases).toEqual([
      expect.objectContaining({ normalizedName: 'melk', name: 'Melk' }),
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/habits.test.ts`
Expected: FAIL — cannot find module `../lib/suggestions/habits`.

- [ ] **Step 3: Implement**

Create `lib/suggestions/habits.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/habits.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 7/7; full suite green (386 + 7 = 393).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add habits aggregation"
```

---

### Task 2: The screen, registration, settings row, i18n, docs

**Files:**
- Create: `app/habits.tsx`
- Modify: `app/_layout.tsx`, `app/settings.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`, `__tests__/settings-screen.test.tsx` (sanctioned addition), root `docs/TESTING.md`
- Test: `__tests__/habits-screen.test.tsx`

**Interfaces:**
- Consumes: Task 1 `computeHabits`, `getHabitsData`, `Habits`.

- [ ] **Step 1: i18n keys**

Add a top-level `"habits"` object to `lib/i18n/en.json`:

```json
  "habits": {
    "title": "Habits",
    "recipesCaption": "Recipes",
    "plannedCaption": "Meals planned",
    "purchasedCaption": "Items purchased",
    "topRecipes": "Most cooked",
    "topItems": "Most bought",
    "times": "× %{count}"
  }
```

and to `lib/i18n/nb.json`:

```json
  "habits": {
    "title": "Vaner",
    "recipesCaption": "Oppskrifter",
    "plannedCaption": "Måltider planlagt",
    "purchasedCaption": "Varer kjøpt",
    "topRecipes": "Mest laget",
    "topItems": "Mest kjøpt",
    "times": "× %{count}"
  }
```

- [ ] **Step 2: Write the failing screen tests**

Create `__tests__/habits-screen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import HabitsScreen from '../app/habits';
import { computeHabits, getHabitsData } from '../lib/suggestions/habits';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/suggestions/habits', () => ({
  getHabitsData: jest.fn(() => ({ recipes: [], planEntries: [], purchases: [] })),
  computeHabits: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const computeHabitsMock = computeHabits as jest.Mock;
const getHabitsDataMock = getHabitsData as jest.Mock;

describe('HabitsScreen', () => {
  it('shows totals and both top lists', () => {
    computeHabitsMock.mockReturnValue({
      totals: { recipeCount: 12, plannedCount: 87, purchasedCount: 240 },
      topRecipes: [{ title: 'Fredagstaco', count: 14 }],
      topItems: [{ name: 'Melk', count: 31 }],
    });

    render(<HabitsScreen />);

    expect(getHabitsDataMock).toHaveBeenCalled();
    expect(screen.getByText('12')).toBeOnTheScreen();
    expect(screen.getByText('87')).toBeOnTheScreen();
    expect(screen.getByText('240')).toBeOnTheScreen();
    expect(screen.getByText('Most cooked')).toBeOnTheScreen();
    expect(screen.getByText('Fredagstaco')).toBeOnTheScreen();
    expect(screen.getByText('× 14')).toBeOnTheScreen();
    expect(screen.getByText('Most bought')).toBeOnTheScreen();
    expect(screen.getByText('Melk')).toBeOnTheScreen();
    expect(screen.getByText('× 31')).toBeOnTheScreen();
  });

  it('hides empty top lists but always shows totals', () => {
    computeHabitsMock.mockReturnValue({
      totals: { recipeCount: 0, plannedCount: 0, purchasedCount: 0 },
      topRecipes: [],
      topItems: [],
    });

    render(<HabitsScreen />);

    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.queryByText('Most cooked')).toBeNull();
    expect(screen.queryByText('Most bought')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/habits-screen.test.tsx`
Expected: FAIL — cannot find module `../app/habits`.

- [ ] **Step 4: Implement the screen + registration + row**

Create `app/habits.tsx`:

```tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '../lib/db/client';
import { t } from '../lib/i18n';
import { computeHabits, getHabitsData } from '../lib/suggestions/habits';
import { usePalette } from '../lib/usePalette';

export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const habits = useMemo(() => computeHabits(getHabitsData(db)), []);

  const totals = [
    { key: 'recipes', value: habits.totals.recipeCount, caption: t('habits.recipesCaption') },
    { key: 'planned', value: habits.totals.plannedCount, caption: t('habits.plannedCaption') },
    { key: 'purchased', value: habits.totals.purchasedCount, caption: t('habits.purchasedCaption') },
  ];

  const lists = [
    {
      key: 'recipes',
      title: t('habits.topRecipes'),
      rows: habits.topRecipes.map((row) => ({ label: row.title, count: row.count })),
    },
    {
      key: 'items',
      title: t('habits.topItems'),
      rows: habits.topItems.map((row) => ({ label: row.name, count: row.count })),
    },
  ];

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="font-display text-xl text-ink">{t('habits.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.close')}
          onPress={() => router.back()}
          className="h-14 w-10 items-center justify-center">
          <Ionicons name="close" size={24} color={palette.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerClassName="gap-6 p-4">
        <View className="flex-row gap-3">
          {totals.map((total) => (
            <View key={total.key} className="flex-1 items-center rounded-card bg-linen py-4">
              <Text className="font-display text-2xl text-clay">{total.value}</Text>
              <Text className="mt-1 text-center font-body text-xs text-ink opacity-70">
                {total.caption}
              </Text>
            </View>
          ))}
        </View>
        {lists.map((list) =>
          list.rows.length > 0 ? (
            <View key={list.key}>
              <Text className="mb-2 font-display text-lg text-ink opacity-70">{list.title}</Text>
              <View className="gap-2">
                {list.rows.map((row) => (
                  <View
                    key={row.label}
                    className="flex-row items-center justify-between rounded-card bg-linen px-4 py-3">
                    <Text className="flex-1 font-body-bold text-base text-ink" numberOfLines={1}>
                      {row.label}
                    </Text>
                    <Text className="font-display text-base text-clay">
                      {t('habits.times', { count: row.count })}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null
        )}
      </ScrollView>
    </View>
  );
}
```

In `app/_layout.tsx`, add next to the settings Stack.Screen:

```tsx
          <Stack.Screen name="habits" options={{ presentation: 'modal', headerShown: false }} />
```

In `app/settings.tsx`, inside the ScrollView after the language section's closing `</View>`, add:

```tsx
      <View className="px-4 pt-6">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/habits')}
          className="min-h-14 flex-row items-center justify-between rounded-card bg-linen px-4 active:opacity-80">
          <Text className="font-body-bold text-base text-ink">{t('habits.title')}</Text>
          <Ionicons name="chevron-forward" size={20} color={palette.ink} />
        </Pressable>
      </View>
```

(`router`, `Pressable`, `Ionicons`, `palette` are already imported/available in settings.tsx.)

- [ ] **Step 5: The sanctioned settings-test addition**

In `__tests__/settings-screen.test.tsx`: extend the expo-router mock to `router: { back: jest.fn(), push: jest.fn() }`, and append one test (adapting to the file's describe structure):

```tsx
it('navigates to the habits screen', () => {
  render(<SettingsScreen />);

  fireEvent.press(screen.getByText('Habits'));

  expect(router.push).toHaveBeenCalledWith('/habits');
});
```

No other changes to the file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/habits-screen.test.tsx __tests__/settings-screen.test.tsx` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: habits screen 2/2; settings tests all green with only the mock extension + one new test. Full suite green (393 + 3 = 396). Export bundles.

- [ ] **Step 7: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Habits overview (manual pass)

- Settings → Habits: three totals up top (recipes, meals planned, items purchased) — sanity-check them against what you'd expect.
- "Most cooked" lists your top recipes with counts; "Most bought" your top items. With thin history the lists are absent but the totals still show (zeros included).
- Delete a recipe → it leaves "Most cooked" but "Meals planned" keeps its history.
- Language switch: everything follows nb/en.
- Numbers match across two synced devices (same household data, same math).
```

- [ ] **Step 8: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: add habits overview screen"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (aggregator + honesty rules + tie-break → T1, one test per rule), 2 (modal screen, totals-always, lists-hide-empty, one-shot reads → T2), 3 (settings row → T2), 4 (i18n keys → T2), 5 (test matrix incl. the sanctioned settings addition → T1/T2).
- **Judgment calls:** `getHabitsData` filters `isNotNull(purchasedAt)` (a purchased row always has it, but the type says nullable — the filter makes the reader's contract honest and the `?? 0` fallback unreachable); `topOf` is a tiny shared helper for the two ranked lists (`localeCompare` for the alphabetical tie-break — locale-sensitive comparison is fine for display ordering); the habits screen test asserts `getAllByText('0')` length 3 to prove zeros render; `settings.close` is reused for the close button's label (same icon, same meaning — no new key).
- **Type consistency check:** `HabitsData`/`Habits` shapes match between T1 definition, T2 mock returns, and screen usage; `t('habits.times', { count })` matches the `%{count}` placeholder; `router.push('/habits')` matches the Stack registration name.
- **Placeholder scan:** clean.
