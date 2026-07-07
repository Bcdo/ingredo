# Recipe Scaling & Unit Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display-time recipe scaling (servings stepper), US ⇄ Metric unit conversion with a persisted preference, and a per-ingredient "fixed / to taste" scaling flag, on the recipe detail screen.

**Architecture:** A pure, dimension-based measure engine (`lib/measure.ts` + registry data in `lib/units.ts`) transforms authored quantities at render time — the stored recipe is never modified. One additive drizzle migration adds a `scaling` column to `recipe_ingredients` and a generic `settings` key–value table. The detail screen gets a servings stepper (ephemeral) and a Metric/US segmented toggle (persisted via `lib/db/settings.ts`); the recipe form gets a per-ingredient scaling chip toggle.

**Tech Stack:** Expo SDK 54, TypeScript, drizzle-orm 0.45 + expo-sqlite (better-sqlite3 in tests), drizzle-kit, NativeWind 4, i18n-js, jest-expo + @testing-library/react-native ^13 (sync render — NO `await render(...)` / v14 idioms).

**Spec:** `docs/superpowers/specs/2026-07-07-recipe-scaling-units-design.md` — read it before starting.

## Global Constraints

- **All UI strings go through `t()`** from `lib/i18n`; every new key lands in BOTH `en.json` and `nb.json` (a key-symmetry test enforces this).
- **Display-time transforms only.** No task writes scaled or converted values to the database.
- **Canonical stored unit codes are unchanged:** `g, kg, ml, dl, l, ts, ss, stk` or free text. US codes `oz`, `lb`, `cup` are display-only and never stored. Converted teaspoon/tablespoon amounts reuse codes `ts`/`ss` (their labels already read "tsp"/"tbsp" in English).
- **Metric mode never changes the authored unit** — quantities only scale. Unit selection happens only when converting to US.
- **US amounts render as fractions** (whole + ⅛, ¼, ⅓, ⅜, ½, ⅝, ⅔, ¾, ⅞; a non-zero amount never snaps to 0 — floor ⅛). **Metric stays decimal**, ≤2 decimals, comma separator for `nb`.
- **Volume ↔ weight is never crossed.** `stk`, free-text units, and null quantities pass through (number scales; unit/absence unchanged).
- Design tone: colors/radii from the Tailwind theme tokens (`bg-cream/linen/clay`, `text-ink/clay/cream`, `rounded-card/rounded-full`), touch targets ≥ 56 pt (`min-h-14`), Fraunces (`font-display*`) / Karla (`font-body*`). No red error states.
- **No new dependencies.**
- The app must keep working in **Expo Go**.
- All commands run from `frontend/`. Commit after every task. Verification per task: `npm test`, `npm run lint` (zero warnings), `npx tsc --noEmit`; UI tasks also run `npx expo export --platform android` as the headless substitute for on-device checks (manual walk deferred to the user).

## File Structure

```
frontend/
├── app/recipe/[id]/index.tsx        # Modify: control row, displayQuantity wiring, hint (Task 6)
├── components/
│   ├── RecipeForm.tsx               # Modify: per-ingredient scaling chips (Task 5)
│   └── ui/SegmentedControl.tsx      # Create (Task 4)
├── lib/
│   ├── db/
│   │   ├── schema.ts                # Modify: scaling column + settings table (Task 1)
│   │   ├── recipes.ts               # Modify: scaling passthrough (Task 1)
│   │   └── settings.ts              # Create: getUnitSystem/setUnitSystem (Task 2)
│   ├── i18n/{index.ts,en.json,nb.json}  # Modify: currentLocale() (Task 3); keys (Tasks 3–6)
│   ├── units.ts                     # Modify: measure registry + types (Task 3)
│   ├── quantity.ts                  # Modify: locale-aware formatQuantity (Task 3)
│   ├── form.ts                      # Modify: IngredientDraft.scaling + locale (Task 5)
│   └── measure.ts                   # Create: displayQuantity + formatFraction (Task 3)
├── drizzle/                         # Generated 0001_* migration (Task 1) — committed
└── __tests__/
    ├── schema.test.ts               # Extend (Task 1)
    ├── recipes-repository.test.ts   # Extend (Task 1)
    ├── settings-repository.test.ts  # Create (Task 2)
    ├── quantity.test.ts             # Extend (Task 3)
    ├── measure.test.ts              # Create (Task 3)
    ├── ui.test.tsx                  # Extend (Task 4)
    ├── form.test.ts                 # Extend (Task 5)
    ├── recipe-form.test.tsx         # Extend (Task 5)
    └── recipe-detail.test.tsx       # Extend/rework mocks (Task 6)
```

Work happens on branch `feature/recipe-scaling-units` off `develop` (created in Task 1, Step 0).

---

### Task 1: Schema migration + repository scaling passthrough

**Files:**
- Modify: `frontend/lib/db/schema.ts`
- Modify: `frontend/lib/db/recipes.ts` (IngredientInput, insertChildren)
- Generated: `frontend/drizzle/0001_*.sql`, `frontend/drizzle/meta/*`, `frontend/drizzle/migrations.js` (via drizzle-kit)
- Test: `frontend/__tests__/schema.test.ts`, `frontend/__tests__/recipes-repository.test.ts`

**Interfaces:**
- Consumes: existing schema tables, `makeTestDb()` from `__tests__/helpers/testDb.ts` (runs the full `./drizzle` folder — picks up the new migration automatically), `createRecipe`/`getRecipe` from `lib/db/recipes.ts`.
- Produces:
  - `recipeIngredients.scaling` column — TS type `'linear' | 'fixed'`, NOT NULL, default `'linear'`; `IngredientRow` gains `scaling: 'linear' | 'fixed'`.
  - `settings` table: `key` text PK, `value` text NOT NULL (repository comes in Task 2).
  - `IngredientInput` gains optional `scaling?: 'linear' | 'fixed'` (defaults to `'linear'` on insert).

- [ ] **Step 0: Create the feature branch**

```bash
cd frontend
git checkout develop
git checkout -b feature/recipe-scaling-units
```

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/schema.test.ts` (inside the existing top-level `describe`, reusing its `db = makeTestDb()` pattern — match the file's existing style):

```ts
it('defaults ingredient scaling to linear when not provided', () => {
  const db = makeTestDb();
  db.insert(recipes)
    .values({ id: 'r1', title: 'Soup', servings: 4, createdAt: 1, updatedAt: 1 })
    .run();
  db.insert(recipeIngredients)
    .values({ id: 'i1', recipeId: 'r1', name: 'Salt', quantity: null, unit: null, sortOrder: 0 })
    .run();
  const row = db.select().from(recipeIngredients).get();
  expect(row?.scaling).toBe('linear');
});

it('has a settings table with key/value', () => {
  const db = makeTestDb();
  db.insert(settings).values({ key: 'unit_system', value: 'us' }).run();
  const row = db.select().from(settings).get();
  expect(row).toEqual({ key: 'unit_system', value: 'us' });
});
```

Add `settings` to the schema imports at the top of the test file.

Append to `__tests__/recipes-repository.test.ts` (reusing its existing helpers/fixtures style):

```ts
it('round-trips the ingredient scaling flag and defaults it to linear', () => {
  const db = makeTestDb();
  const id = createRecipe(db, {
    title: 'Chili',
    description: null,
    servings: 4,
    notes: null,
    ingredients: [
      { name: 'Beans', quantity: 400, unit: 'g' },
      { name: 'Chili flakes', quantity: 1, unit: 'ts', scaling: 'fixed' },
    ],
    instructions: [],
  });
  const details = getRecipe(db, id);
  expect(details?.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- schema recipes-repository`
Expected: FAIL — `settings` is not exported from schema; `scaling` does not exist on the row type / column missing.

- [ ] **Step 3: Extend the schema**

In `lib/db/schema.ts`, add to the `recipeIngredients` table (after `unit`):

```ts
  scaling: text('scaling', { enum: ['linear', 'fixed'] })
    .notNull()
    .default('linear'),
```

And add the new table plus row type at the bottom:

```ts
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type SettingRow = typeof settings.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: a new `drizzle/0001_<name>.sql` containing `ALTER TABLE recipe_ingredients ADD COLUMN scaling ...` and `CREATE TABLE settings ...`, plus updated `drizzle/meta/_journal.json`, `drizzle/meta/0001_snapshot.json`, and `drizzle/migrations.js`. Inspect the SQL to confirm it is additive only (no table rebuilds of existing data).

- [ ] **Step 5: Carry scaling through the repository**

In `lib/db/recipes.ts`:

```ts
export type IngredientInput = {
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling?: 'linear' | 'fixed';
};
```

And in `insertChildren`, add to the ingredient `.values({ ... })` object:

```ts
        scaling: ing.scaling ?? 'linear',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all suites PASS (existing repository/schema tests prove the migration applies cleanly on top of `0000_*`).

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add lib/db/schema.ts lib/db/recipes.ts drizzle __tests__/schema.test.ts __tests__/recipes-repository.test.ts
git commit -m "feat: add ingredient scaling flag and settings table with migration"
```

---

### Task 2: Settings repository

**Files:**
- Create: `frontend/lib/db/settings.ts`
- Test: `frontend/__tests__/settings-repository.test.ts`

**Interfaces:**
- Consumes: `settings` table (Task 1), `DB` type from `lib/db/types.ts`.
- Produces (the `UnitSystem` type is DEFINED in this file; Tasks 3 and 6 import it from `lib/db/settings`):

```ts
// lib/db/settings.ts
export type UnitSystem = 'metric' | 'us';
export function getUnitSystem(db: DB): UnitSystem;   // 'metric' when unset or unrecognized
export function setUnitSystem(db: DB, system: UnitSystem): void;  // upsert
```

Later tasks import `UnitSystem` from `lib/db/settings.ts`.

- [ ] **Step 1: Write the failing test**

`__tests__/settings-repository.test.ts`:

```ts
import { getUnitSystem, setUnitSystem } from '../lib/db/settings';

import { makeTestDb } from './helpers/testDb';

describe('settings repository', () => {
  it('defaults to metric when unset', () => {
    const db = makeTestDb();
    expect(getUnitSystem(db)).toBe('metric');
  });

  it('persists and reads back the unit system', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    expect(getUnitSystem(db)).toBe('us');
  });

  it('overwrites an existing value', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    setUnitSystem(db, 'metric');
    expect(getUnitSystem(db)).toBe('metric');
  });

  it('falls back to metric on an unrecognized stored value', () => {
    const db = makeTestDb();
    setUnitSystem(db, 'us');
    db.update(settings).set({ value: 'imperial-ish' }).run();
    expect(getUnitSystem(db)).toBe('metric');
  });
});
```

Add `import { settings } from '../lib/db/schema';` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings-repository`
Expected: FAIL with "Cannot find module '../lib/db/settings'".

- [ ] **Step 3: Implement the repository**

`lib/db/settings.ts`:

```ts
import { eq } from 'drizzle-orm';

import { settings } from './schema';
import type { DB } from './types';

export type UnitSystem = 'metric' | 'us';

const UNIT_SYSTEM_KEY = 'unit_system';

export function getUnitSystem(db: DB): UnitSystem {
  const row = db.select().from(settings).where(eq(settings.key, UNIT_SYSTEM_KEY)).get();
  return row?.value === 'us' ? 'us' : 'metric';
}

export function setUnitSystem(db: DB, system: UnitSystem): void {
  db.insert(settings)
    .values({ key: UNIT_SYSTEM_KEY, value: system })
    .onConflictDoUpdate({ target: settings.key, set: { value: system } })
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- settings-repository`
Expected: 4 tests PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add lib/db/settings.ts __tests__/settings-repository.test.ts
git commit -m "feat: add settings repository for the unit-system preference"
```

---

### Task 3: Measure engine — registry, fractions, conversion, locale formatting

**Files:**
- Modify: `frontend/lib/units.ts`
- Modify: `frontend/lib/quantity.ts`
- Modify: `frontend/lib/i18n/index.ts`
- Create: `frontend/lib/measure.ts`
- Test: `frontend/__tests__/measure.test.ts`, extend `frontend/__tests__/quantity.test.ts`

**Interfaces:**
- Consumes: `UNITS`/`UnitCode` (existing), `UnitSystem` from `lib/db/settings.ts` (Task 2), `i18n` instance from `lib/i18n`.
- Produces (used by Tasks 5–6):

```ts
// lib/units.ts additions
export type ScalingMode = 'linear' | 'fixed';
export type Dimension = 'mass' | 'volume';
export const CANONICAL_MEASURES: Record<string, { dimension: Dimension; toBase: number }>;
export const US_DISPLAY_UNITS: readonly ['oz', 'lb', 'cup'];
export function isLocalizableUnit(code: string): boolean;

// lib/quantity.ts change (backward compatible — second param defaults to 'en')
export function formatQuantity(quantity: number | null, locale?: string): string;

// lib/i18n/index.ts addition
export function currentLocale(): 'en' | 'nb';

// lib/measure.ts
export type DisplayQuantity = { amountText: string; unitCode: string | null };
export type DisplayOptions = {
  scaleFactor: number;
  system: UnitSystem;         // imported from lib/db/settings
  locale: 'en' | 'nb';
  scaling?: ScalingMode;      // default 'linear'
};
export function formatFraction(value: number): string;
export function displayQuantity(
  quantity: number | null,
  unit: string | null,
  opts: DisplayOptions
): DisplayQuantity | null;    // null when quantity is null
```

Converted teaspoon/tablespoon amounts return `unitCode: 'ts'` / `'ss'` (NOT `'tsp'`/`'tbsp'` — those aren't i18n keys); US mass/cup return `'oz'`/`'lb'`/`'cup'`.

- [ ] **Step 1: Write the failing tests**

Extend `__tests__/quantity.test.ts` with a new describe block:

```ts
describe('formatQuantity locale', () => {
  it('uses a comma separator for nb', () => {
    expect(formatQuantity(1.5, 'nb')).toBe('1,5');
  });

  it('defaults to a dot separator', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(1.5, 'en')).toBe('1.5');
  });

  it('keeps two-decimal precision with either separator', () => {
    expect(formatQuantity(0.333, 'nb')).toBe('0,33');
    expect(formatQuantity(900, 'nb')).toBe('900');
  });
});
```

Create `__tests__/measure.test.ts`:

```ts
import { displayQuantity, formatFraction } from '../lib/measure';

describe('formatFraction', () => {
  it.each([
    [2, '2'],
    [0.5, '½'],
    [3.3333, '3⅓'],
    [1.984, '2'], // rounds up to the next whole
    [0.845, '⅞'],
    [3.527, '3½'],
    [2.2046, '2¼'],
    [0.2, '¼'],
    [0.02, '⅛'], // never snaps a non-zero amount to zero
    [7.0547, '7'],
  ])('formats %f as %s', (value, expected) => {
    expect(formatFraction(value)).toBe(expected);
  });
});

const metricEn = { scaleFactor: 1, system: 'metric', locale: 'en' } as const;
const usEn = { scaleFactor: 1, system: 'us', locale: 'en' } as const;

describe('displayQuantity', () => {
  it('returns null for null quantities regardless of options', () => {
    expect(displayQuantity(null, 'g', usEn)).toBeNull();
    expect(displayQuantity(null, null, { ...metricEn, scaleFactor: 3 })).toBeNull();
  });

  it('scales linearly in metric without changing the unit', () => {
    expect(displayQuantity(600, 'g', { ...metricEn, scaleFactor: 1.5 })).toEqual({
      amountText: '900',
      unitCode: 'g',
    });
    expect(displayQuantity(1.5, 'dl', { ...metricEn, scaleFactor: 2 })).toEqual({
      amountText: '3',
      unitCode: 'dl',
    });
  });

  it('uses the locale decimal separator in metric', () => {
    expect(displayQuantity(1.5, 'dl', { ...metricEn, locale: 'nb' })).toEqual({
      amountText: '1,5',
      unitCode: 'dl',
    });
  });

  it('keeps fixed-scaling amounts constant but still converts them', () => {
    expect(displayQuantity(1, 'ts', { ...metricEn, scaleFactor: 2, scaling: 'fixed' })).toEqual({
      amountText: '1',
      unitCode: 'ts',
    });
    expect(displayQuantity(2, 'dl', { ...usEn, scaleFactor: 3, scaling: 'fixed' })).toEqual({
      amountText: '⅞',
      unitCode: 'cup',
    });
  });

  it('passes stk and free-text units through with a scaled number in both systems', () => {
    expect(displayQuantity(3, 'stk', { ...usEn, scaleFactor: 1.5 })).toEqual({
      amountText: '4.5',
      unitCode: 'stk',
    });
    expect(displayQuantity(2, 'never', { ...metricEn, scaleFactor: 2, locale: 'nb' })).toEqual({
      amountText: '4',
      unitCode: 'never',
    });
    expect(displayQuantity(1.5, 'stk', { ...metricEn, locale: 'nb' })).toEqual({
      amountText: '1,5',
      unitCode: 'stk',
    });
  });

  it('formats a unit-less quantity as a plain localized number', () => {
    expect(displayQuantity(2, null, { ...usEn, scaleFactor: 2 })).toEqual({
      amountText: '4',
      unitCode: null,
    });
  });

  it('keeps ts/ss codes in US mode with fraction formatting', () => {
    expect(displayQuantity(2, 'ts', usEn)).toEqual({ amountText: '2', unitCode: 'ts' });
    expect(displayQuantity(1, 'ss', { ...usEn, scaleFactor: 0.5 })).toEqual({
      amountText: '½',
      unitCode: 'ss',
    });
  });

  it('converts metric mass to oz below 1 lb and lb above', () => {
    expect(displayQuantity(100, 'g', usEn)).toEqual({ amountText: '3½', unitCode: 'oz' });
    expect(displayQuantity(600, 'g', { ...usEn, scaleFactor: 1.5 })).toEqual({
      amountText: '2',
      unitCode: 'lb',
    });
    expect(displayQuantity(1, 'kg', usEn)).toEqual({ amountText: '2¼', unitCode: 'lb' });
  });

  it('converts metric volume through the ts/ss/cup bands', () => {
    expect(displayQuantity(1, 'ml', usEn)).toEqual({ amountText: '¼', unitCode: 'ts' });
    expect(displayQuantity(0.1, 'ml', usEn)).toEqual({ amountText: '⅛', unitCode: 'ts' });
    expect(displayQuantity(15, 'ml', usEn)).toEqual({ amountText: '1', unitCode: 'ss' });
    expect(displayQuantity(0.5, 'dl', usEn)).toEqual({ amountText: '3⅓', unitCode: 'ss' });
    expect(displayQuantity(2, 'dl', usEn)).toEqual({ amountText: '⅞', unitCode: 'cup' });
    expect(displayQuantity(1, 'l', usEn)).toEqual({ amountText: '4¼', unitCode: 'cup' });
  });
});
```

(Derivations for reviewers: 100 g = 3.527 oz → 3½; 1 kg = 2.2046 lb → 2¼; 200 ml = 0.8453 cup → ⅞; 50 ml = 3.333 tbsp → 3⅓; 1 l = 4.2268 cup → 4¼; 15 ml is not `< 15` so it lands in the tbsp band as exactly 1.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- measure quantity`
Expected: measure suite FAILS with "Cannot find module '../lib/measure'"; the new quantity cases FAIL on the missing locale parameter.

- [ ] **Step 3: Implement**

`lib/quantity.ts` — replace `formatQuantity`:

```ts
export function formatQuantity(quantity: number | null, locale: string = 'en'): string {
  if (quantity === null) return '';
  const text = String(Math.round(quantity * 100) / 100);
  return locale.startsWith('nb') ? text.replace('.', ',') : text;
}
```

`lib/units.ts` — append:

```ts
export type ScalingMode = 'linear' | 'fixed';
export type Dimension = 'mass' | 'volume';

// Canonical units that participate in conversion, with factors to the
// dimension's base unit (mass: g, volume: ml). 'stk' is a count — absent
// here on purpose: it scales but never converts.
export const CANONICAL_MEASURES: Record<string, { dimension: Dimension; toBase: number }> = {
  g: { dimension: 'mass', toBase: 1 },
  kg: { dimension: 'mass', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
  dl: { dimension: 'volume', toBase: 100 },
  l: { dimension: 'volume', toBase: 1000 },
  ts: { dimension: 'volume', toBase: 5 },
  ss: { dimension: 'volume', toBase: 15 },
};

// Display-only US codes (never stored). Converted tsp/tbsp amounts reuse
// the 'ts'/'ss' codes, whose English labels already read "tsp"/"tbsp".
export const US_DISPLAY_UNITS = ['oz', 'lb', 'cup'] as const;

export function isLocalizableUnit(code: string): boolean {
  return (
    (UNITS as readonly string[]).includes(code) ||
    (US_DISPLAY_UNITS as readonly string[]).includes(code)
  );
}
```

`lib/i18n/index.ts` — append:

```ts
export function currentLocale(): 'en' | 'nb' {
  return i18n.locale.startsWith('nb') ? 'nb' : 'en';
}
```

`lib/measure.ts`:

```ts
import type { UnitSystem } from './db/settings';
import { formatQuantity } from './quantity';
import { CANONICAL_MEASURES, type ScalingMode } from './units';

export type DisplayQuantity = { amountText: string; unitCode: string | null };

export type DisplayOptions = {
  scaleFactor: number;
  system: UnitSystem;
  locale: 'en' | 'nb';
  scaling?: ScalingMode;
};

const OZ_G = 28.3495;
const LB_G = 453.592;
const CUP_ML = 236.588;
const TBSP_ML = 15;
const QUARTER_CUP_ML = CUP_ML / 4;

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
];

export function formatFraction(value: number): string {
  let whole = Math.floor(value);
  const rest = value - whole;
  let glyph = '';
  let bestDistance = rest; // distance to snapping down to the whole
  for (const [fraction, candidate] of FRACTIONS) {
    const distance = Math.abs(rest - fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      glyph = candidate;
    }
  }
  if (1 - rest < bestDistance) {
    whole += 1;
    glyph = '';
  }
  if (whole === 0 && glyph === '' && value > 0) glyph = '⅛'; // never render a non-zero amount as 0
  if (whole === 0) return glyph;
  return `${whole}${glyph}`;
}

export function displayQuantity(
  quantity: number | null,
  unit: string | null,
  opts: DisplayOptions
): DisplayQuantity | null {
  if (quantity === null) return null;
  const amount = opts.scaling === 'fixed' ? quantity : quantity * opts.scaleFactor;

  const measure = unit === null ? undefined : CANONICAL_MEASURES[unit];
  if (!measure || opts.system === 'metric') {
    // stk, free text, unit-less, and all of metric mode: unit unchanged.
    return { amountText: formatQuantity(amount, opts.locale), unitCode: unit };
  }
  if (unit === 'ts' || unit === 'ss') {
    // Culinarily identical to tsp/tbsp — relabeling only, no math.
    return { amountText: formatFraction(amount), unitCode: unit };
  }

  const base = amount * measure.toBase;
  if (measure.dimension === 'mass') {
    return base < LB_G
      ? { amountText: formatFraction(base / OZ_G), unitCode: 'oz' }
      : { amountText: formatFraction(base / LB_G), unitCode: 'lb' };
  }
  if (base < TBSP_ML) return { amountText: formatFraction(base / 5), unitCode: 'ts' };
  if (base < QUARTER_CUP_ML) return { amountText: formatFraction(base / TBSP_ML), unitCode: 'ss' };
  return { amountText: formatFraction(base / CUP_ML), unitCode: 'cup' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- measure quantity`
Expected: all PASS. Then `npm test` — the full suite stays green (`formatQuantity`'s default keeps old call sites byte-identical).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add lib/units.ts lib/quantity.ts lib/measure.ts lib/i18n/index.ts __tests__/measure.test.ts __tests__/quantity.test.ts
git commit -m "feat: add measure engine with scaling, US conversion, and locale formatting"
```

---

### Task 4: SegmentedControl UI primitive

**Files:**
- Create: `frontend/components/ui/SegmentedControl.tsx`
- Test: extend `frontend/__tests__/ui.test.tsx`

**Interfaces:**
- Consumes: nothing beyond react-native + NativeWind.
- Produces:

```tsx
export type Segment<K extends string> = { key: K; label: string };
export function SegmentedControl<K extends string>(props: {
  segments: Segment<K>[];
  selected: K;
  onSelect: (key: K) => void;
}): React.JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Append to `__tests__/ui.test.tsx` (follow the file's existing import/describe style; RNTL v13 sync `render`):

```tsx
describe('SegmentedControl', () => {
  it('renders all segments and marks the selected one', () => {
    render(
      <SegmentedControl
        segments={[
          { key: 'metric', label: 'Metric' },
          { key: 'us', label: 'US' },
        ]}
        selected="metric"
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByText('Metric')).toBeTruthy();
    expect(screen.getByText('US')).toBeTruthy();
    expect(screen.getByLabelText('Metric').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByLabelText('US').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
  });

  it('reports the tapped segment key', () => {
    const onSelect = jest.fn();
    render(
      <SegmentedControl
        segments={[
          { key: 'metric', label: 'Metric' },
          { key: 'us', label: 'US' },
        ]}
        selected="metric"
        onSelect={onSelect}
      />
    );
    fireEvent.press(screen.getByLabelText('US'));
    expect(onSelect).toHaveBeenCalledWith('us');
  });
});
```

Add the import: `import { SegmentedControl } from '../components/ui/SegmentedControl';` (and `fireEvent` from RNTL if not already imported).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ui`
Expected: FAIL with "Cannot find module '../components/ui/SegmentedControl'".

- [ ] **Step 3: Implement**

`components/ui/SegmentedControl.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';

export type Segment<K extends string> = { key: K; label: string };

type SegmentedControlProps<K extends string> = {
  segments: Segment<K>[];
  selected: K;
  onSelect: (key: K) => void;
};

export function SegmentedControl<K extends string>({
  segments,
  selected,
  onSelect,
}: SegmentedControlProps<K>) {
  return (
    <View className="flex-row gap-2">
      {segments.map((segment) => {
        const isSelected = segment.key === selected;
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="button"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(segment.key)}
            className={`min-h-14 flex-1 items-center justify-center rounded-full px-4 ${
              isSelected ? 'bg-clay' : 'bg-linen'
            } active:opacity-80`}>
            <Text
              className={`font-body-bold text-sm ${isSelected ? 'text-cream' : 'text-ink'}`}>
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ui`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc --noEmit
git add components/ui/SegmentedControl.tsx __tests__/ui.test.tsx
git commit -m "feat: add SegmentedControl ui primitive"
```

---

### Task 5: Per-ingredient scaling flag in form state and RecipeForm

**Files:**
- Modify: `frontend/lib/form.ts`
- Modify: `frontend/components/RecipeForm.tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: extend `frontend/__tests__/form.test.ts`, `frontend/__tests__/recipe-form.test.tsx`

**Interfaces:**
- Consumes: `ScalingMode` from `lib/units.ts` (Task 3), `IngredientInput.scaling` (Task 1), `currentLocale` from `lib/i18n` (Task 3), existing `UnitChip` (local to RecipeForm.tsx).
- Produces: `IngredientDraft` gains `scaling: ScalingMode`; `formStateFromRecipe` maps it from rows (and now formats quantities with the device locale); `recipeInputFromForm` passes it through. RecipeForm renders two chips per ingredient row toggling `scaling`.

- [ ] **Step 1: Write the failing tests**

Extend `__tests__/form.test.ts` (match its existing fixture style — it builds `RecipeWithDetails` objects and asserts on mappings; ingredient row fixtures now need the `scaling` field, which the existing fixtures must also gain to satisfy the row type):

```ts
it('round-trips the scaling flag through form state', () => {
  const details: RecipeWithDetails = {
    recipe: {
      id: 'r1',
      title: 'Chili',
      description: null,
      servings: 4,
      notes: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
    ingredients: [
      {
        id: 'i1',
        recipeId: 'r1',
        name: 'Beans',
        quantity: 400,
        unit: 'g',
        scaling: 'linear',
        sortOrder: 0,
      },
      {
        id: 'i2',
        recipeId: 'r1',
        name: 'Chili flakes',
        quantity: 1,
        unit: 'ts',
        scaling: 'fixed',
        sortOrder: 1,
      },
    ],
    instructions: [],
  };
  const state = formStateFromRecipe(details);
  expect(state.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);

  const input = recipeInputFromForm(state);
  expect(input.ingredients.map((i) => i.scaling)).toEqual(['linear', 'fixed']);
});
```

Extend `__tests__/recipe-form.test.tsx` (reuse its existing mocks and helpers; RNTL v13 sync render). New test:

```tsx
it('toggles an ingredient to fixed scaling and saves it', () => {
  const onSave = jest.fn();
  render(
    <RecipeForm
      heading="Edit"
      initialState={{
        title: 'Chili',
        description: '',
        servings: 4,
        notes: '',
        ingredients: [{ key: 'k1', quantity: '1', unit: 'ts', name: 'Chili flakes', scaling: 'linear' }],
        instructions: [],
      }}
      onSave={onSave}
    />
  );

  fireEvent.press(screen.getByText(en.form.scalingFixed));
  fireEvent.press(screen.getByText(en.form.save));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      ingredients: [expect.objectContaining({ scaling: 'fixed' })],
    })
  );
});
```

(`en` here is the translation JSON the existing test file already imports — follow whatever accessor it uses for localized strings; if it uses `t()` directly, use `t('form.scalingFixed')`.) Any existing fixtures in this file that build `IngredientDraft` objects gain `scaling: 'linear'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- form recipe-form`
Expected: FAIL — `scaling` missing on `IngredientDraft` (type error surfaces at runtime as missing chip text / TS failure via `tsc`), `form.scalingFixed` key not found.

- [ ] **Step 3: Implement lib/form.ts changes**

```ts
import { currentLocale } from './i18n';
import type { ScalingMode } from './units';
```

```ts
export type IngredientDraft = {
  key: string;
  quantity: string;
  unit: string | null;
  name: string;
  scaling: ScalingMode;
};
```

In `formStateFromRecipe`, the ingredient mapping becomes:

```ts
    ingredients: details.ingredients.map((ing) => ({
      key: draftKey(),
      quantity: formatQuantity(ing.quantity, currentLocale()),
      unit: ing.unit,
      name: ing.name,
      scaling: ing.scaling,
    })),
```

In `recipeInputFromForm`, the ingredient mapping becomes:

```ts
      .map((ing) => ({
        name: ing.name.trim(),
        quantity: parseQuantity(ing.quantity),
        unit: ing.unit,
        scaling: ing.scaling,
      })),
```

- [ ] **Step 4: Implement RecipeForm changes**

In `components/RecipeForm.tsx`:

1. Add `t('form.scalingLinear')` / `t('form.scalingFixed')` chips inside the ingredient card, directly below `<UnitPicker …/>` (reusing the local `UnitChip` component):

```tsx
              <View className="flex-row gap-2">
                <UnitChip
                  label={t('form.scalingLinear')}
                  selected={ing.scaling === 'linear'}
                  onPress={() => patchIngredient(ing.key, { scaling: 'linear' })}
                />
                <UnitChip
                  label={t('form.scalingFixed')}
                  selected={ing.scaling === 'fixed'}
                  onPress={() => patchIngredient(ing.key, { scaling: 'fixed' })}
                />
              </View>
```

2. The add-ingredient button's new draft gains the default:

```tsx
                  { key: draftKey(), quantity: '', unit: null, name: '', scaling: 'linear' },
```

- [ ] **Step 5: Add the i18n keys**

`en.json`, in `"form"`:

```json
    "scalingLinear": "Scales with servings",
    "scalingFixed": "Fixed amount"
```

`nb.json`, in `"form"`:

```json
    "scalingLinear": "Skaleres med porsjoner",
    "scalingFixed": "Fast mengde"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS (including the i18n key-symmetry test).

- [ ] **Step 7: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add lib/form.ts components/RecipeForm.tsx lib/i18n/en.json lib/i18n/nb.json __tests__/form.test.ts __tests__/recipe-form.test.tsx
git commit -m "feat: add per-ingredient scaling flag to the recipe form"
```

---

### Task 6: Detail screen — servings stepper, unit toggle, transformed quantities

**Files:**
- Modify: `frontend/app/recipe/[id]/index.tsx`
- Modify: `frontend/lib/i18n/en.json`, `frontend/lib/i18n/nb.json`
- Test: extend/rework `frontend/__tests__/recipe-detail.test.tsx`

**Interfaces:**
- Consumes: `displayQuantity` + `DisplayOptions` (Task 3), `isLocalizableUnit` (Task 3), `currentLocale` (Task 3), `getUnitSystem`/`setUnitSystem`/`UnitSystem` (Task 2), `SegmentedControl` (Task 4), `Stepper` (existing, props `{value, onChange, min?}` — increment/decrement Pressables have accessibilityLabels `increment`/`decrement`), `IngredientRow.scaling` (Task 1).
- Produces: the final user-facing feature; no downstream consumers.

- [ ] **Step 1: Rework the test file's live-query mock and add failing tests**

In `__tests__/recipe-detail.test.tsx`:

1. Add a settings-repository mock next to the existing module mocks:

```tsx
jest.mock('../lib/db/settings', () => ({
  getUnitSystem: jest.fn(() => 'metric'),
  setUnitSystem: jest.fn(),
}));
```

and import for assertions:

```tsx
import { getUnitSystem, setUnitSystem } from '../lib/db/settings';
```

2. Replace `mockQueries` (the `mockReturnValueOnce` chain breaks on re-render — stepper/toggle presses re-invoke all three `useLiveQuery` calls) with a modulo-based implementation, and let it accept ingredients:

```tsx
function mockQueries(
  recipeResult: { data: unknown[]; updatedAt: Date | undefined },
  ingredients: unknown[] = []
) {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 3;
    call += 1;
    if (index === 0) return recipeResult;
    if (index === 1) return { data: ingredients, updatedAt: recipeResult.updatedAt };
    return { data: [], updatedAt: recipeResult.updatedAt };
  });
}
```

3. Ingredient fixtures (module scope):

```tsx
const flourRow = {
  id: 'i1',
  recipeId: 'r1',
  name: 'Flour',
  quantity: 200,
  unit: 'g',
  scaling: 'linear',
  sortOrder: 0,
};
const chiliRow = {
  id: 'i2',
  recipeId: 'r1',
  name: 'Chili flakes',
  quantity: 1,
  unit: 'ts',
  scaling: 'fixed',
  sortOrder: 1,
};
```

4. New tests (the existing three keep passing unchanged):

```tsx
it('rescales linear ingredients when servings are stepped up', () => {
  mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
  render(<RecipeDetailScreen />);

  expect(screen.getByText('200 g')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('increment')); // 4 → 5 servings
  expect(screen.getByText('250 g')).toBeTruthy();
});

it('keeps fixed ingredients constant and shows the adjust-to-taste hint when scaled', () => {
  mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
  render(<RecipeDetailScreen />);

  expect(screen.queryByText(/adjust to taste/)).toBeNull();
  fireEvent.press(screen.getByLabelText('increment'));
  expect(screen.getByText('1 tsp')).toBeTruthy(); // unscaled, en label for ts
  expect(screen.getByText(/adjust to taste/)).toBeTruthy();
});

it('converts quantities and persists the preference when toggled to US', () => {
  mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
  render(<RecipeDetailScreen />);

  fireEvent.press(screen.getByLabelText('US'));
  expect(setUnitSystem).toHaveBeenCalledWith(expect.anything(), 'us');
  expect(screen.getByText('7 oz')).toBeTruthy(); // 200 g = 7.05 oz → 7
});

it('reads the persisted unit system on mount', () => {
  (getUnitSystem as jest.Mock).mockReturnValueOnce('us');
  mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow]);
  render(<RecipeDetailScreen />);

  expect(screen.getByText('7 oz')).toBeTruthy();
});
```

Add `fireEvent` to the RNTL import and reset the settings mocks in `beforeEach` (`(getUnitSystem as jest.Mock).mockClear().mockReturnValue('metric'); (setUnitSystem as jest.Mock).mockClear();`).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- recipe-detail`
Expected: the three pre-existing tests PASS (mock rework is behavior-compatible); the four new tests FAIL (no stepper/toggle rendered, quantities unscaled).

- [ ] **Step 3: Implement the screen changes**

In `app/recipe/[id]/index.tsx`:

1. Imports — add:

```tsx
import React, { useState } from 'react';
```

(replacing the plain `React` import), and:

```tsx
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Stepper } from '../../../components/ui/Stepper';
import { getUnitSystem, setUnitSystem, type UnitSystem } from '../../../lib/db/settings';
import { currentLocale } from '../../../lib/i18n';
import { displayQuantity } from '../../../lib/measure';
import { isLocalizableUnit } from '../../../lib/units';
```

Remove the now-unused `formatQuantity` and `UNITS` imports (both replaced by the calls below) and change `unitLabel` to:

```tsx
function unitLabel(unit: string | null): string {
  if (unit === null) return '';
  return isLocalizableUnit(unit) ? t(`units.${unit}`) : unit;
}
```

2. State — before the `useLiveQuery` calls (hooks must run on every render, ahead of the early returns):

```tsx
  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const [system, setSystem] = useState<UnitSystem>(() => getUnitSystem(db));
```

3. After the `recipe` guards, derive:

```tsx
  const selectedServings = servingsOverride ?? recipe.servings;
  const scaleFactor = selectedServings / recipe.servings;
  const locale = currentLocale();

  const changeSystem = (next: UnitSystem) => {
    setSystem(next);
    setUnitSystem(db, next);
  };
```

4. Replace the servings `<Text>` line (`{t('recipes.servingsCount', { count: recipe.servings })}`) with the control row:

```tsx
        <View className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-body-bold text-sm text-ink">{t('detail.servings')}</Text>
            <Stepper value={selectedServings} onChange={setServingsOverride} min={1} />
          </View>
          <SegmentedControl
            segments={[
              { key: 'metric', label: t('detail.unitsMetric') },
              { key: 'us', label: t('detail.unitsUS') },
            ]}
            selected={system}
            onSelect={changeSystem}
          />
        </View>
```

5. Replace the ingredient row rendering inside the `.map()`:

```tsx
              {(ingredients ?? []).map((ing) => {
                const display = displayQuantity(ing.quantity, ing.unit, {
                  scaleFactor,
                  system,
                  locale,
                  scaling: ing.scaling,
                });
                const showHint = ing.scaling === 'fixed' && scaleFactor !== 1;
                return (
                  <View key={ing.id} className="flex-row items-baseline gap-3">
                    <Text className="min-w-16 font-display text-base text-clay">
                      {display ? `${display.amountText} ${unitLabel(display.unitCode)}`.trim() : ''}
                    </Text>
                    <Text className="flex-1 font-body text-base text-ink">
                      {ing.name}
                      {showHint ? (
                        <Text className="font-body text-xs text-ink opacity-50">
                          {'  ·  '}
                          {t('detail.adjustToTaste')}
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                );
              })}
```

- [ ] **Step 4: Add the i18n keys**

`en.json` — in `"detail"`:

```json
    "servings": "Servings",
    "unitsMetric": "Metric",
    "unitsUS": "US",
    "adjustToTaste": "adjust to taste"
```

and in `"units"`:

```json
    "oz": "oz",
    "lb": "lb",
    "cup": "cup"
```

`nb.json` — in `"detail"`:

```json
    "servings": "Porsjoner",
    "unitsMetric": "Metrisk",
    "unitsUS": "US",
    "adjustToTaste": "smak til"
```

and in `"units"`:

```json
    "oz": "oz",
    "lb": "lb",
    "cup": "cup"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: full suite PASS.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm run lint && npx tsc --noEmit
npx expo export --platform android
git add 'app/recipe/[id]/index.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/recipe-detail.test.tsx
git commit -m "feat: add servings scaling and unit conversion to recipe detail"
```

---

### Task 7: Final verification

**Files:** none modified (verification only; fix anything broken before finishing).

**Interfaces:**
- Consumes: everything.
- Produces: a verified slice.

- [ ] **Step 1: Full automated pass**

Run from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: all green, zero lint warnings, bundle exports. Fix anything that isn't before proceeding.

- [ ] **Step 2: Record the deferred manual checklist**

On-device verification is deferred (headless environment). The user's manual walk in Expo Go, per `TESTING.md`:
- Open a recipe → step servings up/down → quantities rescale in place; leaving and reopening resets to saved servings.
- Toggle Metric/US → quantities convert (fractions on US); kill and relaunch the app → the toggle choice is remembered.
- Mark an ingredient "Fixed amount" in the edit form → save → scale the recipe → that row stays constant and shows the "adjust to taste" hint.
- Norwegian device language: decimals show commas ("1,5 dl"); all new labels localized.

- [ ] **Step 3: Commit anything outstanding**

If Steps 1–2 required fixes, commit them with descriptive messages; otherwise nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** registry + factors (T3), scaling ephemeral per visit (T6 state), US bands + fraction snapping + ⅛ floor (T3), metric-keeps-authored-unit (T3 routing), ts/ss relabel-only (T3), settings table + repository + default metric (T1–T2), scaling column + default + repository passthrough (T1), form chips + draft mapping (T5), control row + hint + persistence (T6), locale decimal separators incl. form quantities (T3, T5), i18n keys both languages (T5–T6), no new dependencies (all), tests per spec's testing section (T1–T6).
- **Known judgment calls:** converted tsp/tbsp amounts reuse canonical codes `ts`/`ss` so no new i18n keys or storable codes are introduced; `formatQuantity` keeps its 2-decimal precision with a defaulted locale parameter so existing call sites are unaffected; the detail-screen test file's `mockReturnValueOnce` chain is replaced with a modulo-based `mockImplementation` because stepper/toggle presses re-render and re-invoke all three live queries (also fixes a robustness minor from the previous slice's final review).
- **Type consistency check:** `ScalingMode` lives in `lib/units.ts` (T3) and is consumed by `lib/form.ts` (T5); `IngredientInput.scaling?` (T1) accepts the required `IngredientDraft.scaling` (T5); `UnitSystem` lives in `lib/db/settings.ts` (T2) and is imported by `lib/measure.ts` (T3) and the screen (T6); `displayQuantity` returns `unitCode` values that `isLocalizableUnit`/`unitLabel` (T6) resolve (`ts`, `ss`, `oz`, `lb`, `cup`, canonical codes, free text, null).
