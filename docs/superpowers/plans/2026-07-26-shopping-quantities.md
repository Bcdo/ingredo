# Shopping Quantities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quick-add understands `2 l melk`; long-press on an active shopping item opens a small amount+unit editor — tap-to-purchase and one-tap shelf re-add untouched.

**Architecture:** The repo layer gains parsing (reusing `parseIngredientLine` from URL import — a closed bilingual token map, no language parsing) inside `addManualItem`, plus a guarded `setItemQuantity` write. The UI adds one self-contained `QuantityEditor` modal component and a long-press wire in `shop.tsx`. Merge semantics (`itemKey` unit-bucketing + `sumQuantities`) stay authoritative and untouched.

**Tech Stack:** existing frontend stack. No new dependencies, no schema changes (quantity/unit columns exist), no backend contact.

**Spec:** `docs/superpowers/specs/2026-07-26-shopping-quantities-design.md`

## Global Constraints

- Parsing (spec decision 1): `addManualItem` runs `parseIngredientLine` on the trimmed input; a parsed quantity+name adds with `{name, quantity, unit}`; anything else adds the whole string as name with null quantity/unit — plain-name behavior byte-identical to today. Empty/whitespace still returns false. Merge stays the existing `addItems`/`itemKey`/`sumQuantities` path, untouched.
- `setItemQuantity(db, id, quantity, unit)`: bumps `updatedAt`, stamps `dirty: 1`, carries the tombstone write-guard (`notDeleted`), calls `scheduleSync()`; when `quantity` is null the stored `unit` is also null.
- Editor (decision 2): opens on LONG-PRESS of active rows only (tap still purchases; purchased/shelf rows never open it); amount input `decimal-pad`, blank/invalid/≤0 saves as null; unit picked from chips: "—" (`form.unitNone`) + the canonical `UNITS` codes (`g kg ml dl l ts ss stk`); Save/Cancel reuse `form.save`/`form.cancel`.
- i18n: ONE new key `shop.editAmount` ("Amount" / "Mengde"); `shop.quickAddPlaceholder` value updated to "Add (e.g. 2 l milk)" / "Legg til (f.eks. 2 l melk)". Both dictionaries (parity test).
- Existing tests pass untouched EXCEPT: the shop-screen test's `jest.mock('../lib/db/shoppingList')` factory gains `setItemQuantity` (compile-forced), and any assertion on the OLD placeholder string updates to the new copy (copy-change-forced) — both disclosed, nothing else.
- Green bar per task: `npx jest`, `npx eslint . --max-warnings 0`, `npx tsc --noEmit` from `/home/mrb/Work/Programming/ingredo/frontend`. Baseline: 397 tests.

## File Structure

- Create: `components/shop/QuantityEditor.tsx`
- Modify: `lib/db/shoppingList.ts`, `app/(tabs)/shop.tsx`, `lib/i18n/{nb,en}.json`, `__tests__/shop-screen.test.tsx` (disclosed changes only), root `docs/TESTING.md`
- Tests: additions to `__tests__/shopping-list-repository.test.ts`; new `__tests__/quantity-editor.test.tsx`

---

### Task 1: Repo layer — parsing quick-add and the quantity write

**Files:**
- Modify: `lib/db/shoppingList.ts`
- Test: append to `__tests__/shopping-list-repository.test.ts`

**Interfaces:**
- Consumes: `parseIngredientLine(line): { quantity: number | null; unit: string | null; name: string }` from `lib/import/ingredientLine.ts` (never returns an empty name for non-empty input).
- Produces (used by Task 2): `setItemQuantity(db: DB, id: string, quantity: number | null, unit: string | null): void`; the new `addManualItem` parsing behavior.

- [ ] **Step 0: Branch**

```bash
cd /home/mrb/Work/Programming/ingredo
git checkout develop
git checkout -b feature/shopping-quantities
cd frontend
```

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/shopping-list-repository.test.ts` (using its existing imports/helpers — `makeTestDb`, `shoppingItems`, `addManualItem`; add `setItemQuantity` to the repo import and `eq` if not present):

```ts
describe('addManualItem parsing', () => {
  function onlyRow(db: ReturnType<typeof makeTestDb>) {
    const rows = db.select().from(shoppingItems).all();
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it('parses amount and unit: "2 l melk"', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '2 l melk')).toBe(true);
    const row = onlyRow(db);
    expect(row).toMatchObject({ name: 'melk', normalizedName: 'melk', quantity: 2, unit: 'l' });
  });

  it('parses a glued unit: "500g mel"', () => {
    const db = makeTestDb();
    addManualItem(db, '500g mel');
    expect(onlyRow(db)).toMatchObject({ name: 'mel', quantity: 500, unit: 'g' });
  });

  it('parses an amount without a unit: "2 melk"', () => {
    const db = makeTestDb();
    addManualItem(db, '2 melk');
    expect(onlyRow(db)).toMatchObject({ name: 'melk', quantity: 2, unit: null });
  });

  it('parses a unicode fraction: "½ agurk"', () => {
    const db = makeTestDb();
    addManualItem(db, '½ agurk');
    expect(onlyRow(db)).toMatchObject({ name: 'agurk', quantity: 0.5, unit: null });
  });

  it('plain names behave exactly as before', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    expect(onlyRow(db)).toMatchObject({ name: 'melk', quantity: null, unit: null });
  });

  it('still rejects blank input', () => {
    const db = makeTestDb();
    expect(addManualItem(db, '   ')).toBe(false);
    expect(db.select().from(shoppingItems).all()).toHaveLength(0);
  });

  it('merges same-name same-unit adds by summing', () => {
    const db = makeTestDb();
    addManualItem(db, '2 l melk');
    addManualItem(db, '1 l melk');
    expect(onlyRow(db)).toMatchObject({ quantity: 3, unit: 'l' });
  });
});

describe('setItemQuantity', () => {
  it('writes amount and unit, bumps updatedAt, stamps dirty', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    const before = db.select().from(shoppingItems).all()[0];
    db.update(shoppingItems).set({ dirty: 0 }).run();

    setItemQuantity(db, before.id, 2, 'l');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, before.id)).get()!;
    expect(after).toMatchObject({ quantity: 2, unit: 'l', dirty: 1 });
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('null amount clears the unit too', () => {
    const db = makeTestDb();
    addManualItem(db, '2 l melk');
    const row = db.select().from(shoppingItems).all()[0];

    setItemQuantity(db, row.id, null, 'l');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.quantity).toBeNull();
    expect(after.unit).toBeNull();
  });

  it('no-ops on tombstoned rows', () => {
    const db = makeTestDb();
    addManualItem(db, 'melk');
    const row = db.select().from(shoppingItems).all()[0];
    db.update(shoppingItems)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(shoppingItems.id, row.id))
      .run();
    const before = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;

    setItemQuantity(db, row.id, 5, 'kg');

    const after = db.select().from(shoppingItems).where(eq(shoppingItems.id, row.id)).get()!;
    expect(after.quantity).toBe(before.quantity);
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest __tests__/shopping-list-repository.test.ts`
Expected: the parsing tests FAIL (quantity comes back null) and `setItemQuantity` is not exported; existing tests still pass.

- [ ] **Step 3: Implement**

In `lib/db/shoppingList.ts`: add `import { parseIngredientLine } from '../import/ingredientLine';` and replace `addManualItem`:

```ts
export function addManualItem(db: DB, rawName: string): boolean {
  const line = rawName.trim();
  if (line === '') return false;
  // Structured amount prefix via the closed bilingual token map from URL
  // import — "2 l melk" carries its amount; anything unparseable stays a
  // plain name, byte-identical to the old behavior.
  const parsed = parseIngredientLine(line);
  const name = parsed.name.trim();
  if (name === '') return false;
  addItems(
    db,
    [
      {
        name,
        normalizedName: normalizeName(name),
        quantity: parsed.quantity,
        unit: parsed.unit,
        sources: [],
      },
    ],
    'merge'
  );
  return true;
}
```

and add below `restoreItem`:

```ts
// Long-press editor write: amount only (name edits are delete-and-retype).
// Guarded like every by-id mutation — a row a pull just tombstoned must
// not resurrect through a stale editor.
export function setItemQuantity(
  db: DB,
  id: string,
  quantity: number | null,
  unit: string | null
): void {
  db.update(shoppingItems)
    .set({
      quantity,
      unit: quantity === null ? null : unit,
      updatedAt: Date.now(),
      dirty: 1,
    })
    .where(and(eq(shoppingItems.id, id), notDeleted(shoppingItems)))
    .run();
  scheduleSync();
}
```

(`and`, `eq`, `notDeleted`, `scheduleSync` are already imported in the file.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/shopping-list-repository.test.ts` then the full gate: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit`
Expected: 10 new tests green; full suite green (397 + 10 = 407).

- [ ] **Step 5: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/
git commit -m "feat: parse quick-add amounts and add a guarded quantity write"
```

---

### Task 2: The editor, long-press wiring, i18n, docs

**Files:**
- Create: `components/shop/QuantityEditor.tsx`
- Modify: `app/(tabs)/shop.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`, `__tests__/shop-screen.test.tsx` (disclosed changes only), root `docs/TESTING.md`
- Test: `__tests__/quantity-editor.test.tsx`

**Interfaces:**
- Consumes: Task 1 `setItemQuantity`; `UNITS` from `lib/units.ts`; `unitLabel` from `lib/unitLabel.ts`.
- Produces: `QuantityEditor({ item, onSave, onCancel })` with `QuantityEditorItem = { id: string; name: string; quantity: number | null; unit: string | null }` and `onSave(quantity: number | null, unit: string | null)`.

- [ ] **Step 1: i18n**

In `lib/i18n/en.json`: inside `"shop"`, add `"editAmount": "Amount"` and change `"quickAddPlaceholder"` to `"Add (e.g. 2 l milk)"`.
In `lib/i18n/nb.json`: add `"editAmount": "Mengde"` and change `"quickAddPlaceholder"` to `"Legg til (f.eks. 2 l melk)"`.

- [ ] **Step 2: Write the failing editor tests**

Create `__tests__/quantity-editor.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { QuantityEditor } from '../components/shop/QuantityEditor';

const item = { id: 's1', name: 'Melk', quantity: 2, unit: 'l' };

describe('QuantityEditor', () => {
  it('shows the item name and current values', () => {
    render(<QuantityEditor item={item} onSave={jest.fn()} onCancel={jest.fn()} />);

    expect(screen.getByText('Melk')).toBeOnTheScreen();
    expect(screen.getByTestId('quantity-input').props.value).toBe('2');
  });

  it('saves an edited amount and unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('quantity-input'), '1,5');
    fireEvent.press(screen.getByText('kg'));
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(1.5, 'kg');
  });

  it('a blank amount saves as null with null unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByTestId('quantity-input'), '');
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(null, null);
  });

  it('selecting the none chip clears the unit', () => {
    const onSave = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={jest.fn()} />);

    fireEvent.press(screen.getByTestId('unit-none'));
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(2, null);
  });

  it('cancel does not save', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    render(<QuantityEditor item={item} onSave={onSave} onCancel={onCancel} />);

    fireEvent.press(screen.getByText('Cancel'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest __tests__/quantity-editor.test.tsx`
Expected: FAIL — cannot find module `../components/shop/QuantityEditor`.

- [ ] **Step 4: Implement the editor**

Create `components/shop/QuantityEditor.tsx`:

```tsx
import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { t } from '../../lib/i18n';
import { unitLabel } from '../../lib/unitLabel';
import { UNITS } from '../../lib/units';
import { usePalette } from '../../lib/usePalette';
import { Button } from '../ui/Button';

export type QuantityEditorItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

type QuantityEditorProps = {
  item: QuantityEditorItem;
  onSave: (quantity: number | null, unit: string | null) => void;
  onCancel: () => void;
};

// Amount-and-unit only: renaming is delete-and-retype territory, and the
// editor is reachable only from ACTIVE rows (purchased history stays
// immutable). Mounted fresh per item, so plain useState initializers hold
// the current values.
export function QuantityEditor({ item, onSave, onCancel }: QuantityEditorProps) {
  const palette = usePalette();
  const [amountText, setAmountText] = useState(item.quantity === null ? '' : String(item.quantity));
  const [unit, setUnit] = useState<string | null>(item.unit);

  const save = () => {
    const parsed = Number(amountText.trim().replace(',', '.'));
    const quantity =
      amountText.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    onSave(quantity, quantity === null ? null : unit);
  };

  const chips: { key: string; label: string; value: string | null; testID?: string }[] = [
    { key: 'none', label: t('form.unitNone'), value: null, testID: 'unit-none' },
    ...UNITS.map((code) => ({ key: code, label: unitLabel(code), value: code as string })),
  ];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('form.cancel')}
        onPress={onCancel}
        className="flex-1 justify-end bg-black/40">
        <Pressable onPress={() => {}} className="rounded-t-card bg-cream p-4 pb-8">
          <Text className="font-display text-lg text-ink" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="mt-3 font-body-bold text-sm text-ink">{t('shop.editAmount')}</Text>
          <TextInput
            testID="quantity-input"
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            placeholder="—"
            placeholderTextColor={palette.inkFaint}
            className="mt-1 min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
          />
          <View className="mt-3 flex-row flex-wrap gap-2">
            {chips.map((chip) => (
              <Pressable
                key={chip.key}
                testID={chip.testID}
                accessibilityRole="button"
                onPress={() => setUnit(chip.value)}
                className={`min-h-14 items-center justify-center rounded-card px-4 ${
                  unit === chip.value ? 'bg-clay' : 'bg-linen'
                }`}>
                <Text
                  className={`font-body-bold text-base ${
                    unit === chip.value ? 'text-cream' : 'text-ink'
                  }`}>
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="mt-4 gap-2">
            <Button label={t('form.save')} onPress={save} />
            <Button label={t('form.cancel')} onPress={onCancel} variant="ghost" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

Run: `npx jest __tests__/quantity-editor.test.tsx` — Expected: 5/5. (If `unitLabel('l')` renders something other than the bare code, the 'kg' press in the save test targets `unitLabel('kg')`'s actual output — adapt the pressed text to the real label and disclose.)

- [ ] **Step 5: Wire the shop screen**

In `app/(tabs)/shop.tsx`:

1. Imports: `import { QuantityEditor, type QuantityEditorItem } from '../../components/shop/QuantityEditor';`; add `setItemQuantity` to the existing `lib/db/shoppingList` import.
2. State next to `draft`: `const [editing, setEditing] = useState<QuantityEditorItem | null>(null);`
3. The ACTIVE item `Pressable` (the one whose `onPress` purchases) gains:

```tsx
                onLongPress={() =>
                  setEditing({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    unit: item.unit,
                  })
                }
```

4. Before the root `View`'s closing tag, add:

```tsx
      {editing ? (
        <QuantityEditor
          item={editing}
          onCancel={() => setEditing(null)}
          onSave={(quantity, unit) => {
            setItemQuantity(db, editing.id, quantity, unit);
            setEditing(null);
          }}
        />
      ) : null}
```

5. In `__tests__/shop-screen.test.tsx` (disclosed): add `setItemQuantity: jest.fn(),` to the `jest.mock('../lib/db/shoppingList', ...)` factory; if any existing assertion uses the OLD `quickAddPlaceholder` copy, update just that string to the new copy. Then append two tests (adapting to the file's fixtures — it has active rows like `flour`):

```tsx
  it('long-press opens the quantity editor for an active item', () => {
    activeRows = [flour];
    purchasedRows = [];
    mockQueries();
    render(<ShopScreen />);

    fireEvent(screen.getByText('Mel'), 'longPress');

    expect(screen.getByTestId('quantity-input')).toBeOnTheScreen();
  });

  it('saving the editor writes through setItemQuantity', () => {
    activeRows = [flour];
    purchasedRows = [];
    mockQueries();
    render(<ShopScreen />);
    fireEvent(screen.getByText('Mel'), 'longPress');

    fireEvent.changeText(screen.getByTestId('quantity-input'), '2');
    fireEvent.press(screen.getByText('Save'));

    expect(setItemQuantity).toHaveBeenCalledWith(expect.anything(), flour.id, 2, flour.unit);
  });
```

(Adapt fixture names/text to the file's real ones — `flour`'s rendered name and id; import `setItemQuantity` for the assertion; place inside an existing describe with the standard `beforeEach`. The fixture's `unit` value flows through because the editor initializes from the item.)

- [ ] **Step 6: Full gate**

Run: `npx jest && npx eslint . --max-warnings 0 && npx tsc --noEmit && npx expo export --platform android --output-dir /tmp/claude-1000/export-check`
Expected: 414/414 (407 + 5 editor + 2 shop). Existing shop tests untouched beyond the disclosed factory entry + possible placeholder-string update. Export bundles.

- [ ] **Step 7: Manual checklist**

Append to `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Shopping quantities (manual pass)

- Quick-add "2 l melk" → the item lands as "melk" with "2 l" shown; plain "melk" still adds without an amount.
- "500g mel", "½ agurk" and "2 melk" all parse (glued unit, unicode fraction, amount-only).
- Adding "1 l melk" when "2 l melk" is on the list merges to 3 l (same unit); a different unit stays a separate row (existing behavior).
- Long-press an active item → editor opens with current amount/unit; change and save → the row updates and syncs to the other device.
- Blank amount + save → the amount disappears from the row.
- Tap still purchases; long-press on shelf (purchased) rows does nothing.
- Shelf re-add keeps one tap (last amount); long-press the fresh row to adjust this trip's amount.
- Both languages: the placeholder hint and Amount label follow nb/en.
```

- [ ] **Step 8: Commit**

```bash
cd /home/mrb/Work/Programming/ingredo
git add frontend/ docs/TESTING.md
git commit -m "feat: add quantity editing on the shopping list"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (parser reuse, fallback-to-name, merge untouched → T1 with per-case tests), 2 (long-press editor, guarded write, chips from UNITS, reused form keys → T1 write + T2 editor/wiring), 3 (re-add flow unchanged — nothing touches shelf handlers), 4 (display untouched), 5 (one new key + placeholder copy → T2), 6 (test matrix → T1/T2 incl. the two disclosed shop-test changes). Non-goals respected: no prompt-on-readd, no name editing, no purchased-row editing, closed unit set only.
- **Judgment calls:** `addManualItem` re-checks the parsed name for emptiness (parser guarantees non-empty for non-empty input — the check is belt-and-braces, unreachable). `setItemQuantity` nulls the unit when quantity is null (an amountless unit is meaningless). The editor mounts fresh per item (conditional render), so `useState` initializers suffice — no sync-props effect. The backdrop `Pressable` cancels; the sheet's inner `Pressable` swallows taps. Editor tests run it directly with `visible` hardcoded true (RNTL renders Modal children when visible).
- **Type consistency check:** `QuantityEditorItem` matches the `setEditing` construction and `shoppingItems` row fields; `onSave(quantity, unit)` arity matches the shop wiring and every editor test; `setItemQuantity(db, id, quantity, unit)` matches T1 definition, T2 wiring, and the shop-screen assertion; `UNITS`/`unitLabel` imports match their real exports (`lib/units.ts:4`, `lib/unitLabel.ts`).
- **Placeholder scan:** clean; the two sanctioned existing-test adaptations are precisely bounded and flagged for disclosure.
