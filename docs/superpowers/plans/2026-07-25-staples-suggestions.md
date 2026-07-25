# Staples Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A quiet "Do you need…?" section on the Shop tab suggesting due staples derived from purchase history — one tap adds, × dismisses until the item is next bought.

**Architecture:** A pure heuristic (`computeStaples`) over purchased rows; device-local dismissals in the settings table; a props-driven section component (NO live queries of its own — `shop.tsx` already holds both datasets, and reusing them keeps the existing shop test's `useLiveQuery` call-count mock intact). The section returns `null` before touching the database when there are no candidates.

**Tech Stack:** existing frontend stack. No new dependencies, no schema changes, no backend contact.

**Spec:** `docs/superpowers/specs/2026-07-25-staples-suggestions-design.md`

## Global Constraints

- Heuristic constants (spec decision 1): staple = ≥ 3 purchases of one `normalizedName`; typical interval = MEDIAN gap between consecutive purchases; groups with median gap < 1 day (same-trip noise) or > 60 days ignored; due when `now - lastPurchasedAt ≥ 0.8 × typicalInterval`; rank by overdueness ratio descending; cap 5; display name = most recent purchase's `name`.
- Exclusions: active-list items (by `normalizedName`) and unexpired dismissals (dismissed-at ≥ last purchase). Dismissals: settings key `staple_dismissals`, JSON map `{normalizedName: epochMs}`, device-local (never-sync comment), pruned of expired entries on write, malformed JSON → empty map.
- The section renders NOTHING (null) when no suggestions — no header, no empty state. Adds go through `addItems(db, [...], 'merge')` (aggregation + dirty stamp + scheduleSync for free).
- All user-facing strings in BOTH `lib/i18n/nb.json` and `lib/i18n/en.json` (`suggestions.*`; parity test enforces; interpolation via `%{name}`).
- Existing tests pass UNTOUCHED (the shop-screen test's modulo-2 `useLiveQuery` mock must keep working — hence props, no new queries). Mock-prefix rule; RNTL v13.
- Green bar per task: `npx jest`, `npx eslint . --max-warnings 0`, `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`. Baseline: 351 tests.

## File Structure

- Create: `lib/suggestions/staples.ts`, `lib/suggestions/dismissals.ts`, `components/shop/StaplesSection.tsx`
- Modify: `app/(tabs)/shop.tsx`, `lib/i18n/{nb,en}.json`, root `docs/TESTING.md`
- Tests: `__tests__/staples-heuristic.test.ts`, `__tests__/staples-dismissals.test.ts`, `__tests__/staples-section.test.tsx`

---

### Task 1: The staples heuristic

**Files:**
- Create: `lib/suggestions/staples.ts`
- Test: `__tests__/staples-heuristic.test.ts`

**Interfaces:**
- Produces (used by Tasks 2–3): `PurchaseRow = { normalizedName: string; name: string; purchasedAt: number }`, `StapleSuggestion = { normalizedName: string; name: string; lastPurchasedAt: number; overdueness: number }`, `computeStaples(rows: PurchaseRow[], now: number): StapleSuggestion[]`.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/staples-suggestions
cd frontend
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/staples-heuristic.test.ts`:

```ts
import { computeStaples, type PurchaseRow } from '../lib/suggestions/staples';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_753_000_000_000;

// Purchases of one item at the given day-offsets before NOW.
function purchases(name: string, daysAgo: number[], normalizedName = name.toLowerCase()): PurchaseRow[] {
  return daysAgo.map((days) => ({ normalizedName, name, purchasedAt: NOW - days * DAY }));
}

describe('computeStaples', () => {
  it('suggests a weekly staple that is due', () => {
    // Bought every 7 days, last one 6 days ago: 6 >= 0.8 * 7 = 5.6 → due.
    const rows = purchases('Melk', [20, 13, 6]);

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ normalizedName: 'melk', name: 'Melk' });
    expect(result[0].lastPurchasedAt).toBe(NOW - 6 * DAY);
  });

  it('does not suggest before 80% of the typical interval has passed', () => {
    // Weekly cadence, last purchase 5 days ago: 5 < 5.6 → not due.
    const rows = purchases('Melk', [19, 12, 5]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('requires at least three purchases', () => {
    const rows = purchases('Melk', [14, 7]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('uses the median gap so one vacation does not skew the cadence', () => {
    // Gaps: 7, 7, 28, 7 days → median 7. Last purchase 6 days ago → due.
    const rows = purchases('Melk', [55, 48, 41, 13, 6]);

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(1);
    expect(result[0].normalizedName).toBe('melk');
  });

  it('ignores same-trip noise (median gap under a day)', () => {
    // Three purchases within hours of each other: one shopping event, not a cadence.
    const rows: PurchaseRow[] = [
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY + 1000 },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 30 * DAY + 2000 },
    ];

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('ignores habits slower than 60 days', () => {
    const rows = purchases('Julekrydder', [400, 200, 130]);

    expect(computeStaples(rows, NOW)).toHaveLength(0);
  });

  it('ranks by overdueness and caps at five', () => {
    const rows = [
      ...purchases('A', [21, 14, 7]), // weekly, 7/7 = 1.0 overdue
      ...purchases('B', [34, 24, 14]), // ten-daily, 14/10 = 1.4
      ...purchases('C', [26, 20, 14, 8]), // six-daily, 8/6 ≈ 1.33
      ...purchases('D', [15, 10, 5]), // five-daily, 5/5 = 1.0
      ...purchases('E', [12, 8, 4]), // four-daily, 4/4 = 1.0
      ...purchases('F', [9, 6, 3]), // three-daily, 3/3 = 1.0
    ];

    const result = computeStaples(rows, NOW);

    expect(result).toHaveLength(5);
    expect(result[0].normalizedName).toBe('b');
    expect(result[1].normalizedName).toBe('c');
    expect(result.map((s) => s.normalizedName)).not.toContain('a' === result[5 - 5] ? '' : '');
  });

  it('uses the freshest name casing for display', () => {
    const rows: PurchaseRow[] = [
      { normalizedName: 'melk', name: 'melk', purchasedAt: NOW - 20 * DAY },
      { normalizedName: 'melk', name: 'melk', purchasedAt: NOW - 13 * DAY },
      { normalizedName: 'melk', name: 'Melk', purchasedAt: NOW - 6 * DAY },
    ];

    expect(computeStaples(rows, NOW)[0].name).toBe('Melk');
  });
});
```

Note on the ranking test's last assertion: replace the placeholder-ish `not.toContain` line with the direct assertion — exactly one of the six habits must be missing; the five equal-overdueness ones tie and one of A/D/E/F is dropped. Assert instead:

```ts
    expect(result.map((s) => s.normalizedName)).toEqual(
      expect.arrayContaining(['b', 'c'])
    );
```

(keeping `toHaveLength(5)` as the cap proof).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/staples-heuristic.test.ts`
Expected: FAIL — cannot find module `../lib/suggestions/staples`.

- [ ] **Step 3: Implement**

Create `lib/suggestions/staples.ts`:

```ts
// The staples heuristic: pure, language-neutral (groups by normalizedName,
// never parses text). A staple is an item bought at least three times at a
// habitual cadence; it is suggested when that cadence says it is due.
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PURCHASES = 3;
const MIN_TYPICAL_INTERVAL_MS = DAY_MS; // three buys in one trip is noise
const MAX_TYPICAL_INTERVAL_MS = 60 * DAY_MS; // slower than this predicts nothing
const DUE_RATIO = 0.8;
const MAX_SUGGESTIONS = 5;

export type PurchaseRow = {
  normalizedName: string;
  name: string;
  purchasedAt: number;
};

export type StapleSuggestion = {
  normalizedName: string;
  name: string;
  lastPurchasedAt: number;
  overdueness: number;
};

function median(sortedAscending: number[]): number {
  const mid = Math.floor(sortedAscending.length / 2);
  return sortedAscending.length % 2 === 1
    ? sortedAscending[mid]
    : (sortedAscending[mid - 1] + sortedAscending[mid]) / 2;
}

export function computeStaples(rows: PurchaseRow[], now: number): StapleSuggestion[] {
  const groups = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const group = groups.get(row.normalizedName);
    if (group) {
      group.push(row);
    } else {
      groups.set(row.normalizedName, [row]);
    }
  }

  const suggestions: StapleSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < MIN_PURCHASES) continue;
    const times = group.map((row) => row.purchasedAt).sort((a, b) => a - b);
    const gaps = times
      .slice(1)
      .map((time, index) => time - times[index])
      .sort((a, b) => a - b);
    const typicalInterval = median(gaps);
    if (typicalInterval < MIN_TYPICAL_INTERVAL_MS) continue;
    if (typicalInterval > MAX_TYPICAL_INTERVAL_MS) continue;
    const lastPurchasedAt = times[times.length - 1];
    const elapsed = now - lastPurchasedAt;
    if (elapsed < DUE_RATIO * typicalInterval) continue;
    const freshest = group.reduce((a, b) => (a.purchasedAt >= b.purchasedAt ? a : b));
    suggestions.push({
      normalizedName: freshest.normalizedName,
      name: freshest.name,
      lastPurchasedAt,
      overdueness: elapsed / typicalInterval,
    });
  }

  return suggestions
    .sort((a, b) => b.overdueness - a.overdueness)
    .slice(0, MAX_SUGGESTIONS);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/staples-heuristic.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 8/8; full suite green (351 + 8 = 359).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add staples heuristic"
```

---

### Task 2: Dismissal persistence

**Files:**
- Create: `lib/suggestions/dismissals.ts`
- Test: `__tests__/staples-dismissals.test.ts`

**Interfaces:**
- Consumes: the settings table idiom (`lib/db/settings.ts` shows it).
- Produces (used by Task 3): `getStapleDismissals(db: DB): Record<string, number>`, `dismissStaple(db: DB, normalizedName: string, latestPurchases: Record<string, number>): void`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/staples-dismissals.test.ts`:

```ts
import { eq } from 'drizzle-orm';

import { settings } from '../lib/db/schema';
import { dismissStaple, getStapleDismissals } from '../lib/suggestions/dismissals';
import { makeTestDb } from './helpers/testDb';

describe('staple dismissals', () => {
  it('starts empty and round-trips a dismissal', () => {
    const db = makeTestDb();
    expect(getStapleDismissals(db)).toEqual({});

    dismissStaple(db, 'melk', {});

    const stored = getStapleDismissals(db);
    expect(Object.keys(stored)).toEqual(['melk']);
    expect(stored.melk).toBeGreaterThan(0);
  });

  it('prunes entries whose item was purchased after the dismissal', () => {
    const db = makeTestDb();
    dismissStaple(db, 'melk', {});
    const dismissedAt = getStapleDismissals(db).melk;

    // Milk was bought again after the dismissal; dismissing bread prunes it.
    dismissStaple(db, 'brød', { melk: dismissedAt + 1000 });

    const stored = getStapleDismissals(db);
    expect(stored.melk).toBeUndefined();
    expect(stored['brød']).toBeGreaterThan(0);
  });

  it('keeps entries not purchased since dismissal', () => {
    const db = makeTestDb();
    dismissStaple(db, 'melk', {});
    const dismissedAt = getStapleDismissals(db).melk;

    dismissStaple(db, 'brød', { melk: dismissedAt - 1000 });

    expect(getStapleDismissals(db).melk).toBe(dismissedAt);
  });

  it('treats malformed stored JSON as empty', () => {
    const db = makeTestDb();
    db.insert(settings).values({ key: 'staple_dismissals', value: 'not json' }).run();

    expect(getStapleDismissals(db)).toEqual({});

    // And a write recovers the key.
    dismissStaple(db, 'melk', {});
    expect(Object.keys(getStapleDismissals(db))).toEqual(['melk']);
    const row = db.select().from(settings).where(eq(settings.key, 'staple_dismissals')).get();
    expect(() => JSON.parse(row!.value)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/staples-dismissals.test.ts`
Expected: FAIL — cannot find module `../lib/suggestions/dismissals`.

- [ ] **Step 3: Implement**

Create `lib/suggestions/dismissals.ts`:

```ts
import { eq } from 'drizzle-orm';

import { settings } from '../db/schema';
import type { DB } from '../db/types';

// Device-local preference — must be excluded if settings ever sync. A
// dismissal means "stop suggesting this"; it expires the next time the
// item is actually purchased (the section filters on that, and writes
// prune expired entries so the map stays small).
const DISMISSALS_KEY = 'staple_dismissals';

export function getStapleDismissals(db: DB): Record<string, number> {
  const row = db.select().from(settings).where(eq(settings.key, DISMISSALS_KEY)).get();
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

export function dismissStaple(
  db: DB,
  normalizedName: string,
  latestPurchases: Record<string, number>
): void {
  const current = getStapleDismissals(db);
  const pruned: Record<string, number> = {};
  for (const [key, dismissedAt] of Object.entries(current)) {
    const lastPurchase = latestPurchases[key];
    if (lastPurchase === undefined || lastPurchase <= dismissedAt) {
      pruned[key] = dismissedAt;
    }
  }
  pruned[normalizedName] = Date.now();
  const value = JSON.stringify(pruned);
  db.insert(settings)
    .values({ key: DISMISSALS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/staples-dismissals.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: new file 4/4; full suite green (359 + 4 = 363).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: add staple dismissal persistence"
```

---

### Task 3: The section, mount, i18n, docs

**Files:**
- Create: `components/shop/StaplesSection.tsx`
- Modify: `app/(tabs)/shop.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`, root `docs/TESTING.md`
- Test: `__tests__/staples-section.test.tsx`

**Interfaces:**
- Consumes: Task 1 `computeStaples`/types; Task 2 dismissal accessors; `addItems` from `lib/db/shoppingList`.
- Produces: `StaplesSection({ active, purchased, now })` — props-driven, no own queries.

- [ ] **Step 1: i18n keys**

Add to `lib/i18n/en.json` (top-level `"suggestions"`):

```json
  "suggestions": {
    "staplesTitle": "Do you need…?",
    "add": "Add %{name}",
    "dismiss": "Dismiss %{name}"
  }
```

and to `lib/i18n/nb.json`:

```json
  "suggestions": {
    "staplesTitle": "Trenger dere…?",
    "add": "Legg til %{name}",
    "dismiss": "Avvis %{name}"
  }
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/staples-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { StaplesSection } from '../components/shop/StaplesSection';
import { addItems } from '../lib/db/shoppingList';
import { dismissStaple, getStapleDismissals } from '../lib/suggestions/dismissals';

jest.mock('../lib/db/client', () => ({ db: {} }));
jest.mock('../lib/db/shoppingList', () => ({
  addItems: jest.fn(),
}));
jest.mock('../lib/suggestions/dismissals', () => ({
  getStapleDismissals: jest.fn(() => ({})),
  dismissStaple: jest.fn(),
}));

const addItemsMock = addItems as jest.Mock;
const getDismissalsMock = getStapleDismissals as jest.Mock;
const dismissStapleMock = dismissStaple as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_753_000_000_000;

// A weekly milk habit, due (last bought 6 days ago).
const duePurchases = [20, 13, 6].map((days) => ({
  normalizedName: 'melk',
  name: 'Melk',
  purchasedAt: NOW - days * DAY,
}));

beforeEach(() => {
  jest.clearAllMocks();
  getDismissalsMock.mockReturnValue({});
});

describe('StaplesSection', () => {
  it('renders nothing without due staples', () => {
    const { toJSON } = render(<StaplesSection active={[]} purchased={[]} now={NOW} />);
    expect(toJSON()).toBeNull();
    expect(getDismissalsMock).not.toHaveBeenCalled();
  });

  it('shows a due staple and adds it through addItems', () => {
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);

    expect(screen.getByText('Do you need…?')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Add Melk'));

    expect(addItemsMock).toHaveBeenCalledWith(
      expect.anything(),
      [{ name: 'Melk', normalizedName: 'melk', quantity: null, unit: null, sources: [] }],
      'merge'
    );
  });

  it('excludes staples already on the active list', () => {
    const { toJSON } = render(
      <StaplesSection
        active={[{ normalizedName: 'melk' }]}
        purchased={duePurchases}
        now={NOW}
      />
    );
    expect(toJSON()).toBeNull();
  });

  it('hides dismissed staples until repurchased', () => {
    // Dismissed AFTER the last purchase → suppressed.
    getDismissalsMock.mockReturnValue({ melk: NOW - 5 * DAY });
    const { toJSON } = render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);
    expect(toJSON()).toBeNull();
  });

  it('shows again once purchased after the dismissal', () => {
    // Dismissed BEFORE the last purchase (6 days ago) → habit re-opened.
    getDismissalsMock.mockReturnValue({ melk: NOW - 10 * DAY });
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);
    expect(screen.getByText('Melk')).toBeOnTheScreen();
  });

  it('dismisses with the latest-purchase map and hides the chip', () => {
    render(<StaplesSection active={[]} purchased={duePurchases} now={NOW} />);

    getDismissalsMock.mockReturnValue({ melk: NOW });
    fireEvent.press(screen.getByLabelText('Dismiss Melk'));

    expect(dismissStapleMock).toHaveBeenCalledWith(
      expect.anything(),
      'melk',
      expect.objectContaining({ melk: NOW - 6 * DAY })
    );
    expect(screen.queryByText('Melk')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/staples-section.test.tsx`
Expected: FAIL — cannot find module `../components/shop/StaplesSection`.

- [ ] **Step 4: Implement the section**

Create `components/shop/StaplesSection.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../../lib/db/client';
import { addItems } from '../../lib/db/shoppingList';
import { t } from '../../lib/i18n';
import { dismissStaple, getStapleDismissals } from '../../lib/suggestions/dismissals';
import { computeStaples, type StapleSuggestion } from '../../lib/suggestions/staples';

type StaplesSectionProps = {
  active: { normalizedName: string }[];
  purchased: { normalizedName: string; name: string; purchasedAt: number | null }[];
  now: number;
};

// Quiet by design: renders nothing at all when no staple is due, and never
// reads the database until there is a candidate to filter.
export function StaplesSection({ active, purchased, now }: StaplesSectionProps) {
  const [dismissalsVersion, setDismissalsVersion] = useState(0);

  const rows = purchased.filter(
    (item): item is { normalizedName: string; name: string; purchasedAt: number } =>
      item.purchasedAt !== null
  );
  const activeNames = new Set(active.map((item) => item.normalizedName));
  const candidates = computeStaples(rows, now).filter(
    (staple) => !activeNames.has(staple.normalizedName)
  );

  // Hook-order safety: useMemo runs every render; it only touches the
  // settings table when candidates exist.
  const dismissals = useMemo(
    () => (candidates.length > 0 ? getStapleDismissals(db) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dismissalsVersion, candidates.length]
  );

  if (candidates.length === 0) return null;

  const suggestions = candidates.filter((staple) => {
    const dismissedAt = dismissals[staple.normalizedName];
    return dismissedAt === undefined || staple.lastPurchasedAt > dismissedAt;
  });
  if (suggestions.length === 0) return null;

  const latestPurchases: Record<string, number> = {};
  for (const row of rows) {
    const existing = latestPurchases[row.normalizedName];
    if (existing === undefined || row.purchasedAt > existing) {
      latestPurchases[row.normalizedName] = row.purchasedAt;
    }
  }

  const add = (staple: StapleSuggestion) => {
    addItems(
      db,
      [
        {
          name: staple.name,
          normalizedName: staple.normalizedName,
          quantity: null,
          unit: null,
          sources: [],
        },
      ],
      'merge'
    );
  };

  const dismiss = (staple: StapleSuggestion) => {
    dismissStaple(db, staple.normalizedName, latestPurchases);
    setDismissalsVersion((version) => version + 1);
  };

  return (
    <View testID="staples-section">
      <Text className="mt-4 font-display text-lg text-ink opacity-70">
        {t('suggestions.staplesTitle')}
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {suggestions.map((staple) => (
          <View
            key={staple.normalizedName}
            className="flex-row items-center rounded-card border-2 border-dashed border-linen">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('suggestions.add', { name: staple.name })}
              onPress={() => add(staple)}
              className="min-h-14 justify-center py-2 pl-4 pr-2 active:opacity-80">
              <Text className="font-body text-base text-ink opacity-70">{staple.name}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('suggestions.dismiss', { name: staple.name })}
              onPress={() => dismiss(staple)}
              className="min-h-14 justify-center py-2 pl-1 pr-3 active:opacity-80">
              <Text className="font-body text-base text-ink opacity-40">×</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
```

Note on the eslint-disable: `candidates.length` intentionally under-specifies the memo (candidates identity changes every render); the memo exists to re-read dismissals only on version bumps or when candidates appear. If lint objects differently in practice, restructure to a plain function call guarded by `candidates.length > 0` with `dismissalsVersion` read for reactivity — behavior over form; disclose what shipped.

- [ ] **Step 5: Mount in shop.tsx**

In `app/(tabs)/shop.tsx`: import `import { StaplesSection } from '../../components/shop/StaplesSection';` and insert inside the `ScrollView`, after the active-items `map` block and before the `hasShelf` block:

```tsx
          <StaplesSection
            active={activeItems ?? []}
            purchased={purchasedItems ?? []}
            now={now}
          />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest __tests__/staples-section.test.tsx __tests__/shop-screen.test.tsx` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: section 6/6; the EXISTING shop-screen tests pass UNTOUCHED — the section takes props (no new `useLiveQuery` calls, so the modulo-2 mock holds) and its fixtures cannot form staples (verify: no fixture has 3+ purchases of one normalizedName; if one somehow does, the section would try `getStapleDismissals` against the chain-stub db — in that case add ONLY a minimal `jest.mock('../lib/suggestions/dismissals', ...)` to the shop test, disclosed). Full suite green (363 + 6 = 369). Export bundles.

- [ ] **Step 7: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Staples suggestions (manual pass)

Needs purchase history: buy the same item 3+ times with day-plus gaps. For quick testing, back-date `purchased_at` on three rows of one item via a SQLite browser (epoch ms), e.g. 20, 13 and 6 days ago for a weekly habit.

- With a due staple: the Shop tab shows "Do you need…?" with the item as a dashed chip under the active list.
- Tap the chip → it joins the active list (and syncs to the other device); the suggestion disappears (it's now on the list).
- Tap × → the chip disappears and stays gone across app restarts.
- Buy the item again (add + purchase) → after the next due window, the suggestion returns (dismissal expired).
- With no qualifying history, the section is completely absent — no header, no empty box.
- Language switch (Settings): title and accessibility labels follow nb/en.
```

- [ ] **Step 8: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: add staples suggestions section on the shop tab"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (heuristic + constants → T1, each constant has a dedicated test), 2 (active-list + dismissal exclusions → T3 section logic/tests), 3 (dismissal storage/expiry/prune/malformed → T2), 4 (surface, chips, add-through-addItems, render-null → T3), 5 (reactivity via props from shop.tsx's existing live queries + dismissalsVersion bump → T3), 6 (i18n keys nb+en → T3), 7 (test matrix → all tasks; existing shop tests untouched by construction — props, no new queries).
- **Judgment calls:** the section receives data as props rather than querying — this is what keeps the existing shop-screen test's call-counting `useLiveQuery` mock valid and makes the section trivially testable. Dismissal reads are guarded behind `candidates.length > 0` so the chain-stub db in existing tests is never touched. `now` comes from shop.tsx's existing focus-refreshed state (suggestions recompute on tab focus — good enough freshness). The dismiss test flips the mock's return before pressing to simulate persistence; the assertion on `latestPurchases` proves the prune contract is fed real data.
- **Type consistency check:** `PurchaseRow`/`StapleSuggestion` fields match between T1 definition, T3 usage, and tests; `dismissStaple(db, normalizedName, latestPurchases)` arity matches T2/T3; `addItems(db, items, 'merge')` matches the real signature (AggregatedItem fields: name/normalizedName/quantity/unit/sources); i18n keys match between JSON and `t()` calls (`%{name}` interpolation per i18n-js).
- **Placeholder scan:** the T1 ranking test's odd `not.toContain` line is explicitly replaced by the follow-up note with the real assertion — implementer instruction is unambiguous.
