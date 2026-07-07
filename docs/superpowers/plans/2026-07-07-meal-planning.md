# Weekly Meal Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan dinners onto a rolling 7-day week (Plan tab), see tonight/tomorrow on the Today tab, and plan from recipe detail via "Plan it" — all offline in SQLite.

**Architecture:** A new `meal_plan_entries` table stores local `YYYY-MM-DD` date strings (calendar facts, no timezone math) with per-entry servings and per-day sort order; a pure `lib/dates.ts` owns the date-string arithmetic. Writes go through `lib/db/mealPlan.ts`; screens read via `useLiveQuery` inner-joined to live recipes so soft-deleted recipes make their entries vanish. Pickers and the entry sheet are Expo Router modal routes, matching the `recipe/new` pattern.

**Tech Stack:** Expo SDK 54, Expo Router 6, TypeScript, drizzle-orm 0.45 + expo-sqlite (better-sqlite3 in tests), drizzle-kit, NativeWind 4, i18n-js, jest-expo + @testing-library/react-native ^13 (sync render — NO `await render(...)` / v14 idioms).

**Spec:** `docs/superpowers/specs/2026-07-07-meal-planning-design.md` — read it before starting.

## Global Constraints

- **All UI strings go through `t()`** from `lib/i18n`; every new key lands in BOTH `en.json` and `nb.json` (key-symmetry test enforces).
- **Dates are local `YYYY-MM-DD` text**, compared lexicographically. Never store or compare epoch values for plan dates.
- **Plan entries hard-delete** (no `deleted_at` column) — unlike recipes.
- **Every plan read inner-joins `recipes` with `deleted_at IS NULL`** — entries whose recipe was soft-deleted appear nowhere.
- **Servings ≥ 1 by `Stepper` construction**; per-entry servings default to the recipe's servings at planning time.
- Screens never touch SQL for writes — writes via `lib/db/mealPlan.ts`; reads via `useLiveQuery`.
- Design tokens: `bg-cream/linen/clay`, `text-ink/clay/cream`, `rounded-card/rounded-full`, `font-display*`/`font-body*`, touch targets ≥ 56 pt (`min-h-14`). Butter (`bg-butter`) notices for write failures, never red.
- **No new dependencies.** The app must keep working in **Expo Go**.
- All commands run from `frontend/`. Commit after every task. Verification per task: `npm test`, `npm run lint` (zero warnings), `npx tsc --noEmit`; UI tasks also run `npx expo export --platform android` (headless substitute for on-device checks; the manual walk is deferred to the user).

## File Structure

```
frontend/
├── app/
│   ├── _layout.tsx                  # Modify: register three plan modal routes (Task 3)
│   ├── (tabs)/
│   │   ├── index.tsx                # Rewrite: Today tab (Task 7)
│   │   └── plan.tsx                 # Rewrite: week view (Task 3)
│   ├── plan/
│   │   ├── add.tsx                  # Create: recipe picker modal (Task 4)
│   │   ├── pick-day.tsx             # Create: day picker modal, dual mode (Task 6)
│   │   └── entry/[id].tsx           # Create: entry sheet modal (Task 5)
│   └── recipe/[id]/index.tsx        # Modify: sticky "Plan it" button (Task 6)
├── lib/
│   ├── dates.ts                     # Create: date-string math (Task 1)
│   ├── planFormat.ts                # Create: dayHeading() label helper (Task 3)
│   ├── db/
│   │   ├── schema.ts                # Modify: meal_plan_entries table (Task 2)
│   │   └── mealPlan.ts              # Create: write repository (Task 2)
│   └── i18n/{en.json,nb.json}       # Modify: days/plan/today/detail.planIt keys (Tasks 3–7)
├── drizzle/                         # Generated 0002_* migration (Task 2) — committed
└── __tests__/
    ├── dates.test.ts                # Create (Task 1)
    ├── meal-plan-repository.test.ts # Create (Task 2)
    ├── plan-screen.test.tsx         # Create (Task 3)
    ├── plan-add.test.tsx            # Create (Task 4)
    ├── plan-entry.test.tsx          # Create (Task 5)
    ├── plan-pick-day.test.tsx       # Create (Task 6)
    ├── recipe-detail.test.tsx       # Extend: Plan it button (Task 6)
    └── today-screen.test.tsx        # Create (Task 7)
```

Work happens on branch `feature/meal-planning` off `develop` (created in Task 1, Step 0).

---

### Task 1: Date-string utility

**Files:**
- Create: `frontend/lib/dates.ts`
- Test: `frontend/__tests__/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2–7):

```ts
export function todayLocal(now?: Date): string;            // 'YYYY-MM-DD' in local time
export function addDays(date: string, n: number): string;  // handles month/year rollover, negative n
export function rollingWeek(start: string): string[];      // start + next 6 dates
export type DayLabel = {
  key: 'today' | 'tomorrow' | 'weekday';
  weekdayIndex: number;                                     // ISO: 0 = Monday … 6 = Sunday
  dayOfMonth: number;
};
export function dayLabel(date: string, today: string): DayLabel;
```

- [ ] **Step 0: Create the feature branch**

```bash
cd frontend
git checkout develop
git checkout -b feature/meal-planning
```

- [ ] **Step 1: Write the failing tests**

`__tests__/dates.test.ts`:

```ts
import { addDays, dayLabel, rollingWeek, todayLocal } from '../lib/dates';

describe('todayLocal', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 6, 7))).toBe('2026-07-07');
  });

  it('pads single-digit month and day', () => {
    expect(todayLocal(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-07-07', 3)).toBe('2026-07-10');
  });

  it('rolls over month ends', () => {
    expect(addDays('2026-07-29', 4)).toBe('2026-08-02');
  });

  it('rolls over year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles leap-year February', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('supports negative offsets', () => {
    expect(addDays('2026-08-02', -4)).toBe('2026-07-29');
  });
});

describe('rollingWeek', () => {
  it('returns seven consecutive dates starting at start', () => {
    expect(rollingWeek('2026-07-29')).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });
});

describe('dayLabel', () => {
  const today = '2026-07-07'; // a Tuesday

  it('labels today', () => {
    expect(dayLabel('2026-07-07', today)).toEqual({
      key: 'today',
      weekdayIndex: 1,
      dayOfMonth: 7,
    });
  });

  it('labels tomorrow', () => {
    expect(dayLabel('2026-07-08', today)).toEqual({
      key: 'tomorrow',
      weekdayIndex: 2,
      dayOfMonth: 8,
    });
  });

  it('labels other days with ISO weekday index (0 = Monday)', () => {
    expect(dayLabel('2026-07-12', today)).toEqual({
      key: 'weekday',
      weekdayIndex: 6,
      dayOfMonth: 12,
    });
    expect(dayLabel('2026-07-13', today)).toEqual({
      key: 'weekday',
      weekdayIndex: 0,
      dayOfMonth: 13,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dates`
Expected: FAIL with "Cannot find module '../lib/dates'".

- [ ] **Step 3: Implement lib/dates.ts**

```ts
// Plan dates are local calendar facts stored as 'YYYY-MM-DD' strings.
// All arithmetic goes through local Date at noon, which is immune to DST
// transitions shifting the calendar day.

export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return todayLocal(new Date(y, m - 1, d + n, 12));
}

export function rollingWeek(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type DayLabel = {
  key: 'today' | 'tomorrow' | 'weekday';
  weekdayIndex: number; // ISO: 0 = Monday … 6 = Sunday
  dayOfMonth: number;
};

export function dayLabel(date: string, today: string): DayLabel {
  const [y, m, d] = date.split('-').map(Number);
  const weekdayIndex = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  const key = date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : 'weekday';
  return { key, weekdayIndex, dayOfMonth: d };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dates`
Expected: all PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add lib/dates.ts __tests__/dates.test.ts
git commit -m "feat: add local date-string utility for meal planning"
```

---

### Task 2: meal_plan_entries schema, migration, and repository

**Files:**
- Modify: `frontend/lib/db/schema.ts`
- Create: `frontend/lib/db/mealPlan.ts`
- Generated: `frontend/drizzle/0002_*.sql`, `frontend/drizzle/meta/*`, `frontend/drizzle/migrations.js` (via drizzle-kit)
- Test: `frontend/__tests__/meal-plan-repository.test.ts`

**Interfaces:**
- Consumes: `recipes` table, `newId()` from `lib/db/id.ts`, `DB` from `lib/db/types.ts`, `makeTestDb()` (applies the full `./drizzle` folder automatically), `createRecipe`/`softDeleteRecipe` from `lib/db/recipes.ts` (test seeding).
- Produces:

```ts
// lib/db/schema.ts additions
export const mealPlanEntries: /* drizzle table 'meal_plan_entries' */;
export type MealPlanEntryRow = typeof mealPlanEntries.$inferSelect;
// columns: id text PK, date text NOT NULL (indexed), recipeId FK→recipes cascade,
//          servings int NOT NULL, sortOrder int NOT NULL, createdAt/updatedAt int NOT NULL

// lib/db/mealPlan.ts
export type PlanEntryInput = { date: string; recipeId: string; servings: number };
export function addPlanEntry(db: DB, input: PlanEntryInput): string;   // sortOrder = max(date)+1
export function movePlanEntry(db: DB, id: string, toDate: string): void; // appends to target day
export function setPlanEntryServings(db: DB, id: string, servings: number): void;
export function removePlanEntry(db: DB, id: string): void;             // hard delete
```

- [ ] **Step 1: Write the failing tests**

`__tests__/meal-plan-repository.test.ts`:

```ts
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';

import {
  addPlanEntry,
  movePlanEntry,
  removePlanEntry,
  setPlanEntryServings,
} from '../lib/db/mealPlan';
import { createRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { mealPlanEntries, recipes } from '../lib/db/schema';
import type { DB } from '../lib/db/types';

import { makeTestDb } from './helpers/testDb';

function seedRecipe(db: DB, title: string): string {
  return createRecipe(db, {
    title,
    description: null,
    servings: 4,
    notes: null,
    ingredients: [],
    instructions: [],
  });
}

describe('meal plan repository', () => {
  it('adds entries with per-day sort order and returns the id', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');

    const id1 = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });
    const id2 = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 6 });
    addPlanEntry(db, { date: '2026-07-08', recipeId, servings: 2 });

    const rows = db
      .select()
      .from(mealPlanEntries)
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder))
      .all();
    expect(rows.map((r) => [r.id, r.date, r.sortOrder, r.servings])).toEqual([
      [id1, '2026-07-07', 0, 4],
      [id2, '2026-07-07', 1, 6],
      [rows[2].id, '2026-07-08', 0, 2],
    ]);
  });

  it('moves an entry to the end of the target day', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    addPlanEntry(db, { date: '2026-07-08', recipeId, servings: 4 });
    const moving = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    movePlanEntry(db, moving, '2026-07-08');

    const moved = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, moving)).get();
    expect(moved?.date).toBe('2026-07-08');
    expect(moved?.sortOrder).toBe(1);
  });

  it('updates servings', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    setPlanEntryServings(db, id, 7);

    const row = db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, id)).get();
    expect(row?.servings).toBe(7);
  });

  it('hard-deletes an entry', () => {
    const db = makeTestDb();
    const recipeId = seedRecipe(db, 'Soup');
    const id = addPlanEntry(db, { date: '2026-07-07', recipeId, servings: 4 });

    removePlanEntry(db, id);

    expect(db.select().from(mealPlanEntries).all()).toHaveLength(0);
  });

  it('window join excludes entries whose recipe is soft-deleted', () => {
    const db = makeTestDb();
    const keep = seedRecipe(db, 'Keeper');
    const gone = seedRecipe(db, 'Goner');
    addPlanEntry(db, { date: '2026-07-07', recipeId: keep, servings: 4 });
    addPlanEntry(db, { date: '2026-07-07', recipeId: gone, servings: 4 });

    softDeleteRecipe(db, gone);

    // Mirrors the screens' read query.
    const rows = db
      .select({ title: recipes.title })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, '2026-07-07'),
          lte(mealPlanEntries.date, '2026-07-13'),
          isNull(recipes.deletedAt)
        )
      )
      .all();
    expect(rows).toEqual([{ title: 'Keeper' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- meal-plan-repository`
Expected: FAIL — `mealPlanEntries` not exported / module `../lib/db/mealPlan` not found.

- [ ] **Step 3: Extend the schema**

In `lib/db/schema.ts`, add `index` to the drizzle-orm import:

```ts
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
```

and append after `recipeInstructions`:

```ts
export const mealPlanEntries = sqliteTable(
  'meal_plan_entries',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    recipeId: text('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    servings: integer('servings').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('meal_plan_entries_date_idx').on(table.date)]
);

export type MealPlanEntryRow = typeof mealPlanEntries.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: `drizzle/0002_<name>.sql` containing `CREATE TABLE meal_plan_entries ...` and `CREATE INDEX meal_plan_entries_date_idx ...`, plus updated `drizzle/meta/_journal.json`, snapshot, and `drizzle/migrations.js`. Inspect the SQL: additive only.

- [ ] **Step 5: Implement lib/db/mealPlan.ts**

```ts
import { eq, sql } from 'drizzle-orm';

import { newId } from './id';
import { mealPlanEntries } from './schema';
import type { DB } from './types';

export type PlanEntryInput = { date: string; recipeId: string; servings: number };

function nextSortOrder(db: DB, date: string): number {
  const row = db
    .select({ max: sql<number | null>`max(${mealPlanEntries.sortOrder})` })
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.date, date))
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
      .set({ date: toDate, sortOrder: nextSortOrder(txDb, toDate), updatedAt: now })
      .where(eq(mealPlanEntries.id, id))
      .run();
  });
}

export function setPlanEntryServings(db: DB, id: string, servings: number): void {
  db.update(mealPlanEntries)
    .set({ servings, updatedAt: Date.now() })
    .where(eq(mealPlanEntries.id, id))
    .run();
}

export function removePlanEntry(db: DB, id: string): void {
  db.delete(mealPlanEntries).where(eq(mealPlanEntries.id, id)).run();
}
```

(The `tx as unknown as DB` cast matches the established pattern in `lib/db/recipes.ts`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS (existing suites prove the 0001→0002 chain applies cleanly).

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add lib/db/schema.ts lib/db/mealPlan.ts drizzle __tests__/meal-plan-repository.test.ts
git commit -m "feat: add meal plan entries table and repository with migration"
```

---

### Task 3: Plan tab week view + route registration + day labels

**Files:**
- Create: `frontend/lib/planFormat.ts`
- Rewrite: `frontend/app/(tabs)/plan.tsx`
- Modify: `frontend/app/_layout.tsx` (register three modal routes)
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: `frontend/__tests__/plan-screen.test.tsx`

**Interfaces:**
- Consumes: `todayLocal`/`addDays`/`rollingWeek`/`dayLabel` (Task 1), `mealPlanEntries` + `recipes` (Task 2), `Card` primitive, `t`, `db`, `useLiveQuery`.
- Produces:
  - `lib/planFormat.ts`: `export function dayHeading(date: string, today: string): string` — "Today" / "Tomorrow" / localized weekday + day-of-month (e.g. "Sunday 12"); used again by Task 6's day picker.
  - Routes `plan/add`, `plan/pick-day`, `plan/entry/[id]` registered as modals (screens land in Tasks 4–6; until then they 404 — expected).
  - The Plan tab navigates: card tap → `/plan/entry/<id>`, add slot → `/plan/add?date=<date>`.

- [ ] **Step 1: Write the failing test**

`__tests__/plan-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import PlanScreen from '../app/(tabs)/plan';
import { todayLocal } from '../lib/dates';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const push = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;

describe('PlanScreen', () => {
  beforeEach(() => {
    push.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('renders seven day sections with add slots, today first', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    render(<PlanScreen />);

    expect(screen.getAllByText(/\+ Add dinner/)).toHaveLength(7);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('renders planned meals under their day and opens the entry sheet on tap', () => {
    const today = todayLocal();
    mockUseLiveQuery.mockImplementation(() => ({
      data: [{ id: 'e1', date: today, servings: 6, title: 'Tomato Soup' }],
      updatedAt: new Date(),
    }));

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(push).toHaveBeenCalledWith('/plan/entry/e1');
  });

  it('routes the add slot to the picker with the day date', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));
    const today = todayLocal();

    render(<PlanScreen />);

    fireEvent.press(screen.getAllByText(/\+ Add dinner/)[0]);
    expect(push).toHaveBeenCalledWith(`/plan/add?date=${today}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-screen`
Expected: FAIL — the placeholder screen renders no add slots / `plan.addDinner` key missing.

- [ ] **Step 3: Create lib/planFormat.ts**

```ts
import { dayLabel } from './dates';
import { t } from './i18n';

export function dayHeading(date: string, today: string): string {
  const label = dayLabel(date, today);
  if (label.key === 'today') return t('plan.today');
  if (label.key === 'tomorrow') return t('plan.tomorrow');
  return `${t(`days.${label.weekdayIndex}`)} ${label.dayOfMonth}`;
}
```

- [ ] **Step 4: Rewrite app/(tabs)/plan.tsx**

```tsx
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { addDays, rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';

type PlanItem = { id: string; date: string; servings: number; title: string };

export default function PlanScreen() {
  const router = useRouter();
  const today = todayLocal();
  const week = rollingWeek(today);

  const { data: rows } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        date: mealPlanEntries.date,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, addDays(today, 6)),
          isNull(recipes.deletedAt)
        )
      )
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)),
    [today]
  );

  const byDate = new Map<string, PlanItem[]>();
  for (const row of rows ?? []) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return (
    <ScrollView className="flex-1 bg-cream" contentContainerClassName="gap-6 p-4">
      {week.map((date) => (
        <View key={date} className="gap-2">
          {date === today ? (
            <View className="self-start rounded-full bg-clay px-3 py-1">
              <Text className="font-body-bold text-sm text-cream">{dayHeading(date, today)}</Text>
            </View>
          ) : (
            <Text className="font-display text-lg text-ink">{dayHeading(date, today)}</Text>
          )}
          {(byDate.get(date) ?? []).map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              className="active:opacity-80"
              onPress={() => router.push(`/plan/entry/${item.id}`)}>
              <Card>
                <Text className="font-display text-lg text-ink" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="mt-1 font-body text-sm text-ink opacity-70">
                  {t('recipes.servingsCount', { count: item.servings })}
                </Text>
              </Card>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('plan.addDinner')} — ${dayHeading(date, today)}`}
            onPress={() => router.push(`/plan/add?date=${date}`)}
            className="min-h-14 items-center justify-center rounded-card border-2 border-dashed border-linen active:opacity-80">
            <Text className="font-body-bold text-base text-clay">+ {t('plan.addDinner')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 5: Register the modal routes**

In `app/_layout.tsx`, inside the `<Stack>` after the `recipe/[id]/edit` screen, add:

```tsx
        <Stack.Screen name="plan/add" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="plan/pick-day"
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="plan/entry/[id]"
          options={{ presentation: 'modal', headerShown: false }}
        />
```

- [ ] **Step 6: Add the i18n keys**

`en.json` — new top-level `"days"` object and `"plan"` object (replace nothing; the `placeholder.plan` key becomes unused in Task 3 but is removed only when `placeholder.today` goes too, in Task 7):

```json
  "days": {
    "0": "Monday",
    "1": "Tuesday",
    "2": "Wednesday",
    "3": "Thursday",
    "4": "Friday",
    "5": "Saturday",
    "6": "Sunday"
  },
  "plan": {
    "today": "Today",
    "tomorrow": "Tomorrow",
    "addDinner": "Add dinner"
  },
```

`nb.json`:

```json
  "days": {
    "0": "mandag",
    "1": "tirsdag",
    "2": "onsdag",
    "3": "torsdag",
    "4": "fredag",
    "5": "lørdag",
    "6": "søndag"
  },
  "plan": {
    "today": "I dag",
    "tomorrow": "I morgen",
    "addDinner": "Legg til middag"
  },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS (including i18n symmetry).

- [ ] **Step 8: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add 'app/(tabs)/plan.tsx' app/_layout.tsx lib/planFormat.ts lib/i18n/en.json lib/i18n/nb.json __tests__/plan-screen.test.tsx
git commit -m "feat: add weekly plan tab with rolling seven-day view"
```

---

### Task 4: Recipe picker modal (/plan/add)

**Files:**
- Create: `frontend/app/plan/add.tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: `frontend/__tests__/plan-add.test.tsx`

**Interfaces:**
- Consumes: `addPlanEntry` (Task 2), `filterRecipes` from `lib/search.ts`, `Stepper`/`Button`/`Card`/`EmptyState` primitives, `t`, `db`, `useLiveQuery`, route param `?date=YYYY-MM-DD`.
- Produces: the `/plan/add` screen. Selecting a recipe reveals a bottom bar (servings stepper preset to the recipe's servings + Add button); Add persists and closes. Invalid/missing `date` → redirect to the Plan tab.

- [ ] **Step 1: Write the failing test**

`__tests__/plan-add.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';

import AddPlanEntryScreen from '../app/plan/add';
import { addPlanEntry } from '../lib/db/mealPlan';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const back = jest.fn();
let params: Record<string, string | undefined> = { date: '2026-07-07' };
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  router: { back: (...args: unknown[]) => back(...args) },
  Redirect: jest.fn(() => null),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  addPlanEntry: jest.fn(() => 'new-entry'),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;

const soup = { id: 'r1', title: 'Tomato Soup', servings: 4 };
const stew = { id: 'r2', title: 'Beef Stew', servings: 2 };

function mockQueries(recipeRows: unknown[], ingredientRows: unknown[] = []) {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: recipeRows, updatedAt: new Date() };
    return { data: ingredientRows, updatedAt: new Date() };
  });
}

describe('AddPlanEntryScreen', () => {
  beforeEach(() => {
    back.mockClear();
    RedirectMock.mockClear();
    (addPlanEntry as jest.Mock).mockClear();
    mockUseLiveQuery.mockReset();
    params = { date: '2026-07-07' };
  });

  it('redirects when the date param is missing or malformed', () => {
    params = { date: 'not-a-date' };
    mockQueries([soup]);

    render(<AddPlanEntryScreen />);

    expect(RedirectMock).toHaveBeenCalled();
  });

  it('filters recipes by search query', () => {
    mockQueries([soup, stew]);

    render(<AddPlanEntryScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Search recipes or ingredients'), 'stew');

    expect(screen.getByText('Beef Stew')).toBeTruthy();
    expect(screen.queryByText('Tomato Soup')).toBeNull();
  });

  it('selects a recipe, presets servings, and adds the entry', () => {
    mockQueries([soup, stew]);

    render(<AddPlanEntryScreen />);
    fireEvent.press(screen.getByText('Beef Stew'));
    fireEvent.press(screen.getByLabelText('increment')); // 2 → 3
    fireEvent.press(screen.getByText('Add to plan'));

    expect(addPlanEntry).toHaveBeenCalledWith(expect.anything(), {
      date: '2026-07-07',
      recipeId: 'r2',
      servings: 3,
    });
    expect(back).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-add`
Expected: FAIL with "Cannot find module '../app/plan/add'".

- [ ] **Step 3: Implement app/plan/add.tsx**

```tsx
import { desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Stepper } from '../../components/ui/Stepper';
import { db } from '../../lib/db/client';
import { addPlanEntry } from '../../lib/db/mealPlan';
import { recipeIngredients, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { filterRecipes } from '../../lib/search';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type PickerItem = { id: string; title: string; servings: number; ingredientNames: string[] };

export default function AddPlanEntryScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PickerItem | null>(null);
  const [servings, setServings] = useState(1);
  const [saveFailed, setSaveFailed] = useState(false);

  const { data: recipeRows } = useLiveQuery(
    db.select().from(recipes).where(isNull(recipes.deletedAt)).orderBy(desc(recipes.updatedAt))
  );
  const { data: ingredientRows } = useLiveQuery(
    db
      .select({ recipeId: recipeIngredients.recipeId, name: recipeIngredients.name })
      .from(recipeIngredients)
  );

  const items: PickerItem[] = useMemo(() => {
    const namesByRecipe = new Map<string, string[]>();
    for (const row of ingredientRows ?? []) {
      const names = namesByRecipe.get(row.recipeId) ?? [];
      names.push(row.name);
      namesByRecipe.set(row.recipeId, names);
    }
    return (recipeRows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      servings: r.servings,
      ingredientNames: namesByRecipe.get(r.id) ?? [],
    }));
  }, [recipeRows, ingredientRows]);

  const filtered = useMemo(() => filterRecipes(items, query), [items, query]);

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return <Redirect href="/(tabs)/plan" />;
  }

  const select = (item: PickerItem) => {
    setSelected(item);
    setServings(item.servings);
  };

  const add = () => {
    if (!selected) return;
    try {
      addPlanEntry(db, { date, recipeId: selected.id, servings });
      router.back();
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="min-h-14 justify-center pr-4">
          <Text className="font-body-bold text-base text-ink">{t('form.cancel')}</Text>
        </Pressable>
        <Text className="font-display text-xl text-ink">{t('plan.pickRecipeTitle')}</Text>
        <View className="w-14" />
      </View>

      {saveFailed ? (
        <View className="mx-4 mb-2 rounded-card bg-butter px-4 py-3">
          <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={t('recipes.emptyTitle')}
          body={t('recipes.emptyBody')}
          actionLabel={t('recipes.emptyAction')}
          onAction={() => router.push('/recipe/new')}
        />
      ) : (
        <>
          <View className="px-4">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('recipes.searchPlaceholder')}
              placeholderTextColor="#3A322B66"
              className="min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-3 p-4"
            ListEmptyComponent={
              <Text className="pt-8 text-center font-body text-base text-ink opacity-70">
                {t('recipes.noResults')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => select(item)}
                className={`rounded-card p-4 active:opacity-80 ${
                  selected?.id === item.id ? 'bg-clay' : 'bg-linen'
                }`}>
                <Text
                  className={`font-display text-lg ${
                    selected?.id === item.id ? 'text-cream' : 'text-ink'
                  }`}
                  numberOfLines={2}>
                  {item.title}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {selected ? (
        <View
          className="gap-3 border-t border-linen bg-cream px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="flex-row items-center justify-between">
            <Text className="font-body-bold text-sm text-ink">{t('form.servingsLabel')}</Text>
            <Stepper value={servings} onChange={setServings} min={1} />
          </View>
          <Button label={t('plan.add')} onPress={add} />
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 4: Add the i18n keys**

`en.json`, in `"plan"`:

```json
    "pickRecipeTitle": "Pick a recipe",
    "add": "Add to plan"
```

`nb.json`, in `"plan"`:

```json
    "pickRecipeTitle": "Velg oppskrift",
    "add": "Legg i planen"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add app/plan/add.tsx lib/i18n/en.json lib/i18n/nb.json __tests__/plan-add.test.tsx
git commit -m "feat: add recipe picker modal for planning a dinner"
```

---

### Task 5: Entry sheet modal (/plan/entry/[id])

**Files:**
- Create: `frontend/app/plan/entry/[id].tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: `frontend/__tests__/plan-entry.test.tsx`

**Interfaces:**
- Consumes: `setPlanEntryServings`/`removePlanEntry` (Task 2), `mealPlanEntries`+`recipes` join, `Stepper`/`Button` primitives, `t`, `db`, `useLiveQuery`, route param `id`.
- Produces: `/plan/entry/<id>` — servings stepper writing through live; Open recipe → `/recipe/<recipeId>`; Move → `/plan/pick-day?entry=<id>`; Remove → delete + back. Missing/stale id (or soft-deleted recipe) → redirect to Plan tab.

- [ ] **Step 1: Write the failing test**

`__tests__/plan-entry.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import React from 'react';

import PlanEntryScreen from '../app/plan/entry/[id]';
import { removePlanEntry, setPlanEntryServings } from '../lib/db/mealPlan';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
  node.where = () => node;
  return { db: node };
});

const back = jest.fn();
const push = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'e1' }),
  router: { back: (...a: unknown[]) => back(...a), push: (...a: unknown[]) => push(...a) },
  Redirect: jest.fn(() => null),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  setPlanEntryServings: jest.fn(),
  removePlanEntry: jest.fn(),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const RedirectMock = Redirect as unknown as jest.Mock;

const entryRow = { id: 'e1', recipeId: 'r1', servings: 4, title: 'Tomato Soup' };

describe('PlanEntryScreen', () => {
  beforeEach(() => {
    back.mockClear();
    push.mockClear();
    RedirectMock.mockClear();
    (setPlanEntryServings as jest.Mock).mockClear();
    (removePlanEntry as jest.Mock).mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('does not redirect before the query resolves', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: undefined }));
    render(<PlanEntryScreen />);
    expect(RedirectMock).not.toHaveBeenCalled();
  });

  it('redirects when the entry is gone', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));
    render(<PlanEntryScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('steps servings through the repository', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [entryRow], updatedAt: new Date() }));
    render(<PlanEntryScreen />);

    fireEvent.press(screen.getByLabelText('increment'));
    expect(setPlanEntryServings).toHaveBeenCalledWith(expect.anything(), 'e1', 5);
  });

  it('opens the recipe, moves, and removes', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [entryRow], updatedAt: new Date() }));
    render(<PlanEntryScreen />);

    fireEvent.press(screen.getByText('Open recipe'));
    expect(push).toHaveBeenCalledWith('/recipe/r1');

    fireEvent.press(screen.getByText('Move to another day'));
    expect(push).toHaveBeenCalledWith('/plan/pick-day?entry=e1');

    fireEvent.press(screen.getByText('Remove from plan'));
    expect(removePlanEntry).toHaveBeenCalledWith(expect.anything(), 'e1');
    expect(back).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-entry`
Expected: FAIL with "Cannot find module '../app/plan/entry/[id]'".

- [ ] **Step 3: Implement app/plan/entry/[id].tsx**

```tsx
import { and, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../../components/ui/Button';
import { Stepper } from '../../../components/ui/Stepper';
import { db } from '../../../lib/db/client';
import { removePlanEntry, setPlanEntryServings } from '../../../lib/db/mealPlan';
import { mealPlanEntries, recipes } from '../../../lib/db/schema';
import { t } from '../../../lib/i18n';

export default function PlanEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const { data: rows, updatedAt } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        recipeId: mealPlanEntries.recipeId,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(and(eq(mealPlanEntries.id, id), isNull(recipes.deletedAt))),
    [id]
  );

  const entry = rows[0];
  if (updatedAt !== undefined && !entry) {
    return <Redirect href="/(tabs)/plan" />;
  }
  if (!entry) return <View className="flex-1 bg-cream" />;

  return (
    <View
      className="flex-1 gap-6 bg-cream px-5"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
      <Text className="font-display-bold text-2xl text-ink" numberOfLines={3}>
        {entry.title}
      </Text>

      <View className="flex-row items-center justify-between">
        <Text className="font-body-bold text-sm text-ink">{t('form.servingsLabel')}</Text>
        <Stepper
          value={entry.servings}
          onChange={(next) => setPlanEntryServings(db, entry.id, next)}
          min={1}
        />
      </View>

      <View className="gap-3">
        <Button label={t('plan.openRecipe')} onPress={() => router.push(`/recipe/${entry.recipeId}`)} />
        <Button
          label={t('plan.moveDay')}
          variant="ghost"
          onPress={() => router.push(`/plan/pick-day?entry=${entry.id}`)}
        />
        <Button
          label={t('plan.remove')}
          variant="ghost"
          onPress={() => {
            removePlanEntry(db, entry.id);
            router.back();
          }}
        />
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Add the i18n keys**

`en.json`, in `"plan"`:

```json
    "openRecipe": "Open recipe",
    "moveDay": "Move to another day",
    "remove": "Remove from plan"
```

`nb.json`, in `"plan"`:

```json
    "openRecipe": "Åpne oppskrift",
    "moveDay": "Flytt til en annen dag",
    "remove": "Fjern fra planen"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add 'app/plan/entry/[id].tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/plan-entry.test.tsx
git commit -m "feat: add plan entry sheet with servings, move, and remove"
```

---

### Task 6: Day picker modal (/plan/pick-day) + "Plan it" on recipe detail

**Files:**
- Create: `frontend/app/plan/pick-day.tsx`
- Modify: `frontend/app/recipe/[id]/index.tsx` (sticky Plan it bar)
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: `frontend/__tests__/plan-pick-day.test.tsx`, extend `frontend/__tests__/recipe-detail.test.tsx`

**Interfaces:**
- Consumes: `addPlanEntry`/`movePlanEntry` (Task 2), `getRecipe` from `lib/db/recipes.ts`, `mealPlanEntries` table, `dayHeading` (Task 3), `rollingWeek`/`todayLocal` (Task 1), `Button` primitive, `t`, `db`. Route params: `?recipe=<id>` XOR `?entry=<id>`.
- Produces: `/plan/pick-day` — seven day rows; choosing a day adds (recipe mode, servings = recipe default) or moves (entry mode), then closes. Invalid params/ids → redirect to Plan tab. Recipe detail gains a sticky bottom "Plan it" button → `/plan/pick-day?recipe=<id>`.

- [ ] **Step 1: Write the failing tests**

`__tests__/plan-pick-day.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Redirect } from 'expo-router';
import React from 'react';

import PickDayScreen from '../app/plan/pick-day';
import { addDays, todayLocal } from '../lib/dates';
import { addPlanEntry, movePlanEntry } from '../lib/db/mealPlan';
import { getRecipe } from '../lib/db/recipes';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.get = jest.fn(() => ({ id: 'e1' }));
  return { db: node, __node: node };
});

const back = jest.fn();
let params: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => params,
  router: { back: (...a: unknown[]) => back(...a) },
  Redirect: jest.fn(() => null),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../lib/db/mealPlan', () => ({
  addPlanEntry: jest.fn(() => 'new-entry'),
  movePlanEntry: jest.fn(),
}));

jest.mock('../lib/db/recipes', () => ({
  getRecipe: jest.fn(),
}));

const RedirectMock = Redirect as unknown as jest.Mock;

describe('PickDayScreen', () => {
  beforeEach(() => {
    back.mockClear();
    RedirectMock.mockClear();
    (addPlanEntry as jest.Mock).mockClear();
    (movePlanEntry as jest.Mock).mockClear();
    (getRecipe as jest.Mock).mockReset();
    params = {};
  });

  it('redirects when neither param is present', () => {
    render(<PickDayScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('redirects in recipe mode when the recipe is missing', () => {
    (getRecipe as jest.Mock).mockReturnValue(null);
    params = { recipe: 'r-missing' };
    render(<PickDayScreen />);
    expect(RedirectMock).toHaveBeenCalled();
  });

  it('adds an entry with the recipe default servings in recipe mode', () => {
    (getRecipe as jest.Mock).mockReturnValue({
      recipe: { id: 'r1', servings: 4 },
      ingredients: [],
      instructions: [],
    });
    params = { recipe: 'r1' };

    render(<PickDayScreen />);
    fireEvent.press(screen.getByText('Tomorrow'));

    expect(addPlanEntry).toHaveBeenCalledWith(expect.anything(), {
      date: addDays(todayLocal(), 1),
      recipeId: 'r1',
      servings: 4,
    });
    expect(back).toHaveBeenCalled();
  });

  it('moves the entry in entry mode', () => {
    params = { entry: 'e1' };

    render(<PickDayScreen />);
    fireEvent.press(screen.getByText('Today'));

    expect(movePlanEntry).toHaveBeenCalledWith(expect.anything(), 'e1', todayLocal());
    expect(back).toHaveBeenCalled();
  });
});
```

Extend `__tests__/recipe-detail.test.tsx` with one test (inside the existing describe, using the existing `mockQueries`/fixtures):

```tsx
it('routes Plan it to the day picker', () => {
  mockQueries({ data: [recipeRow], updatedAt: new Date() });
  render(<RecipeDetailScreen />);

  fireEvent.press(screen.getByText('Plan it'));
  expect(pushMock).toHaveBeenCalledWith('/plan/pick-day?recipe=r1');
});
```

Note: the existing file mocks `useRouter: () => ({ back: jest.fn(), push: jest.fn() })` with fresh fns per call — hoist a shared `pushMock` so the assertion can see it (`useRouter: () => ({ back: jest.fn(), push: pushMock })`), clearing it in `beforeEach`. Adapt to the file's current structure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- plan-pick-day recipe-detail`
Expected: pick-day FAILS with "Cannot find module"; the new detail test FAILS (no "Plan it" text).

- [ ] **Step 3: Implement app/plan/pick-day.tsx**

```tsx
import { eq } from 'drizzle-orm';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { addPlanEntry, movePlanEntry } from '../../lib/db/mealPlan';
import { getRecipe } from '../../lib/db/recipes';
import { mealPlanEntries } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';

export default function PickDayScreen() {
  const { recipe: recipeId, entry: entryId } = useLocalSearchParams<{
    recipe?: string;
    entry?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [saveFailed, setSaveFailed] = useState(false);

  const today = todayLocal();
  const week = rollingWeek(today);

  // Both loads happen once — the sheet owns no live state.
  const recipeDetails = useMemo(
    () => (typeof recipeId === 'string' ? getRecipe(db, recipeId) : null),
    [recipeId]
  );
  const entryRow = useMemo(
    () =>
      typeof entryId === 'string'
        ? db.select().from(mealPlanEntries).where(eq(mealPlanEntries.id, entryId)).get()
        : undefined,
    [entryId]
  );

  const mode = entryRow ? 'move' : recipeDetails ? 'add' : 'invalid';
  if (mode === 'invalid') {
    return <Redirect href="/(tabs)/plan" />;
  }

  const choose = (date: string) => {
    try {
      if (mode === 'move' && entryRow) {
        movePlanEntry(db, entryRow.id, date);
      } else if (recipeDetails) {
        addPlanEntry(db, {
          date,
          recipeId: recipeDetails.recipe.id,
          servings: recipeDetails.recipe.servings,
        });
      }
      router.back();
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <View
      className="flex-1 gap-3 bg-cream px-5"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
      <Text className="font-display text-xl text-ink">{t('plan.pickDayTitle')}</Text>

      {saveFailed ? (
        <View className="rounded-card bg-butter px-4 py-3">
          <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
        </View>
      ) : null}

      {week.map((date) => (
        <Pressable
          key={date}
          accessibilityRole="button"
          onPress={() => choose(date)}
          className="min-h-14 justify-center rounded-card bg-linen px-4 active:opacity-80">
          <Text className="font-body-bold text-base text-ink">{dayHeading(date, today)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Add the sticky Plan it bar to recipe detail**

In `app/recipe/[id]/index.tsx`:

1. Add the import:

```tsx
import { Button } from '../../../components/ui/Button';
```

2. Directly after the closing `</ScrollView>` tag (before the root `</View>`), add:

```tsx
      <View className="px-5 pt-2" style={{ paddingBottom: insets.bottom + 8 }}>
        <Button
          label={t('detail.planIt')}
          onPress={() => router.push(`/plan/pick-day?recipe=${recipe.id}`)}
        />
      </View>
```

- [ ] **Step 5: Add the i18n keys**

`en.json`: in `"plan"` add `"pickDayTitle": "Pick a day"`; in `"detail"` add `"planIt": "Plan it"`.
`nb.json`: in `"plan"` add `"pickDayTitle": "Velg dag"`; in `"detail"` add `"planIt": "Planlegg"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 7: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add app/plan/pick-day.tsx 'app/recipe/[id]/index.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/plan-pick-day.test.tsx __tests__/recipe-detail.test.tsx
git commit -m "feat: add day picker with Plan it entry point from recipe detail"
```

---

### Task 7: Today tab

**Files:**
- Rewrite: `frontend/app/(tabs)/index.tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json` (add `today.*`; REMOVE the now-unused `placeholder.today` and `placeholder.plan` keys from BOTH files — `placeholder.shop` stays, the Shop tab still uses it)
- Test: `frontend/__tests__/today-screen.test.tsx`

**Interfaces:**
- Consumes: `todayLocal`/`addDays` (Task 1), `mealPlanEntries`+`recipes` join (Task 2), `Card`/`Button` primitives, `t`, `db`, `useLiveQuery`.
- Produces: the Today tab — Tonight hero (today's first entry), extra tonight entries as compact rows, Tomorrow peek (shown only when tomorrow has entries), empty state with "Plan your week" → Plan tab.

- [ ] **Step 1: Write the failing test**

`__tests__/today-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import TodayScreen from '../app/(tabs)/index';
import { addDays, todayLocal } from '../lib/dates';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.innerJoin = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

const push = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const today = todayLocal();
const tomorrow = addDays(today, 1);

describe('TodayScreen', () => {
  beforeEach(() => {
    push.mockClear();
    mockUseLiveQuery.mockReset();
  });

  it('shows the tonight hero, extra entries, and the tomorrow peek', () => {
    mockUseLiveQuery.mockImplementation(() => ({
      data: [
        { id: 'e1', date: today, recipeId: 'r1', servings: 4, title: 'Tomato Soup' },
        { id: 'e2', date: today, recipeId: 'r2', servings: 2, title: 'Salad' },
        { id: 'e3', date: tomorrow, recipeId: 'r3', servings: 4, title: 'Beef Stew' },
      ],
      updatedAt: new Date(),
    }));

    render(<TodayScreen />);

    expect(screen.getByText('Tonight')).toBeTruthy();
    expect(screen.getByText('Tomato Soup')).toBeTruthy();
    expect(screen.getByText('Salad')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    expect(screen.getByText('Beef Stew')).toBeTruthy();

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(push).toHaveBeenCalledWith('/recipe/r1');
  });

  it('shows the empty state with a plan-week action when nothing is planned tonight', () => {
    mockUseLiveQuery.mockImplementation(() => ({ data: [], updatedAt: new Date() }));

    render(<TodayScreen />);

    expect(screen.getByText('Nothing planned tonight.')).toBeTruthy();
    fireEvent.press(screen.getByText('Plan your week'));
    expect(push).toHaveBeenCalledWith('/(tabs)/plan');
    expect(screen.queryByText('Tomorrow')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- today-screen`
Expected: FAIL — the placeholder renders none of the expected texts.

- [ ] **Step 3: Rewrite app/(tabs)/index.tsx**

```tsx
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { addDays, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';

type TodayItem = { id: string; date: string; recipeId: string; servings: number; title: string };

export default function TodayScreen() {
  const router = useRouter();
  const today = todayLocal();
  const tomorrow = addDays(today, 1);

  const { data: rows } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        date: mealPlanEntries.date,
        recipeId: mealPlanEntries.recipeId,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, tomorrow),
          isNull(recipes.deletedAt)
        )
      )
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)),
    [today]
  );

  const items = (rows ?? []) as TodayItem[];
  const tonights = items.filter((row) => row.date === today);
  const tomorrows = items.filter((row) => row.date === tomorrow);
  const hero = tonights[0];

  return (
    <ScrollView className="flex-1 bg-cream" contentContainerClassName="gap-6 p-4">
      <View className="gap-3">
        <Text className="font-display text-xl text-ink">{t('today.tonight')}</Text>
        {hero ? (
          <>
            <Pressable
              accessibilityRole="button"
              className="active:opacity-80"
              onPress={() => router.push(`/recipe/${hero.recipeId}`)}>
              <Card className="min-h-28 justify-between">
                <Text className="font-display-bold text-2xl text-ink" numberOfLines={3}>
                  {hero.title}
                </Text>
                <Text className="mt-2 font-body text-sm text-ink opacity-70">
                  {t('recipes.servingsCount', { count: hero.servings })}
                </Text>
              </Card>
            </Pressable>
            {tonights.slice(1).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                className="active:opacity-80"
                onPress={() => router.push(`/recipe/${item.recipeId}`)}>
                <Card>
                  <Text className="font-display text-base text-ink" numberOfLines={2}>
                    {item.title}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </>
        ) : (
          <Card className="gap-4">
            <Text className="font-body text-base text-ink opacity-70">
              {t('today.nothingTonight')}
            </Text>
            <Button label={t('today.planWeek')} onPress={() => router.push('/(tabs)/plan')} />
          </Card>
        )}
      </View>

      {tomorrows.length > 0 ? (
        <View className="gap-3">
          <Text className="font-display text-xl text-ink">{t('today.tomorrow')}</Text>
          {tomorrows.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              className="active:opacity-80"
              onPress={() => router.push(`/recipe/${item.recipeId}`)}>
              <Card>
                <Text className="font-display text-base text-ink" numberOfLines={2}>
                  {item.title}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
```

- [ ] **Step 4: Update the i18n files**

`en.json` — add a top-level `"today"` object and delete `placeholder.today` + `placeholder.plan` (keep `placeholder.shop`):

```json
  "today": {
    "tonight": "Tonight",
    "tomorrow": "Tomorrow",
    "nothingTonight": "Nothing planned tonight.",
    "planWeek": "Plan your week"
  },
```

`nb.json` — same deletions, plus:

```json
  "today": {
    "tonight": "I kveld",
    "tomorrow": "I morgen",
    "nothingTonight": "Ingenting planlagt i kveld.",
    "planWeek": "Planlegg uken"
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS (key-symmetry holds after the paired deletions).

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add 'app/(tabs)/index.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/today-screen.test.tsx
git commit -m "feat: add Today tab with tonight hero and tomorrow peek"
```

---

### Task 8: Final verification and manual checklist

**Files:**
- Modify: root `docs/TESTING.md` (append the manual checklist)

**Interfaces:**
- Consumes: everything.
- Produces: a verified slice and the deferred manual checklist recorded where the tester will look.

- [ ] **Step 1: Full automated pass**

Run from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: all green, zero lint warnings, bundle exports. Fix anything that isn't before proceeding.

- [ ] **Step 2: Append the manual checklist to docs/TESTING.md**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Weekly meal planning (manual pass)

- Plan tab shows today (clay token) plus the next six days; every day ends with a dashed "+ Add dinner" slot.
- Plan a dinner in 2 taps: add slot → pick recipe → Add. It appears under the right day and on Today (if planned for today).
- Tap a meal card → entry sheet: change servings (persists), Move to another day, Remove.
- Recipe detail → "Plan it" → pick a day → entry lands in the plan with the recipe's servings.
- Today tab: tonight hero opens the recipe; tomorrow peek lists tomorrow's dinners; empty state's "Plan your week" jumps to the Plan tab.
- Soft-delete a planned recipe → its plan entries disappear everywhere.
- Norwegian device language: day names, all plan/today labels localized.
- Kill and relaunch — the plan persists.
```

- [ ] **Step 3: Commit**

```bash
git add ../docs/TESTING.md
git commit -m "docs: add meal planning manual test checklist"
```

---

## Self-Review Notes

- **Spec coverage:** date utility + rolling window (T1), table/migration/index + repository incl. per-day sort order and hard delete (T2), Plan tab with dashed slots + clay today token + route registration (T3), recipe picker with search/servings/empty-collection state + invalid-date redirect (T4), entry sheet with live stepper/open/move/remove + missing-id redirect (T5), dual-mode day picker + Plan it sticky button (T6), Today tab hero/extras/tomorrow/empty (T7), verification + TESTING.md checklist (T8). All spec i18n keys land except `plan.title`, deliberately dropped — the tab header already uses `tabs.plan`, and a dead key would just re-earn the `detail.notFound` review flag.
- **Known judgment calls:** entry-sheet Remove has no confirmation (spec-mandated: one entry, instantly re-plannable); the entry sheet writes servings through on every stepper tap (live query echoes it back — value stays consistent); `placeholder.today`/`placeholder.plan` keys are deleted in Task 7 when their last consumers disappear; the pick-day screen loads recipe/entry once via `useMemo` (spec: the sheet owns no live state).
- **Type consistency check:** `PlanEntryInput { date, recipeId, servings }` (T2) matches every call site (T4 `addPlanEntry(db, { date, recipeId: selected.id, servings })`, T6 recipe mode); `dayHeading(date, today)` (T3) reused in T6; screen queries select the same column aliases their `PlanItem`/`TodayItem` types declare; `Stepper {value, onChange, min}` and `Button {label, onPress, variant?}` match the existing primitives.
