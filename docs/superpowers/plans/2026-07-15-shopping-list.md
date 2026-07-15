# Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent shopping list on the Shop tab with tap-to-purchase and a minimal Recently Purchased shelf, fed by the Plan-tab "Add week" CTA, recipe-detail "Add ingredients" (with per-row exclusion), and a quick-add bar.

**Architecture:** A pure aggregation module (`lib/shopping.ts`) turns ingredient rows into merged items (normalized name + unit-dimension buckets, base-unit quantities). A new `shopping_items` table plus repository (`lib/db/shoppingList.ts`) persists them with `skip-existing` / `merge` write modes and status flips for purchase/restore. Three screens write through the repository; the Shop tab renders the table via live queries.

**Tech Stack:** Expo SDK 54, expo-router, drizzle-orm + expo-sqlite (better-sqlite3 in-memory for tests), NativeWind, Jest (`jest-expo`) + `@testing-library/react-native` v13.

**Spec:** `docs/superpowers/specs/2026-07-15-shopping-list-design.md`

## Global Constraints

- All new user-facing strings exist in BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` (key-parity test enforces this).
- Stored quantities are in base units: mass → `g`, volume → `ml` (via `CANONICAL_MEASURES`); `stk`, free-text units, and `null` pass through unchanged.
- Merge key = `normalizedName` (`trim().toLowerCase()`, no plural/language folding) + unit bucket (`mass` | `volume` | `u:<unit>` | `none`). Mismatched buckets stay separate rows.
- Plan CTA uses `skip-existing` mode (tapping twice is a no-op); recipe-detail and quick-add use `merge` mode (sum quantities, union sources).
- `linear` ingredients scale by `entryServings / recipeServings`; `fixed` ingredients contribute their quantity as-is.
- No checkboxes; no "put back" toast (rejected in spec — the shelf is the undo path).
- Purchase/restore are status flips, never deletions.
- Test constraints: `@testing-library/react-native` v13 sync `render(...)` (never `await render`); out-of-scope variables referenced inside `jest.mock` factories must be `mock`-prefixed.
- Run all commands from `frontend/`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Create: `lib/shopping.ts` (pure aggregation; no DB imports), `lib/db/shoppingList.ts` (repository), `lib/unitLabel.ts` (shared unit label helper), `app/(tabs)/shop.tsx` (rewritten from placeholder).
- Modify: `lib/db/schema.ts` (+`shopping_items`), `app/(tabs)/plan.tsx` (sticky CTA), `app/recipe/[id]/index.tsx` (exclusions + add button), `lib/i18n/en.json`, `lib/i18n/nb.json`.
- Delete: `components/PlaceholderScreen.tsx` (last consumer disappears) and the `placeholder` i18n section.
- Tests: `__tests__/shopping.test.ts`, `__tests__/shopping-list-repository.test.ts`, `__tests__/shop-screen.test.tsx`; extend `__tests__/plan-screen.test.tsx`, `__tests__/recipe-detail.test.tsx`.

---

### Task 1: Pure aggregation module

**Files:**
- Create: `lib/shopping.ts`
- Test: `__tests__/shopping.test.ts`

**Interfaces:**
- Consumes: `CANONICAL_MEASURES`, `type ScalingMode` from `lib/units.ts`.
- Produces (used by Tasks 2, 4, 5): `type AggregatedItem { name: string; normalizedName: string; quantity: number | null; unit: string | null; sources: string[] }`; `type PlanIngredientRow { entryServings: number; recipeServings: number; recipeTitle: string; name: string; quantity: number | null; unit: string | null; scaling: ScalingMode }`; `aggregateRows(rows: PlanIngredientRow[]): AggregatedItem[]`; `itemKey(item: { normalizedName: string; unit: string | null }): string`; `normalizeName(name: string): string`; `sumQuantities(a: number | null, b: number | null): number | null`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/shopping-list
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shopping.test.ts`:

```ts
import {
  aggregateRows,
  itemKey,
  normalizeName,
  sumQuantities,
  type PlanIngredientRow,
} from '../lib/shopping';

const row = (overrides: Partial<PlanIngredientRow> = {}): PlanIngredientRow => ({
  entryServings: 4,
  recipeServings: 4,
  recipeTitle: 'Tomato Soup',
  name: 'Tomatoes',
  quantity: 400,
  unit: 'g',
  scaling: 'linear',
  ...overrides,
});

describe('aggregateRows', () => {
  it('scales linear ingredients by entry/recipe servings and leaves fixed ones alone', () => {
    const items = aggregateRows([
      row({ entryServings: 6, recipeServings: 4, quantity: 400, unit: 'g' }),
      row({
        name: 'Salt',
        entryServings: 6,
        recipeServings: 4,
        quantity: 1,
        unit: 'ts',
        scaling: 'fixed',
      }),
    ]);
    const tomatoes = items.find((i) => i.normalizedName === 'tomatoes')!;
    const salt = items.find((i) => i.normalizedName === 'salt')!;
    expect(tomatoes.quantity).toBe(600);
    expect(salt.quantity).toBe(5); // 1 ts fixed → 5 ml base, unscaled
    expect(salt.unit).toBe('ml');
  });

  it('sums same-dimension quantities in base units across unit spellings', () => {
    const items = aggregateRows([
      row({ name: 'Melk', quantity: 2, unit: 'dl', recipeTitle: 'Pannekaker' }),
      row({ name: 'melk ', quantity: 1, unit: 'l', recipeTitle: 'Vafler' }),
      row({ name: 'Mel', quantity: 500, unit: 'g' }),
      row({ name: 'mel', quantity: 1, unit: 'kg' }),
    ]);
    const milk = items.find((i) => i.normalizedName === 'melk')!;
    const flour = items.find((i) => i.normalizedName === 'mel')!;
    expect(milk).toMatchObject({ quantity: 1200, unit: 'ml', sources: ['Pannekaker', 'Vafler'] });
    expect(flour).toMatchObject({ quantity: 1500, unit: 'g' });
  });

  it('keeps mismatched dimensions as separate rows', () => {
    const items = aggregateRows([
      row({ name: 'Tomater', quantity: 400, unit: 'g' }),
      row({ name: 'Tomater', quantity: 2, unit: 'stk' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.unit).sort()).toEqual(['g', 'stk']);
  });

  it('merges stk counts and exact-match free-text units, but not different free text', () => {
    const items = aggregateRows([
      row({ name: 'Løk', quantity: 2, unit: 'stk' }),
      row({ name: 'løk', quantity: 1, unit: 'stk' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'neve' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'neve' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'pose' }),
    ]);
    const onions = items.find((i) => i.normalizedName === 'løk')!;
    expect(onions).toMatchObject({ quantity: 3, unit: 'stk' });
    const basil = items.filter((i) => i.normalizedName === 'basilikum');
    expect(basil).toHaveLength(2);
    expect(basil.find((i) => i.unit === 'neve')!.quantity).toBe(2);
    expect(basil.find((i) => i.unit === 'pose')!.quantity).toBe(1);
  });

  it('does not fold plural or language variants', () => {
    const items = aggregateRows([
      row({ name: 'Tomat', quantity: 1, unit: 'stk' }),
      row({ name: 'Tomater', quantity: 2, unit: 'stk' }),
    ]);
    expect(items).toHaveLength(2);
  });

  it('null quantities merge by contributing sources only, and sum is null only when all are null', () => {
    const items = aggregateRows([
      row({ name: 'Pepper', quantity: null, unit: null, recipeTitle: 'Carbonara' }),
      row({ name: 'pepper', quantity: null, unit: null, recipeTitle: 'Gryte' }),
      row({ name: 'Egg', quantity: 3, unit: null }),
      row({ name: 'Egg', quantity: null, unit: null, recipeTitle: 'Vafler' }),
    ]);
    const pepper = items.find((i) => i.normalizedName === 'pepper')!;
    const eggs = items.find((i) => i.normalizedName === 'egg')!;
    expect(pepper.quantity).toBeNull();
    expect(pepper.sources).toEqual(['Carbonara', 'Gryte']);
    expect(eggs.quantity).toBe(3);
  });

  it('normalizes the unit to base even when the first contribution has a null quantity', () => {
    const items = aggregateRows([
      row({ name: 'Smør', quantity: null, unit: 'kg' }),
      row({ name: 'smør', quantity: 200, unit: 'g' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 200, unit: 'g' });
  });

  it('dedupes sources, keeps first display casing, skips blank names, and guards zero servings', () => {
    const items = aggregateRows([
      row({ name: ' Fløte ', quantity: 2, unit: 'dl', recipeTitle: 'Gryte' }),
      row({ name: 'fløte', quantity: 1, unit: 'dl', recipeTitle: 'Gryte' }),
      row({ name: '   ', quantity: 1, unit: 'g' }),
      row({ name: 'Ris', quantity: 2, unit: 'dl', recipeServings: 0, entryServings: 4 }),
    ]);
    const cream = items.find((i) => i.normalizedName === 'fløte')!;
    expect(cream.name).toBe('Fløte');
    expect(cream.sources).toEqual(['Gryte']);
    expect(items.some((i) => i.normalizedName === '')).toBe(false);
    expect(items.find((i) => i.normalizedName === 'ris')!.quantity).toBe(200); // factor guard → 1
  });
});

describe('itemKey / normalizeName / sumQuantities', () => {
  it('keys by normalized name plus unit bucket', () => {
    expect(itemKey({ normalizedName: 'mel', unit: 'g' })).toBe(
      itemKey({ normalizedName: 'mel', unit: 'kg' })
    );
    expect(itemKey({ normalizedName: 'mel', unit: 'g' })).not.toBe(
      itemKey({ normalizedName: 'mel', unit: 'dl' })
    );
    expect(itemKey({ normalizedName: 'løk', unit: 'stk' })).not.toBe(
      itemKey({ normalizedName: 'løk', unit: null })
    );
  });

  it('normalizeName trims and lowercases', () => {
    expect(normalizeName('  Rød Løk ')).toBe('rød løk');
  });

  it('sumQuantities treats null as no contribution', () => {
    expect(sumQuantities(null, null)).toBeNull();
    expect(sumQuantities(2, null)).toBe(2);
    expect(sumQuantities(null, 3)).toBe(3);
    expect(sumQuantities(2, 3)).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shopping.test`
Expected: FAIL — `Cannot find module '../lib/shopping'`.

- [ ] **Step 3: Implement lib/shopping.ts**

Create `lib/shopping.ts`:

```ts
// Pure shopping-list aggregation: ingredient rows in, merged items out.
// Merge key = normalized name + unit bucket. Mass/volume quantities convert
// to base units (g/ml) and sum; 'stk' and free-text units merge only with
// their exact unit; unit-less rows form their own bucket. No name stemming:
// 'tomat' and 'tomater' stay separate lines (bilingual, no language parsing).
import { CANONICAL_MEASURES, type ScalingMode } from './units';

export type PlanIngredientRow = {
  entryServings: number;
  recipeServings: number;
  recipeTitle: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  scaling: ScalingMode;
};

export type AggregatedItem = {
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  sources: string[];
};

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function measureOf(unit: string | null) {
  return unit !== null && Object.hasOwn(CANONICAL_MEASURES, unit)
    ? CANONICAL_MEASURES[unit]
    : undefined;
}

// The stored unit for a bucket: mass → g, volume → ml, everything else as-is.
function baseUnit(unit: string | null): string | null {
  const measure = measureOf(unit);
  if (!measure) return unit;
  return measure.dimension === 'mass' ? 'g' : 'ml';
}

function baseQuantity(quantity: number, unit: string | null): number {
  const measure = measureOf(unit);
  return measure ? quantity * measure.toBase : quantity;
}

function unitBucket(unit: string | null): string {
  if (unit === null) return 'none';
  const measure = measureOf(unit);
  return measure ? measure.dimension : `u:${unit}`;
}

export function itemKey(item: { normalizedName: string; unit: string | null }): string {
  return `${item.normalizedName} ${unitBucket(item.unit)}`;
}

// Unspecified amounts ("to taste") contribute their source but no number;
// the sum is null only when every contribution is null.
export function sumQuantities(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function aggregateRows(rows: PlanIngredientRow[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>();
  for (const row of rows) {
    const normalizedName = normalizeName(row.name);
    if (normalizedName === '') continue;
    const factor = row.recipeServings > 0 ? row.entryServings / row.recipeServings : 1;
    const scaled =
      row.quantity === null
        ? null
        : row.scaling === 'fixed'
          ? row.quantity
          : row.quantity * factor;
    const quantity = scaled === null ? null : baseQuantity(scaled, row.unit);
    const key = itemKey({ normalizedName, unit: row.unit });
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: row.name.trim(),
        normalizedName,
        quantity,
        unit: baseUnit(row.unit),
        sources: [row.recipeTitle],
      });
      continue;
    }
    existing.quantity = sumQuantities(existing.quantity, quantity);
    if (!existing.sources.includes(row.recipeTitle)) existing.sources.push(row.recipeTitle);
  }
  return Array.from(byKey.values());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shopping.test`
Expected: PASS — 11 tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/shopping.ts __tests__/shopping.test.ts
git commit -m "feat: add shopping aggregation module"
```

---

### Task 2: shopping_items schema, migration, and repository

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/shoppingList.ts`
- Generated: `drizzle/0003_*.sql`, `drizzle/meta/*`, `drizzle/migrations.js` (via drizzle-kit)
- Test: `__tests__/shopping-list-repository.test.ts`

**Interfaces:**
- Consumes: `AggregatedItem`, `itemKey`, `normalizeName`, `sumQuantities` from `lib/shopping` (Task 1); `newId` from `lib/db/id`; `type DB` from `lib/db/types`.
- Produces (used by Tasks 3–5): `shoppingItems` table + `type ShoppingItemRow` from `lib/db/schema`; from `lib/db/shoppingList`: `type AddMode = 'skip-existing' | 'merge'`; `addItems(db: DB, items: AggregatedItem[], mode: AddMode): number`; `addManualItem(db: DB, rawName: string): boolean`; `purchaseItem(db: DB, id: string): void`; `restoreItem(db: DB, id: string): void`; `parseSources(json: string): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shopping-list-repository.test.ts`:

```ts
import { asc, eq } from 'drizzle-orm';

import { shoppingItems } from '../lib/db/schema';
import {
  addItems,
  addManualItem,
  parseSources,
  purchaseItem,
  restoreItem,
} from '../lib/db/shoppingList';
import type { DB } from '../lib/db/types';
import type { AggregatedItem } from '../lib/shopping';

import { makeTestDb } from './helpers/testDb';

const item = (overrides: Partial<AggregatedItem> = {}): AggregatedItem => ({
  name: 'Mel',
  normalizedName: 'mel',
  quantity: 500,
  unit: 'g',
  sources: ['Pannekaker'],
  ...overrides,
});

function allRows(db: DB) {
  return db.select().from(shoppingItems).orderBy(asc(shoppingItems.createdAt)).all();
}

describe('addItems', () => {
  it('inserts fresh active rows with sources as JSON', () => {
    const db = makeTestDb();
    const written = addItems(db, [item(), item({ name: 'Egg', normalizedName: 'egg', quantity: 3, unit: 'stk', sources: [] })], 'merge');

    expect(written).toBe(2);
    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Mel', quantity: 500, unit: 'g', status: 'active', purchasedAt: null });
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker']);
    expect(parseSources(rows[1].sources)).toEqual([]);
  });

  it('skip-existing mode leaves an existing active key untouched', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'skip-existing');
    const written = addItems(db, [item({ quantity: 900, sources: ['Vafler'] })], 'skip-existing');

    expect(written).toBe(0);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(500);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker']);
  });

  it('merge mode sums quantities and unions sources on an existing active key', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const written = addItems(db, [item({ quantity: 250, sources: ['Vafler', 'Pannekaker'] })], 'merge');

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(750);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker', 'Vafler']);
  });

  it('different unit buckets never merge', () => {
    const db = makeTestDb();
    addItems(db, [item({ name: 'Tomater', normalizedName: 'tomater', quantity: 400, unit: 'g' })], 'merge');
    addItems(db, [item({ name: 'Tomater', normalizedName: 'tomater', quantity: 2, unit: 'stk' })], 'merge');

    expect(allRows(db)).toHaveLength(2);
  });

  it('purchased rows are not merge targets — buying again creates a fresh active row', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    purchaseItem(db, allRows(db)[0].id);
    const written = addItems(db, [item({ quantity: 200 })], 'merge');

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'purchased']);
    expect(rows.find((r) => r.status === 'active')!.quantity).toBe(200);
  });

  it('pre-merges duplicate keys within one incoming batch', () => {
    const db = makeTestDb();
    const written = addItems(db, [item({ quantity: 100 }), item({ quantity: 200, sources: ['Vafler'] })], 'merge');

    expect(written).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(300);
    expect(parseSources(rows[0].sources)).toEqual(['Pannekaker', 'Vafler']);
  });

  it('returns 0 for an empty batch', () => {
    const db = makeTestDb();
    expect(addItems(db, [], 'merge')).toBe(0);
  });
});

describe('addManualItem', () => {
  it('trims the name and stores a quantity-less item with no sources', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '  Smør ')).toBe(true);

    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Smør', normalizedName: 'smør', quantity: null, unit: null });
    expect(parseSources(rows[0].sources)).toEqual([]);
  });

  it('is a no-op on blank input', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '   ')).toBe(false);
    expect(allRows(db)).toHaveLength(0);
  });

  it('merges into an existing unit-less active item instead of duplicating', () => {
    const db = makeTestDb();
    addManualItem(db, 'Smør');
    addManualItem(db, 'smør');
    expect(allRows(db)).toHaveLength(1);
  });
});

describe('purchase and restore', () => {
  it('round-trips status and preserves quantity', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const id = allRows(db)[0].id;

    purchaseItem(db, id);
    let row = db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get()!;
    expect(row.status).toBe('purchased');
    expect(row.purchasedAt).not.toBeNull();

    restoreItem(db, id);
    row = db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get()!;
    expect(row.status).toBe('active');
    expect(row.purchasedAt).toBeNull();
    expect(row.quantity).toBe(500);
  });
});

describe('parseSources', () => {
  it('returns [] for malformed JSON or non-array values', () => {
    expect(parseSources('not json')).toEqual([]);
    expect(parseSources('{"a":1}')).toEqual([]);
    expect(parseSources('["Suppe", 3]')).toEqual(['Suppe']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shopping-list-repository`
Expected: FAIL — `Cannot find module '../lib/db/shoppingList'` (schema export also missing).

- [ ] **Step 3: Extend the schema**

In `lib/db/schema.ts`, after the `settings` table, add:

```ts
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    sources: text('sources').notNull().default('[]'),
    status: text('status', { enum: ['active', 'purchased'] })
      .notNull()
      .default('active'),
    purchasedAt: integer('purchased_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('shopping_items_status_idx').on(table.status, table.normalizedName)]
);
```

And with the other row types at the bottom:

```ts
export type ShoppingItemRow = typeof shoppingItems.$inferSelect;
```

- [ ] **Step 4: Generate the migration**

```bash
npx drizzle-kit generate
```

Expected: a new `drizzle/0003_<name>.sql` containing `CREATE TABLE \`shopping_items\`` and the index, plus updated `drizzle/meta/` and `drizzle/migrations.js`. Inspect the SQL to confirm it is purely additive (no ALTER/DROP of existing tables).

- [ ] **Step 5: Implement lib/db/shoppingList.ts**

Create `lib/db/shoppingList.ts`:

```ts
import { eq } from 'drizzle-orm';

import { newId } from './id';
import { shoppingItems } from './schema';
import type { DB } from './types';
import { itemKey, normalizeName, sumQuantities, type AggregatedItem } from '../shopping';

export type AddMode = 'skip-existing' | 'merge';

export function parseSources(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function mergeSources(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const source of incoming) {
    if (!merged.includes(source)) merged.push(source);
  }
  return merged;
}

// Defensive: collapse same-key duplicates within one batch so the write loop
// below never has to reconcile an item with a row it just inserted.
function premerge(items: AggregatedItem[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>();
  for (const item of items) {
    const key = itemKey(item);
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, { ...item, sources: [...item.sources] });
      continue;
    }
    prior.quantity = sumQuantities(prior.quantity, item.quantity);
    prior.sources = mergeSources(prior.sources, item.sources);
  }
  return Array.from(byKey.values());
}

export function addItems(db: DB, items: AggregatedItem[], mode: AddMode): number {
  const batch = premerge(items);
  if (batch.length === 0) return 0;
  const now = Date.now();
  let written = 0;
  db.transaction((tx) => {
    const txDb = tx as unknown as DB;
    const activeRows = txDb
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'active'))
      .all();
    const byKey = new Map(activeRows.map((row) => [itemKey(row), row]));
    for (const item of batch) {
      const existing = byKey.get(itemKey(item));
      if (!existing) {
        txDb
          .insert(shoppingItems)
          .values({
            id: newId(),
            name: item.name,
            normalizedName: item.normalizedName,
            quantity: item.quantity,
            unit: item.unit,
            sources: JSON.stringify(item.sources),
            status: 'active',
            purchasedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        written += 1;
        continue;
      }
      if (mode === 'skip-existing') continue;
      txDb
        .update(shoppingItems)
        .set({
          quantity: sumQuantities(existing.quantity, item.quantity),
          sources: JSON.stringify(mergeSources(parseSources(existing.sources), item.sources)),
          updatedAt: now,
        })
        .where(eq(shoppingItems.id, existing.id))
        .run();
      written += 1;
    }
  });
  return written;
}

export function addManualItem(db: DB, rawName: string): boolean {
  const name = rawName.trim();
  if (name === '') return false;
  addItems(
    db,
    [{ name, normalizedName: normalizeName(name), quantity: null, unit: null, sources: [] }],
    'merge'
  );
  return true;
}

export function purchaseItem(db: DB, id: string): void {
  const now = Date.now();
  db.update(shoppingItems)
    .set({ status: 'purchased', purchasedAt: now, updatedAt: now })
    .where(eq(shoppingItems.id, id))
    .run();
}

export function restoreItem(db: DB, id: string): void {
  db.update(shoppingItems)
    .set({ status: 'active', purchasedAt: null, updatedAt: Date.now() })
    .where(eq(shoppingItems.id, id))
    .run();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- shopping-list-repository`
Expected: PASS — 12 tests. Also run `npm test -- schema` to confirm the migration applies cleanly in the in-memory harness.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/db/schema.ts lib/db/shoppingList.ts drizzle __tests__/shopping-list-repository.test.ts
git commit -m "feat: add shopping_items table and repository with migration"
```

---

### Task 3: Shop tab — quick-add, active list, purchase, shelf

**Files:**
- Create: `lib/unitLabel.ts`
- Rewrite: `app/(tabs)/shop.tsx`
- Modify: `app/recipe/[id]/index.tsx` (lines 20–23: replace the local `unitLabel` with the shared one), `lib/i18n/en.json`, `lib/i18n/nb.json`
- Delete: `components/PlaceholderScreen.tsx`
- Test: `__tests__/shop-screen.test.tsx`

**Interfaces:**
- Consumes: `shoppingItems` schema + repository functions (Task 2); `displayQuantity` from `lib/measure`; `getUnitSystem` from `lib/db/settings`; `currentLocale`, `t` from `lib/i18n`; `Card`, `EmptyState` from `components/ui`.
- Produces: `unitLabel(unit: string | null): string` from `lib/unitLabel` (also consumed by recipe detail).

- [ ] **Step 1: Write the failing test**

Create `__tests__/shop-screen.test.tsx` (the screen calls `useLiveQuery` twice per render — active items first, then purchased):

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import ShopScreen from '../app/(tabs)/shop';
import { addManualItem, purchaseItem, restoreItem } from '../lib/db/shoppingList';

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

jest.mock('../lib/db/settings', () => ({
  getUnitSystem: jest.fn(() => 'metric'),
}));

jest.mock('../lib/db/shoppingList', () => ({
  addManualItem: jest.fn(() => true),
  purchaseItem: jest.fn(),
  restoreItem: jest.fn(),
  parseSources: (json: string) => {
    try {
      const value = JSON.parse(json);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  },
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const addManualItemMock = addManualItem as jest.Mock;
const purchaseItemMock = purchaseItem as jest.Mock;
const restoreItemMock = restoreItem as jest.Mock;

let activeRows: unknown[] = [];
let purchasedRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 2;
    call += 1;
    if (index === 0) return { data: activeRows, updatedAt: new Date() };
    return { data: purchasedRows, updatedAt: new Date() };
  });
}

const flour = {
  id: 's1',
  name: 'Mel',
  normalizedName: 'mel',
  quantity: 1500,
  unit: 'g',
  sources: '["Pannekaker","Vafler"]',
  status: 'active',
  purchasedAt: null,
  createdAt: 1,
  updatedAt: 1,
};
const butter = {
  id: 's2',
  name: 'Smør',
  normalizedName: 'smør',
  quantity: null,
  unit: null,
  sources: '[]',
  status: 'purchased',
  purchasedAt: 2,
  createdAt: 1,
  updatedAt: 2,
};

describe('ShopScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeRows = [];
    purchasedRows = [];
    mockQueries();
  });

  it('shows the empty state when there are no items at all', () => {
    render(<ShopScreen />);
    expect(screen.getByText('Nothing to buy yet')).toBeOnTheScreen();
  });

  it('renders active items with merged quantity and recipe sources', () => {
    activeRows = [flour];
    render(<ShopScreen />);

    expect(screen.getByText('Mel')).toBeOnTheScreen();
    expect(screen.getByText('1500 g')).toBeOnTheScreen();
    expect(screen.getByText('Pannekaker · Vafler')).toBeOnTheScreen();
  });

  it('purchases on card tap and restores on shelf tap', () => {
    activeRows = [flour];
    purchasedRows = [butter];
    render(<ShopScreen />);

    fireEvent.press(screen.getByText('Mel'));
    expect(purchaseItemMock).toHaveBeenCalledWith(expect.anything(), 's1');

    expect(screen.getByText('Recently purchased')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Smør'));
    expect(restoreItemMock).toHaveBeenCalledWith(expect.anything(), 's2');
  });

  it('quick-add submits the draft and clears the input', () => {
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add an item…');

    fireEvent.changeText(input, 'Kaffe');
    fireEvent(input, 'submitEditing');

    expect(addManualItemMock).toHaveBeenCalledWith(expect.anything(), 'Kaffe');
    expect(input.props.value).toBe('');
  });

  it('keeps a rejected draft (blank input) in place', () => {
    addManualItemMock.mockReturnValueOnce(false);
    render(<ShopScreen />);
    const input = screen.getByPlaceholderText('Add an item…');

    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');

    expect(input.props.value).toBe('   ');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shop-screen`
Expected: FAIL — `Unable to find an element with text: Nothing to buy yet` (the placeholder screen renders instead).

- [ ] **Step 3: Create lib/unitLabel.ts and switch recipe detail to it**

Create `lib/unitLabel.ts`:

```ts
import { t } from './i18n';
import { isLocalizableUnit } from './units';

export function unitLabel(unit: string | null): string {
  if (unit === null) return '';
  return isLocalizableUnit(unit) ? t(`units.${unit}`) : unit;
}
```

In `app/recipe/[id]/index.tsx`: delete the local `unitLabel` function (lines 20–23), delete the now-unused `isLocalizableUnit` import, and add:

```tsx
import { unitLabel } from '../../../lib/unitLabel';
```

- [ ] **Step 4: Add the i18n keys**

In `lib/i18n/en.json`: delete the entire `"placeholder"` section and add in its place:

```json
  "shop": {
    "quickAddPlaceholder": "Add an item…",
    "emptyTitle": "Nothing to buy yet",
    "emptyBody": "Add items here, from a recipe, or send your whole week over from the Plan tab.",
    "recentlyPurchased": "Recently purchased"
  },
```

In `lib/i18n/nb.json`: same position:

```json
  "shop": {
    "quickAddPlaceholder": "Legg til en vare…",
    "emptyTitle": "Ingenting å handle ennå",
    "emptyBody": "Legg til varer her, fra en oppskrift, eller send hele uken fra Plan-fanen.",
    "recentlyPurchased": "Nylig kjøpt"
  },
```

- [ ] **Step 5: Rewrite app/(tabs)/shop.tsx and delete the placeholder component**

Replace the entire contents of `app/(tabs)/shop.tsx`:

```tsx
import { asc, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React, { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db/client';
import { shoppingItems } from '../../lib/db/schema';
import { getUnitSystem } from '../../lib/db/settings';
import { addManualItem, parseSources, purchaseItem, restoreItem } from '../../lib/db/shoppingList';
import { currentLocale, t } from '../../lib/i18n';
import { displayQuantity } from '../../lib/measure';
import { unitLabel } from '../../lib/unitLabel';

export default function ShopScreen() {
  const [draft, setDraft] = useState('');
  const system = getUnitSystem(db);
  const locale = currentLocale();

  const { data: activeItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'active'))
      .orderBy(asc(shoppingItems.createdAt))
  );
  const { data: purchasedItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'purchased'))
      .orderBy(desc(shoppingItems.purchasedAt))
  );

  const submitDraft = () => {
    if (addManualItem(db, draft)) setDraft('');
  };

  const purchase = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    purchaseItem(db, id);
  };

  const restore = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    restoreItem(db, id);
  };

  const quantityText = (quantity: number | null, unit: string | null) => {
    const display = displayQuantity(quantity, unit, { scaleFactor: 1, system, locale });
    return display ? `${display.amountText} ${unitLabel(display.unitCode)}`.trim() : '';
  };

  const isEmpty = (activeItems ?? []).length === 0 && (purchasedItems ?? []).length === 0;

  return (
    <View className="flex-1 bg-cream">
      <View className="px-4 pt-3">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          returnKeyType="done"
          blurOnSubmit={false}
          placeholder={t('shop.quickAddPlaceholder')}
          placeholderTextColor="#3A322B66"
          className="min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
        />
      </View>
      {isEmpty ? (
        <EmptyState title={t('shop.emptyTitle')} body={t('shop.emptyBody')} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
          {(activeItems ?? []).map((item) => {
            const sources = parseSources(item.sources);
            const quantity = quantityText(item.quantity, item.unit);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => purchase(item.id)}
                className="active:opacity-80">
                <Card className="min-h-14 flex-row items-center gap-3">
                  {quantity ? (
                    <Text className="font-display text-base text-clay">{quantity}</Text>
                  ) : null}
                  <View className="flex-1">
                    <Text className="font-body-bold text-base text-ink">{item.name}</Text>
                    {sources.length > 0 ? (
                      <Text className="font-body text-xs text-ink opacity-60">
                        {sources.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          })}
          {(purchasedItems ?? []).length > 0 ? (
            <>
              <Text className="mt-4 font-display text-lg text-ink opacity-70">
                {t('shop.recentlyPurchased')}
              </Text>
              {(purchasedItems ?? []).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => restore(item.id)}
                  className="min-h-14 justify-center rounded-card border-2 border-dashed border-linen px-4 active:opacity-80">
                  <Text className="font-body text-base text-ink opacity-60">{item.name}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
```

Delete the orphaned placeholder component:

```bash
git rm components/PlaceholderScreen.tsx
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- shop-screen && npm test -- i18n && npm test -- recipe-detail`
Expected: all PASS (shop-screen 5 tests; i18n key parity still green; recipe detail unaffected by the unitLabel extraction).

- [ ] **Step 7: Lint, typecheck, bundle check, commit**

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
git add -A
git commit -m "feat: add shop tab with quick-add, purchase, and recently purchased shelf"
```

---

### Task 4: Plan tab sticky "Add week" CTA

**Files:**
- Modify: `app/(tabs)/plan.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: rewrite mocks in `__tests__/plan-screen.test.tsx` (screen gains two live queries) and add CTA tests

**Interfaces:**
- Consumes: `aggregateRows`, `itemKey`, `type PlanIngredientRow` from `lib/shopping` (Task 1); `addItems` from `lib/db/shoppingList` (Task 2); `recipeIngredients`, `shoppingItems` from `lib/db/schema`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the screen test**

Rewrite `__tests__/plan-screen.test.tsx`. The screen will call `useLiveQuery` three times per render, in order: plan rows (cards), ingredient rows (CTA aggregation), active shopping keys:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import React from 'react';

import PlanScreen from '../app/(tabs)/plan';
import { addItems } from '../lib/db/shoppingList';
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(() => 0),
}));

const mockUseLiveQuery = useLiveQuery as jest.Mock;
const addItemsMock = addItems as jest.Mock;

let planRows: unknown[] = [];
let ingredientRows: unknown[] = [];
let activeKeyRows: unknown[] = [];

function mockQueries() {
  let call = 0;
  mockUseLiveQuery.mockImplementation(() => {
    const index = call % 3;
    call += 1;
    if (index === 0) return { data: planRows, updatedAt: new Date() };
    if (index === 1) return { data: ingredientRows, updatedAt: new Date() };
    return { data: activeKeyRows, updatedAt: new Date() };
  });
}

const ingredientRow = {
  entryServings: 6,
  recipeServings: 4,
  recipeTitle: 'Tomato Soup',
  name: 'Tomatoes',
  quantity: 400,
  unit: 'g',
  scaling: 'linear',
};

describe('PlanScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    planRows = [];
    ingredientRows = [];
    activeKeyRows = [];
    mockQueries();
  });

  it('renders seven day sections with add slots, today first', () => {
    render(<PlanScreen />);

    expect(screen.getAllByText(/\+ Add dinner/)).toHaveLength(7);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('renders planned meals under their day and opens the entry sheet on tap', () => {
    const today = todayLocal();
    planRows = [{ id: 'e1', date: today, servings: 6, title: 'Tomato Soup' }];

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Tomato Soup'));
    expect(mockPush).toHaveBeenCalledWith('/plan/entry/e1');
  });

  it('routes the add slot to the picker with the day date', () => {
    const today = todayLocal();

    render(<PlanScreen />);

    fireEvent.press(screen.getAllByText(/\+ Add dinner/)[0]);
    expect(mockPush).toHaveBeenCalledWith(`/plan/add?date=${today}`);
  });

  it('hides the CTA when the week contributes no new ingredients', () => {
    render(<PlanScreen />);
    expect(screen.queryByText(/Add week to shopping list/)).toBeNull();
  });

  it('shows the CTA with the aggregated count and writes with skip-existing on tap', () => {
    ingredientRows = [
      ingredientRow,
      { ...ingredientRow, name: 'tomatoes', quantity: 100 },
      { ...ingredientRow, name: 'Basil', quantity: null, unit: null },
    ];

    render(<PlanScreen />);

    fireEvent.press(screen.getByText('Add week to shopping list · 2 ingredients'));
    expect(addItemsMock).toHaveBeenCalledTimes(1);
    const [, items, mode] = addItemsMock.mock.calls[0];
    expect(mode).toBe('skip-existing');
    expect(items).toHaveLength(2);
    expect(items.find((i: { normalizedName: string }) => i.normalizedName === 'tomatoes').quantity).toBe(750); // (400+100) × 6/4
  });

  it('excludes ingredients whose key is already an active shopping item', () => {
    ingredientRows = [ingredientRow];
    activeKeyRows = [{ normalizedName: 'tomatoes', unit: 'g' }];

    render(<PlanScreen />);

    expect(screen.queryByText(/Add week to shopping list/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan-screen`
Expected: the three pre-existing tests PASS (uniform mock still feeds them), the three new CTA tests FAIL — `Unable to find an element with text: Add week to shopping list · 2 ingredients` etc.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, inside `"plan"`, after `"remove"`:

```json
    "remove": "Remove from plan",
    "addWeek": "Add week to shopping list · %{count} ingredients"
```

In `lib/i18n/nb.json`, same position:

```json
    "remove": "Fjern fra planen",
    "addWeek": "Legg uken i handlelisten · %{count} ingredienser"
```

- [ ] **Step 4: Add the CTA to app/(tabs)/plan.tsx**

Replace the entire contents of `app/(tabs)/plan.tsx`:

```tsx
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { addDays, rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipeIngredients, recipes, shoppingItems } from '../../lib/db/schema';
import { addItems } from '../../lib/db/shoppingList';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';
import { aggregateRows, itemKey, type PlanIngredientRow } from '../../lib/shopping';

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

  const { data: ingredientRows } = useLiveQuery(
    db
      .select({
        entryServings: mealPlanEntries.servings,
        recipeServings: recipes.servings,
        recipeTitle: recipes.title,
        name: recipeIngredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        scaling: recipeIngredients.scaling,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, addDays(today, 6)),
          isNull(recipes.deletedAt)
        )
      ),
    [today]
  );

  const { data: activeItems } = useLiveQuery(
    db
      .select({ normalizedName: shoppingItems.normalizedName, unit: shoppingItems.unit })
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'active'))
  );

  const pending = useMemo(() => {
    const activeKeys = new Set((activeItems ?? []).map((item) => itemKey(item)));
    return aggregateRows((ingredientRows ?? []) as PlanIngredientRow[]).filter(
      (item) => !activeKeys.has(itemKey(item))
    );
  }, [ingredientRows, activeItems]);

  const addWeek = () => {
    addItems(db, pending, 'skip-existing');
  };

  const byDate = new Map<string, PlanItem[]>();
  for (const row of rows ?? []) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return (
    <View className="flex-1 bg-cream">
      <ScrollView className="flex-1" contentContainerClassName="gap-6 p-4">
        {week.map((date) => (
          <View key={date} className="gap-2">
            {date === today ? (
              <View className="self-start rounded-full bg-clay px-3 py-1">
                <Text className="font-body-bold text-sm text-cream">
                  {dayHeading(date, today)}
                </Text>
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
      {pending.length > 0 ? (
        <View className="px-4 pb-4 pt-2">
          <Pressable
            accessibilityRole="button"
            onPress={addWeek}
            className="min-h-14 items-center justify-center rounded-card bg-sage px-6 py-4 active:opacity-80">
            <Text className="font-body-bold text-lg text-cream">
              {t('plan.addWeek', { count: pending.length })}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
```

Note the two structural changes to the existing screen: the `ScrollView` is now wrapped in a `flex-1` `View` so the CTA can sit below it, and everything else is unchanged. The CTA disappearing after the tap (live queries make `pending` collapse to 0) is the confirmation state — no extra UI.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- plan-screen && npm test -- i18n`
Expected: PASS — 6 plan-screen tests, i18n parity green.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
git add 'app/(tabs)/plan.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/plan-screen.test.tsx
git commit -m "feat: add week-to-shopping-list CTA on plan tab"
```

---

### Task 5: Recipe detail — add ingredients with per-row exclusion

**Files:**
- Modify: `app/recipe/[id]/index.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: extend `__tests__/recipe-detail.test.tsx`

**Interfaces:**
- Consumes: `aggregateRows` from `lib/shopping` (Task 1); `addItems` from `lib/db/shoppingList` (Task 2); the screen's existing `selectedServings` / `recipe.servings` state.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append this describe block to `__tests__/recipe-detail.test.tsx`, and add these two lines with the other imports/mocks at the top of the file (the file's existing `mockQueries(recipeResult, ingredients)` helper and `recipeRow`/`flourRow`/`chiliRow` fixtures are reused as-is):

```tsx
import { addItems } from '../lib/db/shoppingList';

jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(() => 1),
}));
```

And below the existing describe block:

```tsx
const addItemsMock = addItems as jest.Mock;

describe('RecipeDetailScreen — add to shopping list', () => {
  beforeEach(() => {
    addItemsMock.mockClear();
  });

  it('adds all ingredients scaled to the selected servings in merge mode', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByLabelText('increment')); // servings 4 → 5
    fireEvent.press(screen.getByText('Add 2 ingredients to shopping list'));

    expect(addItemsMock).toHaveBeenCalledTimes(1);
    const [, items, mode] = addItemsMock.mock.calls[0];
    expect(mode).toBe('merge');
    expect(items).toHaveLength(2);
    expect(items.find((i: { normalizedName: string }) => i.normalizedName === 'flour')).toMatchObject({
      quantity: 250, // 200 g × 5/4
      unit: 'g',
      sources: ['Tomato Soup'],
    });
    expect(items.find((i: { normalizedName: string }) => i.normalizedName === 'chili flakes')).toMatchObject({
      quantity: 5, // fixed: 1 ts → 5 ml, unscaled
      unit: 'ml',
    });
    expect(screen.getByText('Added to your shopping list')).toBeOnTheScreen();
  });

  it('excludes tapped ingredient rows and updates the button count', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Flour'));
    fireEvent.press(screen.getByText('Add 1 ingredients to shopping list'));

    const [, items] = addItemsMock.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0].normalizedName).toBe('chili flakes');
  });

  it('re-including a row restores it', () => {
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Flour'));
    fireEvent.press(screen.getByText('Flour'));
    expect(screen.getByText('Add 2 ingredients to shopping list')).toBeOnTheScreen();
  });

  it('shows the save-error notice when the write throws', () => {
    addItemsMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    mockQueries({ data: [recipeRow], updatedAt: new Date() }, [flourRow, chiliRow]);
    render(<RecipeDetailScreen />);

    fireEvent.press(screen.getByText('Add 2 ingredients to shopping list'));
    expect(screen.getByText("Couldn't save — try again.")).toBeOnTheScreen();
  });
});
```

Note: the Stepper's increment control carries `accessibilityLabel="increment"` (see `components/ui/Stepper.tsx`), which is what `getByLabelText('increment')` targets.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- recipe-detail`
Expected: existing tests PASS; the 4 new tests FAIL — `Unable to find an element with text: Add 2 ingredients to shopping list`.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, inside `"detail"`, after `"planIt"`:

```json
    "planIt": "Plan it",
    "addToList": "Add %{count} ingredients to shopping list",
    "addedToList": "Added to your shopping list"
```

In `lib/i18n/nb.json`, same position:

```json
    "planIt": "Planlegg",
    "addToList": "Legg %{count} ingredienser i handlelisten",
    "addedToList": "Lagt i handlelisten"
```

- [ ] **Step 4: Add exclusions and the add button to the detail screen**

In `app/recipe/[id]/index.tsx`:

Add imports:

```tsx
import { Button } from '../../../components/ui/Button'; // already imported — no change
import { addItems } from '../../../lib/db/shoppingList';
import { aggregateRows } from '../../../lib/shopping';
```

Add state next to the existing `useState` calls:

```tsx
const [excluded, setExcluded] = useState<Set<string>>(new Set());
const [listNotice, setListNotice] = useState<'none' | 'added' | 'failed'>('none');
```

Add handlers after `changeSystem` (note: the servings stepper's `onChange` also clears the notice — replace `onChange={setServingsOverride}` with `onChange={changeServings}`):

```tsx
const changeServings = (value: number) => {
  setServingsOverride(value);
  setListNotice('none');
};

const toggleExcluded = (ingredientId: string) => {
  setListNotice('none');
  setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(ingredientId)) next.delete(ingredientId);
    else next.add(ingredientId);
    return next;
  });
};

const included = (ingredients ?? []).filter((ing) => !excluded.has(ing.id));

const addToList = () => {
  try {
    const items = aggregateRows(
      included.map((ing) => ({
        entryServings: selectedServings,
        recipeServings: recipe.servings,
        recipeTitle: recipe.title,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        scaling: ing.scaling,
      }))
    );
    addItems(db, items, 'merge');
    setListNotice('added');
  } catch {
    setListNotice('failed');
  }
};
```

Wrap each ingredient row in a Pressable that toggles exclusion and dims excluded rows — replace the ingredient row `<View key={ing.id} …>` block (currently lines 149–163) with:

```tsx
<Pressable
  key={ing.id}
  accessibilityRole="button"
  onPress={() => toggleExcluded(ing.id)}
  className={excluded.has(ing.id) ? 'opacity-40' : ''}>
  <View className="flex-row items-baseline gap-3">
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
</Pressable>
```

Directly after the closing tag of the ingredients `<View className="mt-3 gap-3">…</View>` block (still inside the ingredients fragment, before `</>`), add the notice and the button:

```tsx
{listNotice === 'failed' ? (
  <View className="mt-3 rounded-card bg-butter px-4 py-3">
    <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
  </View>
) : null}
{listNotice === 'added' ? (
  <View className="mt-3 rounded-card bg-sage px-4 py-3">
    <Text className="font-body text-sm text-cream">{t('detail.addedToList')}</Text>
  </View>
) : null}
{included.length > 0 ? (
  <View className="mt-3">
    <Button
      label={t('detail.addToList', { count: included.length })}
      variant="ghost"
      onPress={addToList}
    />
  </View>
) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- recipe-detail && npm test -- i18n`
Expected: PASS — all existing + 4 new tests; i18n parity green.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
git add 'app/recipe/[id]/index.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/recipe-detail.test.tsx
git commit -m "feat: add ingredients-to-list with exclusions on recipe detail"
```

---

### Task 6: Final verification and manual checklist

**Files:**
- Modify: root `docs/TESTING.md` (append the manual checklist)

**Interfaces:**
- Consumes: everything.
- Produces: a verified slice and the manual checklist recorded where the tester will look.

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

## Shopping list (manual pass)

- Plan a few dinners, open Plan tab → sage CTA shows "Add week to shopping list · N ingredients"; tap → items land on the Shop tab, CTA disappears; tapping into Plan again shows no CTA (nothing new to add).
- Two recipes sharing an ingredient (e.g. kjøttdeig in Tacos + Kjøttkaker) produce ONE list item with the summed quantity and both recipe names as subtitle.
- An ingredient in grams in one recipe and stk in another produces two separate rows.
- Shop tab: tap an item card → it moves to the "Recently purchased" shelf; tap it on the shelf → it comes back with the quantity intact.
- Quick-add: type an item, return → appears in the list; typing the same name again merges instead of duplicating; input stays if blank.
- Recipe detail: bump servings, tap two ingredient rows to exclude (they dim), tap "Add N ingredients…" → sage notice, items on the Shop tab reflect the scaled quantities; excluded rows absent.
- Adding the same recipe's ingredients twice doubles quantities on the list (merge mode), while re-tapping the Plan CTA never duplicates.
- US units toggle on recipe detail: shopping list still shows sensible amounts (base metric stored, US displayed when toggled).
- Norwegian device language: all shop/plan/detail strings localized.
- Kill and relaunch — list and shelf persist.
```

- [ ] **Step 3: Commit**

```bash
git add ../docs/TESTING.md
git commit -m "docs: add shopping list manual test checklist"
```

---

## Self-Review Notes

- **Spec coverage:** pure aggregation with all merge rules (T1), table/migration/index + repository with both write modes and status flips (T2), Shop tab with quick-add/purchase/shelf/empty state + unitLabel extraction + placeholder deletion (T3), Plan CTA with live count and skip-existing semantics (T4), detail exclusions + scaled merge add + notices (T5), verification + TESTING.md checklist (T6). Spec's "no toast" and "no checkboxes" hold: nothing in any task renders either.
- **Known judgment calls:** `getUnitSystem(db)` is read per-render on the Shop tab (cheap synchronous select, mirrors detail's mount-read; live system changes from the detail toggle appear next time Shop re-renders). Plan CTA failure throws (dev RedBox) — the plan screen has no notice pattern and the spec's error-handling section allows it. `LayoutAnimation.configureNext` is a no-op under Jest and needs no Android flag on Expo SDK 54's new architecture. T5's stepper tap targets the Stepper's `accessibilityLabel="increment"` (verified in `components/ui/Stepper.tsx`).
- **Type consistency check:** `AggregatedItem`/`PlanIngredientRow`/`itemKey`/`sumQuantities` (T1) match every use in T2's repository and T4/T5's screens; `addItems(db, items, mode)` argument order is identical at all three call sites and in all test assertions; the T4 ingredient live-query column aliases (`entryServings`, `recipeServings`, `recipeTitle`, `name`, `quantity`, `unit`, `scaling`) exactly match `PlanIngredientRow`; `shoppingItems` column names match the repository and both screen queries; all `jest.mock` factories reference only `mock`-prefixed or factory-local values.
