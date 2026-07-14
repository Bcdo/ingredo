# Dev Sample Data Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `__DEV__`-only "Load sample data" button on the Recipes tab empty state that inserts 8 realistic dinner recipes through the existing repository layer.

**Architecture:** A new `lib/dev/sampleData.ts` module exports the sample `RecipeInput[]` and an idempotent `seedSampleData(db)` that inserts each sample via the existing `createRecipe`, skipping titles that already exist among non-deleted recipes. The Recipes screen's empty-state branch gains a dev-only secondary button wired to the seeder; the existing live queries refresh the list automatically.

**Tech Stack:** Expo SDK 54, expo-router, drizzle-orm + SQLite, Jest (`jest-expo`) with `better-sqlite3` in-memory DBs for repository tests and `@testing-library/react-native` for screen tests.

**Spec:** `docs/superpowers/specs/2026-07-15-dev-sample-data-design.md`

## Global Constraints

- The seed UI renders only when `__DEV__` is true; no production visibility.
- All inserts go through `createRecipe(db, input)` — no raw SQL, no new write path.
- Idempotent by title: a sample is skipped when a `recipes` row with the same `title` and `deleted_at IS NULL` exists.
- Exactly 8 sample recipes; ingredient units are members of `UNITS` from `lib/units.ts` (`g`, `kg`, `ml`, `dl`, `l`, `ts`, `ss`, `stk`) or `null`; at least one ingredient has `scaling: 'fixed'`; servings vary across 2/4/6; one recipe ("Fredagsgryte") is findable in search only via an ingredient name ("Chorizo").
- The button label goes through i18n: `recipes.devSeed` added to BOTH `lib/i18n/en.json` and `lib/i18n/nb.json`.
- Run all commands from `frontend/`. Zero lint warnings, clean `tsc`, all tests green before each commit.

## File Structure

- Create: `lib/dev/sampleData.ts` — sample content + seeder (new `lib/dev/` directory for dev-only tooling).
- Create: `__tests__/sample-data.test.ts` — seeder + data-shape unit tests.
- Create: `__tests__/recipes-screen.test.tsx` — empty-state screen test (screen previously untested).
- Modify: `app/(tabs)/recipes.tsx` — dev button in the empty-state branch.
- Modify: `lib/i18n/en.json`, `lib/i18n/nb.json` — one new key each.

---

### Task 1: Sample data module with idempotent seeder

**Files:**
- Create: `lib/dev/sampleData.ts`
- Test: `__tests__/sample-data.test.ts`

**Interfaces:**
- Consumes: `createRecipe(db: DB, input: RecipeInput): string` and `type RecipeInput` from `lib/db/recipes.ts`; `recipes` table from `lib/db/schema.ts`; `type DB` from `lib/db/types.ts`; `makeTestDb(): DB` from `__tests__/helpers/testDb.ts`.
- Produces: `SAMPLE_RECIPES: RecipeInput[]` (exactly 8 entries) and `seedSampleData(db: DB): number` (returns the count inserted) — Task 2 imports both names from `lib/dev/sampleData`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/dev-sample-data
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sample-data.test.ts`:

```ts
import { isNull } from 'drizzle-orm';

import { createRecipe, getRecipe, softDeleteRecipe } from '../lib/db/recipes';
import { recipes } from '../lib/db/schema';
import type { DB } from '../lib/db/types';
import { SAMPLE_RECIPES, seedSampleData } from '../lib/dev/sampleData';
import { filterRecipes } from '../lib/search';
import { UNITS } from '../lib/units';

import { makeTestDb } from './helpers/testDb';

function liveRecipes(db: DB) {
  return db
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(isNull(recipes.deletedAt))
    .all();
}

describe('seedSampleData', () => {
  it('inserts every sample with full details into an empty database', () => {
    const db = makeTestDb();

    const inserted = seedSampleData(db);

    expect(inserted).toBe(SAMPLE_RECIPES.length);
    const rows = liveRecipes(db);
    expect(rows).toHaveLength(SAMPLE_RECIPES.length);
    for (const row of rows) {
      const details = getRecipe(db, row.id);
      expect(details).not.toBeNull();
      expect(details!.ingredients.length).toBeGreaterThan(0);
      expect(details!.instructions.length).toBeGreaterThan(0);
    }
  });

  it('inserts nothing on a second run', () => {
    const db = makeTestDb();
    seedSampleData(db);

    expect(seedSampleData(db)).toBe(0);
    expect(liveRecipes(db)).toHaveLength(SAMPLE_RECIPES.length);
  });

  it('leaves user recipes alone and restores only deleted samples', () => {
    const db = makeTestDb();
    createRecipe(db, {
      title: 'Bestemors lapskaus',
      description: null,
      servings: 4,
      notes: null,
      ingredients: [{ name: 'Poteter', quantity: 500, unit: 'g' }],
      instructions: [{ text: 'Kok alt sammen.' }],
    });
    seedSampleData(db);

    const firstSample = liveRecipes(db).find((r) => r.title === SAMPLE_RECIPES[0].title)!;
    softDeleteRecipe(db, firstSample.id);

    expect(seedSampleData(db)).toBe(1);
    const titles = liveRecipes(db).map((r) => r.title);
    expect(titles).toContain('Bestemors lapskaus');
    expect(titles.filter((t) => t === SAMPLE_RECIPES[0].title)).toHaveLength(1);
    expect(liveRecipes(db)).toHaveLength(SAMPLE_RECIPES.length + 1);
  });
});

describe('SAMPLE_RECIPES data shape', () => {
  it('has exactly 8 recipes', () => {
    expect(SAMPLE_RECIPES).toHaveLength(8);
  });

  it('uses only canonical units or null', () => {
    const valid: readonly string[] = UNITS;
    for (const recipe of SAMPLE_RECIPES) {
      for (const ing of recipe.ingredients) {
        if (ing.unit !== null) expect(valid).toContain(ing.unit);
      }
    }
  });

  it('exercises fixed scaling and varied servings', () => {
    const hasFixed = SAMPLE_RECIPES.some((r) => r.ingredients.some((i) => i.scaling === 'fixed'));
    expect(hasFixed).toBe(true);
    expect(new Set(SAMPLE_RECIPES.map((r) => r.servings)).size).toBeGreaterThanOrEqual(3);
  });

  it('includes a recipe findable only via an ingredient name', () => {
    const items = SAMPLE_RECIPES.map((r) => ({
      title: r.title,
      ingredientNames: r.ingredients.map((i) => i.name),
    }));
    const hits = filterRecipes(items, 'chorizo');
    expect(hits).toHaveLength(1);
    expect(hits[0].title.toLowerCase()).not.toContain('chorizo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sample-data`
Expected: FAIL — `Cannot find module '../lib/dev/sampleData'`.

- [ ] **Step 3: Implement lib/dev/sampleData.ts**

Create `lib/dev/sampleData.ts`:

```ts
// Dev-only sample content for manual testing. Everything flows through
// createRecipe so seeded rows are indistinguishable from user input.
import { and, eq, isNull } from 'drizzle-orm';

import { createRecipe, type RecipeInput } from '../db/recipes';
import { recipes } from '../db/schema';
import type { DB } from '../db/types';

export const SAMPLE_RECIPES: RecipeInput[] = [
  {
    title: 'Tacos',
    description: 'Fredagsklassikeren med kjøttdeig og tilbehør.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Kjøttdeig', quantity: 400, unit: 'g' },
      { name: 'Tacokrydder', quantity: 2, unit: 'ss' },
      { name: 'Tortillalefser', quantity: 8, unit: 'stk' },
      { name: 'Tomater', quantity: 2, unit: 'stk' },
      { name: 'Mais', quantity: 150, unit: 'g' },
      { name: 'Revet ost', quantity: 100, unit: 'g' },
      { name: 'Rømme', quantity: 2, unit: 'dl' },
    ],
    instructions: [
      { text: 'Brun kjøttdeigen i en stekepanne.' },
      { text: 'Rør inn tacokrydder og litt vann, la småkoke i 5 minutter.' },
      { text: 'Server med lefser og tilbehør.' },
    ],
  },
  {
    title: 'Pasta carbonara',
    description: 'Rask hverdagspasta med bacon og egg.',
    servings: 4,
    notes: 'Bruk pastavannet til å justere konsistensen.',
    ingredients: [
      { name: 'Spaghetti', quantity: 400, unit: 'g' },
      { name: 'Bacon', quantity: 150, unit: 'g' },
      { name: 'Egg', quantity: 3, unit: 'stk' },
      { name: 'Parmesan', quantity: 50, unit: 'g' },
      { name: 'Salt til pastavannet', quantity: 1, unit: 'ss', scaling: 'fixed' },
      { name: 'Nykvernet pepper', quantity: null, unit: null },
    ],
    instructions: [
      { text: 'Kok spaghetti i godt saltet vann.' },
      { text: 'Stek bacon sprøtt, og visp sammen egg og parmesan.' },
      { text: 'Vend alt sammen av varmen så eggene ikke koagulerer.' },
    ],
  },
  {
    title: 'Kjøttkaker med potetmos',
    description: 'Tradisjonsmiddag med brun saus.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Kjøttdeig', quantity: 500, unit: 'g' },
      { name: 'Egg', quantity: 1, unit: 'stk' },
      { name: 'Melk', quantity: 1, unit: 'dl' },
      { name: 'Poteter', quantity: 800, unit: 'g' },
      { name: 'Smør', quantity: 50, unit: 'g' },
      { name: 'Muskat', quantity: 1, unit: 'ts', scaling: 'fixed' },
    ],
    instructions: [
      { text: 'Bland kjøttdeig, egg og melk, form kaker og stek dem.' },
      { text: 'Kok potetene møre og mos dem med smør.' },
      { text: 'Lag brun saus i pannen og la kjøttkakene trekke i den.' },
    ],
  },
  {
    title: 'Ovnsbakt laks med brokkoli',
    description: 'Enkel fiskemiddag på under en halvtime.',
    servings: 2,
    notes: null,
    ingredients: [
      { name: 'Laksefilet', quantity: 300, unit: 'g' },
      { name: 'Brokkoli', quantity: 250, unit: 'g' },
      { name: 'Sitron', quantity: 1, unit: 'stk' },
      { name: 'Olivenolje', quantity: 1, unit: 'ss' },
    ],
    instructions: [
      { text: 'Sett ovnen på 200 grader.' },
      { text: 'Legg laks og brokkoli på et brett, ringle over olje og sitron.' },
      { text: 'Bak i 15–18 minutter.' },
    ],
  },
  {
    title: 'Kikertcurry',
    description: 'Kremet vegetarcurry med kokosmelk.',
    servings: 6,
    notes: 'Smaker enda bedre dagen etter.',
    ingredients: [
      { name: 'Kikerter', quantity: 500, unit: 'g' },
      { name: 'Kokosmelk', quantity: 4, unit: 'dl' },
      { name: 'Løk', quantity: 2, unit: 'stk' },
      { name: 'Rød karripasta', quantity: 2, unit: 'ss' },
      { name: 'Ris', quantity: 4, unit: 'dl' },
      { name: 'Spinat', quantity: 100, unit: 'g' },
    ],
    instructions: [
      { text: 'Fres løk og karripasta i en gryte.' },
      { text: 'Tilsett kikerter og kokosmelk, la småkoke i 10 minutter.' },
      { text: 'Rør inn spinaten og server med ris.' },
    ],
  },
  {
    title: 'Tomatsuppe med makaroni',
    description: 'Barnas favoritt med egg og makaroni.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Hermetiske tomater', quantity: 800, unit: 'g' },
      { name: 'Grønnsaksbuljong', quantity: 1, unit: 'l' },
      { name: 'Makaroni', quantity: 200, unit: 'g' },
      { name: 'Egg', quantity: 4, unit: 'stk' },
      { name: 'Basilikum', quantity: null, unit: null },
    ],
    instructions: [
      { text: 'Kok opp tomater og buljong, la småkoke i 15 minutter.' },
      { text: 'Kok makaroni og hardkokte egg ved siden av.' },
      { text: 'Kjør suppen glatt og server med makaroni og eggebåter.' },
    ],
  },
  {
    title: 'Fredagsgryte',
    description: 'Alt-i-ett-gryte med røkt paprikasmak.',
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Chorizo', quantity: 200, unit: 'g' },
      { name: 'Kyllinglår', quantity: 400, unit: 'g' },
      { name: 'Paprika', quantity: 2, unit: 'stk' },
      { name: 'Hermetiske tomater', quantity: 400, unit: 'g' },
      { name: 'Ris', quantity: 3, unit: 'dl' },
    ],
    instructions: [
      { text: 'Brun chorizo og kylling i en gryte.' },
      { text: 'Tilsett paprika og tomater, la alt putre i 20 minutter.' },
      { text: 'Server over ris.' },
    ],
  },
  {
    title: 'Pannekaker',
    description: 'Tynne pannekaker til middag eller dessert.',
    servings: 6,
    notes: 'La røren svelle i 20 minutter.',
    ingredients: [
      { name: 'Hvetemel', quantity: 300, unit: 'g' },
      { name: 'Melk', quantity: 6, unit: 'dl' },
      { name: 'Egg', quantity: 4, unit: 'stk' },
      { name: 'Salt', quantity: 1, unit: 'ts', scaling: 'fixed' },
      { name: 'Smør til steking', quantity: 25, unit: 'g' },
    ],
    instructions: [
      { text: 'Visp sammen mel, melk, egg og salt til en jevn røre.' },
      { text: 'La røren svelle.' },
      { text: 'Stek tynne pannekaker i smør.' },
    ],
  },
];

export function seedSampleData(db: DB): number {
  let inserted = 0;
  for (const sample of SAMPLE_RECIPES) {
    const existing = db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.title, sample.title), isNull(recipes.deletedAt)))
      .all();
    if (existing.length === 0) {
      createRecipe(db, sample);
      inserted += 1;
    }
  }
  return inserted;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sample-data`
Expected: PASS — 7 tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/dev/sampleData.ts __tests__/sample-data.test.ts
git commit -m "feat: add dev sample data module with idempotent seeder"
```

Expected: zero lint warnings, no type errors.

---

### Task 2: Dev-only seed button on the Recipes empty state

**Files:**
- Modify: `app/(tabs)/recipes.tsx` (empty-state branch, currently lines 88–94)
- Modify: `lib/i18n/en.json`, `lib/i18n/nb.json` (`recipes` section)
- Test: `__tests__/recipes-screen.test.tsx`

**Interfaces:**
- Consumes: `seedSampleData(db: DB): number` from `lib/dev/sampleData` (Task 1); `db` from `lib/db/client`; `Button {label, onPress, variant?}` from `components/ui/Button`; `t(key)` from `lib/i18n`.
- Produces: nothing consumed by later tasks (final task).

- [ ] **Step 1: Write the failing test**

Create `__tests__/recipes-screen.test.tsx` (mocking pattern copied from `__tests__/plan-add.test.tsx`; the screen calls `useLiveQuery` twice per render — first recipes, then ingredients):

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import RecipesScreen from '../app/(tabs)/recipes';
import { seedSampleData } from '../lib/dev/sampleData';

jest.mock('../lib/db/client', () => {
  const node: Record<string, unknown> = {};
  node.select = () => node;
  node.from = () => node;
  node.where = () => node;
  node.orderBy = () => node;
  return { db: node };
});

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('../lib/dev/sampleData', () => ({
  seedSampleData: jest.fn(() => 8),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const seedMock = seedSampleData as jest.Mock;

let recipeRows: unknown[] = [];
let ingredientRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: recipeRows, updatedAt: new Date() };
    return { data: ingredientRows, updatedAt: new Date() };
  });
}

describe('RecipesScreen empty state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recipeRows = [];
    ingredientRows = [];
    mockQueries();
  });

  it('keeps the create-first-recipe action', () => {
    render(<RecipesScreen />);
    expect(screen.getByText('Create your first recipe')).toBeOnTheScreen();
  });

  it('seeds sample data from the dev button and shows the result', () => {
    const view = render(<RecipesScreen />);

    fireEvent.press(screen.getByText('Load sample data'));
    expect(seedMock).toHaveBeenCalledTimes(1);

    recipeRows = [{ id: 'r1', title: 'Tacos', servings: 4 }];
    view.rerender(<RecipesScreen />);
    expect(screen.getByText('Tacos')).toBeOnTheScreen();
    expect(screen.queryByText('Load sample data')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- recipes-screen`
Expected: FAIL — `Unable to find an element with text: Load sample data` (the first test may already pass; that is fine).

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, inside the `"recipes"` object, after `"noResults"`:

```json
    "noResults": "No recipes match your search.",
    "devSeed": "Load sample data"
```

In `lib/i18n/nb.json`, same position:

```json
    "noResults": "Ingen oppskrifter passer søket.",
    "devSeed": "Legg inn eksempeldata"
```

- [ ] **Step 4: Add the dev button to the empty-state branch**

In `app/(tabs)/recipes.tsx`, add two imports:

```tsx
import { Button } from '../../components/ui/Button';
import { seedSampleData } from '../../lib/dev/sampleData';
```

Replace the existing empty-state branch:

```tsx
      ) : (
        <EmptyState
          title={t('recipes.emptyTitle')}
          body={t('recipes.emptyBody')}
          actionLabel={t('recipes.emptyAction')}
          onAction={() => router.push('/recipe/new')}
        />
      )}
```

with:

```tsx
      ) : (
        <View className="flex-1">
          <EmptyState
            title={t('recipes.emptyTitle')}
            body={t('recipes.emptyBody')}
            actionLabel={t('recipes.emptyAction')}
            onAction={() => router.push('/recipe/new')}
          />
          {__DEV__ ? (
            <View className="px-8 pb-8">
              <Button
                label={t('recipes.devSeed')}
                variant="ghost"
                onPress={() => seedSampleData(db)}
              />
            </View>
          ) : null}
        </View>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- recipes-screen`
Expected: PASS — 2 tests. Also run `npm test -- i18n` to confirm the key-parity test stays green.

- [ ] **Step 6: Full suite, lint, typecheck, bundle check, commit**

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
git add 'app/(tabs)/recipes.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/recipes-screen.test.tsx
git commit -m "feat: add dev-only sample data button to recipes empty state"
```

Expected: all suites green, zero lint warnings, no type errors, bundle exports.

---

## Self-Review Notes

- **Spec coverage:** sample content + idempotent seeder via `createRecipe` (T1), data-shape guards for units/fixed-scaling/servings/ingredient-search (T1 tests), dev-only empty-state button + i18n keys in both languages (T2), unit + screen tests (T1/T2). The spec's "tapping it populates the list" is verified at the seam: the screen test asserts the seeder is invoked and that a populated live query renders the list (real DB population is covered by T1's repository tests — the mocked screen test cannot run SQLite).
- **Known judgment calls:** `seedSampleData` loops per-sample rather than wrapping one outer transaction — each `createRecipe` is already transactional and a partial seed is harmless in dev tooling. The duplicate check compares exact titles; a user who hand-typed "Tacos" simply keeps their recipe and loses one sample, which is the designed behavior.
- **Type consistency check:** `seedSampleData(db: DB): number` matches the T2 call site `seedSampleData(db)`; `SAMPLE_RECIPES: RecipeInput[]` matches `RecipeInput` in `lib/db/recipes.ts` (nullable `description`/`notes`/`quantity`/`unit`, optional `scaling`); `Button {label, onPress, variant}` matches `components/ui/Button.tsx`; the test's two-call `useLiveQuery` mock matches the screen's two queries.
