# Recently Purchased Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Shop tab's flat purchased list into the designed staples library: time-grouped (this trip · earlier this week · earlier), one card per item, undo for recent purchases and copy-back quick re-add for older ones.

**Architecture:** A pure grouping module (`lib/shelf.ts`) dedupes purchased rows by `itemKey` (newest wins), hides keys with an active row, and buckets by fixed windows with the clock injected. The repository gains `readdItem` (copy a purchased row into a fresh active item via `addItems` merge). The Shop tab renders the three groups and dispatches taps to `restoreItem` (trip) or `readdItem` (older). No schema change.

**Tech Stack:** Expo SDK 54, drizzle-orm + expo-sqlite (better-sqlite3 in tests), NativeWind, Jest + `@testing-library/react-native` v13.

**Spec:** `docs/superpowers/specs/2026-07-16-recently-purchased-design.md`

## Global Constraints

- No schema change; purchase history rows are never deleted or modified by re-add.
- Windows: "This trip" = age strictly less than 6 hours; "Earlier this week" = age strictly less than 7 days; boundary ages (exactly 6h / 7d) fall to the older side.
- Shelf display: deduped by `itemKey` (max `purchasedAt` per key); keys present in the active set never render; within each group sort by `purchasedAt` desc; empty groups don't render.
- Tap: trip group → `restoreItem` (move, unchanged behavior); week/older groups → `readdItem` (copy: `name`/`normalizedName`/`quantity`/`unit` intact, `sources` emptied, written via `addItems(..., 'merge')`, source row untouched).
- New strings in BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` (key-parity test enforces it).
- Test constraints: `@testing-library/react-native` v13 sync `render(...)`; out-of-scope vars referenced inside `jest.mock` factories must be `mock`-prefixed.
- Run all commands from `frontend/`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Create: `lib/shelf.ts` (pure grouping; imports only `lib/shopping.ts`).
- Modify: `lib/db/shoppingList.ts` (+`readdItem`), `app/(tabs)/shop.tsx` (shelf section), `lib/i18n/en.json`, `lib/i18n/nb.json`.
- Tests: `__tests__/shelf.test.ts` (new); extend `__tests__/shopping-list-repository.test.ts`, `__tests__/shop-screen.test.tsx`.

---

### Task 1: Pure shelf grouping module

**Files:**
- Create: `lib/shelf.ts`
- Test: `__tests__/shelf.test.ts`

**Interfaces:**
- Consumes: `itemKey` from `lib/shopping.ts`.
- Produces (used by Task 3): `THIS_TRIP_MS`, `WEEK_MS` constants; `type ShelfRow { id: string; name: string; normalizedName: string; quantity: number | null; unit: string | null; purchasedAt: number | null }`; `groupShelfItems<T extends ShelfRow>(purchasedRows: T[], activeKeys: Set<string>, now: number): { trip: T[]; week: T[]; older: T[] }`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/recently-purchased
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/shelf.test.ts`:

```ts
import { groupShelfItems, THIS_TRIP_MS, WEEK_MS, type ShelfRow } from '../lib/shelf';
import { itemKey } from '../lib/shopping';

const NOW = 1_800_000_000_000;

let nextId = 0;
const row = (overrides: Partial<ShelfRow> = {}): ShelfRow => ({
  id: `p${++nextId}`,
  name: 'Melk',
  normalizedName: 'melk',
  quantity: 1000,
  unit: 'ml',
  purchasedAt: NOW - 1000,
  ...overrides,
});

describe('groupShelfItems', () => {
  it('buckets by fixed windows with boundaries falling to the older side', () => {
    const groups = groupShelfItems(
      [
        row({ name: 'A', normalizedName: 'a', purchasedAt: NOW - THIS_TRIP_MS + 1 }),
        row({ name: 'B', normalizedName: 'b', purchasedAt: NOW - THIS_TRIP_MS }),
        row({ name: 'C', normalizedName: 'c', purchasedAt: NOW - WEEK_MS + 1 }),
        row({ name: 'D', normalizedName: 'd', purchasedAt: NOW - WEEK_MS }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.name)).toEqual(['A']);
    expect(groups.week.map((r) => r.name)).toEqual(['B', 'C']);
    expect(groups.older.map((r) => r.name)).toEqual(['D']);
  });

  it('dedupes by item key keeping the newest purchase', () => {
    const groups = groupShelfItems(
      [
        row({ id: 'old', purchasedAt: NOW - WEEK_MS - 1000 }),
        row({ id: 'new', purchasedAt: NOW - 1000 }),
        row({ id: 'mid', purchasedAt: NOW - THIS_TRIP_MS - 1000 }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.id)).toEqual(['new']);
    expect(groups.week).toEqual([]);
    expect(groups.older).toEqual([]);
  });

  it('same name in different unit buckets stays as distinct shelf items', () => {
    const groups = groupShelfItems(
      [
        row({ id: 'grams', name: 'Tomater', normalizedName: 'tomater', unit: 'g' }),
        row({ id: 'count', name: 'Tomater', normalizedName: 'tomater', unit: 'stk' }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.id).sort()).toEqual(['count', 'grams']);
  });

  it('hides items whose key is in the active set', () => {
    const hidden = row({ purchasedAt: NOW - 1000 });
    const groups = groupShelfItems([hidden], new Set([itemKey(hidden)]), NOW);
    expect(groups.trip).toEqual([]);
    expect(groups.week).toEqual([]);
    expect(groups.older).toEqual([]);
  });

  it('sorts each group by purchase time, newest first', () => {
    const groups = groupShelfItems(
      [
        row({ name: 'E', normalizedName: 'e', purchasedAt: NOW - 3000 }),
        row({ name: 'F', normalizedName: 'f', purchasedAt: NOW - 1000 }),
        row({ name: 'G', normalizedName: 'g', purchasedAt: NOW - 2000 }),
      ],
      new Set(),
      NOW
    );
    expect(groups.trip.map((r) => r.name)).toEqual(['F', 'G', 'E']);
  });

  it('skips rows with a null purchasedAt and handles empty input', () => {
    expect(groupShelfItems([], new Set(), NOW)).toEqual({ trip: [], week: [], older: [] });
    const groups = groupShelfItems([row({ purchasedAt: null })], new Set(), NOW);
    expect(groups).toEqual({ trip: [], week: [], older: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shelf.test`
Expected: FAIL — `Cannot find module '../lib/shelf'`.

- [ ] **Step 3: Implement lib/shelf.ts**

Create `lib/shelf.ts`:

```ts
// Pure grouping for the Recently Purchased shelf: purchased rows in, a
// time-bucketed staples library out. One card per item key (newest purchase
// wins), keys with an active row are hidden, fixed windows, clock injected
// by the caller. Boundary ages fall to the older side.
import { itemKey } from './shopping';

export const THIS_TRIP_MS = 6 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ShelfRow = {
  id: string;
  name: string;
  normalizedName: string;
  quantity: number | null;
  unit: string | null;
  purchasedAt: number | null;
};

export type ShelfGroups<T extends ShelfRow> = { trip: T[]; week: T[]; older: T[] };

export function groupShelfItems<T extends ShelfRow>(
  purchasedRows: T[],
  activeKeys: Set<string>,
  now: number
): ShelfGroups<T> {
  const newestByKey = new Map<string, T>();
  for (const row of purchasedRows) {
    if (row.purchasedAt === null) continue;
    const key = itemKey(row);
    const current = newestByKey.get(key);
    if (!current || row.purchasedAt > (current.purchasedAt ?? 0)) {
      newestByKey.set(key, row);
    }
  }

  const groups: ShelfGroups<T> = { trip: [], week: [], older: [] };
  for (const [key, row] of newestByKey) {
    if (activeKeys.has(key)) continue;
    const age = now - (row.purchasedAt ?? 0);
    if (age < THIS_TRIP_MS) groups.trip.push(row);
    else if (age < WEEK_MS) groups.week.push(row);
    else groups.older.push(row);
  }

  for (const bucket of [groups.trip, groups.week, groups.older]) {
    bucket.sort((a, b) => (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0));
  }
  return groups;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shelf.test`
Expected: PASS — 6 tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/shelf.ts __tests__/shelf.test.ts
git commit -m "feat: add shelf grouping module"
```

---

### Task 2: readdItem repository function

**Files:**
- Modify: `lib/db/shoppingList.ts`
- Test: extend `__tests__/shopping-list-repository.test.ts`

**Interfaces:**
- Consumes: existing `addItems`, `shoppingItems`, and the file's internal patterns.
- Produces (used by Task 3): `readdItem(db: DB, id: string): void`.

- [ ] **Step 1: Write the failing tests**

Append this describe block to `__tests__/shopping-list-repository.test.ts` (the file's existing `item()` fixture, `allRows()` helper, and imports of `addItems`/`purchaseItem`/`parseSources` are reused; add `readdItem` to the existing import from `../lib/db/shoppingList`):

```ts
describe('readdItem', () => {
  it('copies a purchased row into a fresh active item with empty sources', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const original = allRows(db)[0];
    purchaseItem(db, original.id);

    readdItem(db, original.id);

    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    const purchased = rows.find((r) => r.id === original.id)!;
    const copy = rows.find((r) => r.id !== original.id)!;
    expect(purchased.status).toBe('purchased');
    expect(purchased.purchasedAt).not.toBeNull();
    expect(parseSources(purchased.sources)).toEqual(['Pannekaker']);
    expect(copy).toMatchObject({
      name: 'Mel',
      normalizedName: 'mel',
      quantity: 500,
      unit: 'g',
      status: 'active',
      purchasedAt: null,
    });
    expect(parseSources(copy.sources)).toEqual([]);
  });

  it('merges into an existing active twin instead of duplicating', () => {
    const db = makeTestDb();
    addItems(db, [item()], 'merge');
    const first = allRows(db)[0];
    purchaseItem(db, first.id);
    addItems(db, [item({ quantity: 200 })], 'merge');

    readdItem(db, first.id);

    const rows = allRows(db);
    expect(rows).toHaveLength(2);
    const active = rows.find((r) => r.status === 'active')!;
    expect(active.quantity).toBe(700); // 200 existing + 500 copied
  });

  it('is a no-op for an unknown id', () => {
    const db = makeTestDb();
    readdItem(db, 'nope');
    expect(allRows(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shopping-list-repository`
Expected: FAIL — `readdItem` is not exported (TypeScript/import error), existing tests unaffected.

- [ ] **Step 3: Implement readdItem**

In `lib/db/shoppingList.ts`, after `restoreItem`, add:

```ts
// Quick re-add from the shelf: copy a purchased row into a fresh active
// item. The purchased row is history and stays untouched; recipe sources
// are dropped because last month's attribution would mislead in the aisle.
export function readdItem(db: DB, id: string): void {
  const row = db.select().from(shoppingItems).where(eq(shoppingItems.id, id)).get();
  if (!row) return;
  addItems(
    db,
    [
      {
        name: row.name,
        normalizedName: row.normalizedName,
        quantity: row.quantity,
        unit: row.unit,
        sources: [],
      },
    ],
    'merge'
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shopping-list-repository`
Expected: PASS — 15 tests (12 existing + 3 new).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/db/shoppingList.ts __tests__/shopping-list-repository.test.ts
git commit -m "feat: add readd-item repository function"
```

---

### Task 3: Time-grouped shelf on the Shop tab

**Files:**
- Modify: `app/(tabs)/shop.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: update `__tests__/shop-screen.test.tsx`

**Interfaces:**
- Consumes: `groupShelfItems` from `../../lib/shelf` (Task 1); `readdItem` from `../../lib/db/shoppingList` (Task 2); `itemKey` from `../../lib/shopping`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the screen test**

In `__tests__/shop-screen.test.tsx`, make these changes:

1. Add `readdItem` to the import and the mock factory, and create its typed alias:

```tsx
import { addManualItem, purchaseItem, readdItem, restoreItem } from '../lib/db/shoppingList';
```

In the `jest.mock('../lib/db/shoppingList', ...)` factory, add alongside the other functions:

```tsx
  readdItem: jest.fn(),
```

With the other aliases:

```tsx
const readdItemMock = readdItem as jest.Mock;
```

2. The shelf now buckets by real time, so fixtures need recent timestamps. Above the fixtures add:

```tsx
const NOW = Date.now();
```

and change the `butter` fixture's `purchasedAt` from `2` to `NOW - 1000` (this trip). Add a second purchased fixture below it:

```tsx
const coffee = {
  id: 's3',
  name: 'Kaffe',
  normalizedName: 'kaffe',
  quantity: null,
  unit: null,
  sources: '[]',
  status: 'purchased',
  purchasedAt: NOW - 8 * 24 * 60 * 60 * 1000,
  createdAt: 1,
  updatedAt: 2,
};
```

3. Replace the existing `'purchases on card tap and restores on shelf tap'` test with these three:

```tsx
  it('purchases on card tap and undoes a this-trip shelf tap via restore', () => {
    activeRows = [flour];
    purchasedRows = [butter];
    render(<ShopScreen />);

    fireEvent.press(screen.getByText('Mel'));
    expect(purchaseItemMock).toHaveBeenCalledWith(expect.anything(), 's1');

    expect(screen.getByText('Recently purchased')).toBeOnTheScreen();
    expect(screen.getByText('This trip')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Smør'));
    expect(restoreItemMock).toHaveBeenCalledWith(expect.anything(), 's2');
    expect(readdItemMock).not.toHaveBeenCalled();
  });

  it('re-adds an older shelf item as a copy', () => {
    purchasedRows = [coffee];
    render(<ShopScreen />);

    expect(screen.getByText('Earlier')).toBeOnTheScreen();
    expect(screen.queryByText('This trip')).toBeNull();
    fireEvent.press(screen.getByText('Kaffe'));
    expect(readdItemMock).toHaveBeenCalledWith(expect.anything(), 's3');
    expect(restoreItemMock).not.toHaveBeenCalled();
  });

  it('hides shelf items that already have an active twin', () => {
    activeRows = [flour];
    purchasedRows = [
      {
        ...butter,
        id: 's4',
        name: 'Mel',
        normalizedName: 'mel',
        quantity: 500,
        unit: 'g',
        sources: '[]',
      },
    ];
    render(<ShopScreen />);

    expect(screen.queryByText('Recently purchased')).toBeNull();
    expect(screen.getAllByText('Mel')).toHaveLength(1); // only the active card
  });
```

All other existing tests stay unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- shop-screen`
Expected: FAIL — `readdItem` missing from the module (import error) or `Unable to find an element with text: This trip`. The untouched tests (empty state, active rendering, quick-add pair) must still pass once the import resolves.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, inside `"shop"`, after `"recentlyPurchased"`:

```json
    "recentlyPurchased": "Recently purchased",
    "groupTrip": "This trip",
    "groupWeek": "Earlier this week",
    "groupOlder": "Earlier"
```

In `lib/i18n/nb.json`, same position:

```json
    "recentlyPurchased": "Nylig kjøpt",
    "groupTrip": "Denne turen",
    "groupWeek": "Tidligere denne uken",
    "groupOlder": "Tidligere"
```

- [ ] **Step 4: Render the grouped shelf in app/(tabs)/shop.tsx**

Add imports:

```tsx
import { groupShelfItems } from '../../lib/shelf';
import { itemKey } from '../../lib/shopping';
```

and add `readdItem` to the existing `shoppingList` import:

```tsx
import {
  addManualItem,
  parseSources,
  purchaseItem,
  readdItem,
  restoreItem,
} from '../../lib/db/shoppingList';
```

After the `restore` handler, add:

```tsx
const readd = (id: string) => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  readdItem(db, id);
};
```

Before the `isEmpty` line, derive the groups (the focus effect already re-renders the screen on each tab visit, refreshing the clock):

```tsx
const shelf = groupShelfItems(
  purchasedItems ?? [],
  new Set((activeItems ?? []).map((item) => itemKey(item))),
  Date.now()
);
const shelfSections = [
  { key: 'trip', label: t('shop.groupTrip'), rows: shelf.trip, onTap: restore },
  { key: 'week', label: t('shop.groupWeek'), rows: shelf.week, onTap: readd },
  { key: 'older', label: t('shop.groupOlder'), rows: shelf.older, onTap: readd },
];
const hasShelf = shelfSections.some((section) => section.rows.length > 0);
```

Replace the entire shelf block (currently `{(purchasedItems ?? []).length > 0 ? (…) : null}` — the `<>…</>` containing the "Recently purchased" heading and the purchased `.map`) with:

```tsx
          {hasShelf ? (
            <>
              <Text className="mt-4 font-display text-lg text-ink opacity-70">
                {t('shop.recentlyPurchased')}
              </Text>
              {shelfSections.map((section) =>
                section.rows.length > 0 ? (
                  <React.Fragment key={section.key}>
                    <Text className="mt-2 font-body-bold text-sm text-ink opacity-60">
                      {section.label}
                    </Text>
                    {section.rows.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => section.onTap(item.id)}
                        className="min-h-14 justify-center rounded-card border-2 border-dashed border-linen px-4 active:opacity-80">
                        <Text className="font-body text-base text-ink opacity-60">{item.name}</Text>
                      </Pressable>
                    ))}
                  </React.Fragment>
                ) : null
              )}
            </>
          ) : null}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- shop-screen && npm test -- i18n`
Expected: PASS — 7 shop-screen tests; i18n parity green.

- [ ] **Step 6: Lint, typecheck, bundle check, commit**

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
git add 'app/(tabs)/shop.tsx' lib/i18n/en.json lib/i18n/nb.json __tests__/shop-screen.test.tsx
git commit -m "feat: add time-grouped recently purchased shelf with quick re-add"
```

---

### Task 4: Final verification and manual checklist

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

## Recently purchased shelf (manual pass)

- Buy a few items → they land under "This trip"; tapping one there is an undo: it returns to the list and leaves no shelf entry behind.
- An item purchased earlier (>6h: "Earlier this week"; >7d: "Earlier") re-adds on tap: it appears on the list with its old quantity, no recipe subtitle, and its history row survives (purchase it again → it's back on the shelf).
- An item bought several times appears exactly once on the shelf, in the group of its most recent purchase.
- An item currently on the active list never shows on the shelf; finishing it (tap to purchase) puts it under "This trip".
- Empty groups show no heading; the shelf heading disappears entirely when every purchased item has an active twin.
- Norwegian device language: "Denne turen / Tidligere denne uken / Tidligere" group headings.
- Kill and relaunch — grouping persists (recomputed from purchase timestamps).
```

- [ ] **Step 3: Commit**

```bash
git add ../docs/TESTING.md
git commit -m "docs: add recently purchased manual test checklist"
```

---

## Self-Review Notes

- **Spec coverage:** fixed windows with boundary-to-older semantics + dedupe + active-key hiding + injected clock (T1), copy-back re-add preserving history with emptied sources + merge-into-twin + missing-id no-op (T2), grouped rendering with per-group tap dispatch and unchanged card styling (T3), verification + checklist (T4). No schema change anywhere. The spec's "undo resurfacing quirk" needs no code — dedupe naturally resurfaces the next-newest row.
- **Known judgment calls:** the screen evaluates `Date.now()` per render — the existing `useFocusEffect` (unit-system refresh) already forces a render on every tab focus, so groups are fresh whenever the user looks; a purchase mid-session also re-renders via the live query. The purchased query's `orderBy` becomes redundant (grouping re-sorts) but is kept — harmless and useful if anything else ever reads it. Screen-test fixtures use `Date.now()` at module load; the trip fixture sits 1s inside the 6h window and the older fixture 1 day beyond 7d, so test-run duration cannot flip buckets.
- **Type consistency check:** `groupShelfItems<T extends ShelfRow>` accepts the screen's `ShoppingItemRow[]` (has all `ShelfRow` fields; `purchasedAt: number | null` matches) and returns `T[]`, so `item.name`/`item.id` render untyped-cast-free; `readdItem(db, id)` matches the T3 call site and the T2 tests; `itemKey({ normalizedName, unit })` structural match holds for both active rows and shelf rows; the `jest.mock` factory additions reference nothing out-of-scope.
