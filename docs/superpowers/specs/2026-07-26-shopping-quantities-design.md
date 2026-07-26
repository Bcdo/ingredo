# Shopping Quantities — Design Spec

**Date:** 2026-07-26
**Origin:** beta-testing feedback — manual quick-add cannot carry an amount, and a shelf re-add cannot adjust last trip's amount.
**Scope:** two complementary additions to the Shop tab: the quick-add field understands an optional leading amount (`2 l melk`), and a long-press on any active item opens a small quantity editor. Frontend only.
**Builds on:** the bilingual ingredient-line parser from URL import (`lib/import/ingredientLine.ts` — `parseIngredientLine(line): { quantity, unit, name }` with a closed unit-token map, fractions incl. unicode), `addItems`/`addManualItem` in `lib/db/shoppingList.ts`, the tap-to-purchase row gesture (untouched), sync dirty-stamping (repo writes already handle it), i18n nb/en.

## Goals

- `2 l melk`, `500g mel`, `1/2 stk agurk` typed into quick-add land with quantity and unit; plain `melk` still works exactly as today.
- Any active item's amount is adjustable after the fact — covering the shelf re-add case ("same item, different amount this trip") without taxing the one-tap re-add.
- The daily gestures stay untouched: tap purchases, shelf-tap re-adds, enter adds.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Quantity prompt during shelf re-add | Rejected — punishes the common same-amount case; long-press-after covers it |
| Editing name/unit-system/sources in the editor | Amount + unit only; renaming is delete-and-retype territory |
| Editing purchased (shelf) rows | History stays immutable |
| Free-text unit entry | Unit comes from the closed token map / a picker of known units — bilingual principle |
| Natural-language parsing beyond amount+unit prefix | Never (bilingual principle; the token map IS the contract) |

## Key decisions

1. **Quick-add parses via the existing importer parser.** `addManualItem(db, rawName)` gains parsing: run `parseIngredientLine(trimmed)`; if it yields a quantity and a non-empty name, add with `{name, quantity, unit}`; otherwise add the whole string as the name with null quantity/unit (today's behavior). The parser's unit tokens are the closed bilingual map (g/kg/ml/dl/l/ts/ss/stk + English synonyms); unknown leading numbers WITHOUT a recognized unit still parse as quantity-with-null-unit exactly as recipe import does (`2 melk` → qty 2 of "melk"). Merge semantics are unchanged: adding into an existing active item sums quantities via the existing `sumQuantities` path (same-unit merge rules already exist and stay authoritative).
2. **Long-press opens a quantity editor.** Long-press on an ACTIVE list row (purchased/shelf rows: no editor) opens a small modal sheet: item name as title (read-only), amount input (numeric keypad, decimals allowed, blank = no amount), unit picker as a segmented/chip row of the canonical unit codes (`g kg ml dl l ts ss stk` + "—" for none), Save / Cancel. Save writes via a new repo function `setItemQuantity(db, id, quantity, unit)` (updatedAt bump + dirty stamp + tombstone write-guard `notDeleted`, per house rules; `scheduleSync()` like every repo write). Tap-to-purchase is untouched; long-press is additive.
3. **Re-add flow needs no change:** shelf tap keeps re-adding with last trip's quantity in one tap; when the amount differs, long-press the fresh row and adjust. One extra gesture only in the changed-amount case.
4. **Display already works:** rows already render quantity + unit via `displayQuantity`/`unitLabel` (unit-system aware); no display changes.
5. **Copy (nb + en, `shop.*` additions):** editor title is the item name; `shop.editAmount` ("Mengde" / "Amount") label, `shop.editUnitNone` ("—" both locales), `form.cancel`/`shop.editSave` ("Lagre" / "Save") reusing existing keys where they exist (check `form.*` first — reuse over new keys). Quick-add placeholder updated to hint the syntax: "Legg til (f.eks. 2 l melk)" / "Add (e.g. 2 l milk)".
6. **Testing:** repo tests — `addManualItem` parsing matrix (plain name, qty+unit+name, qty-no-unit, unicode fraction, unit-token bilingual pair, whitespace/empty rejection unchanged, merge-sums-on-existing-key); `setItemQuantity` (writes qty+unit, bumps updatedAt, stamps dirty, no-ops on tombstoned, null clears amount); screen tests — long-press opens editor with current values, save calls `setItemQuantity`, cancel doesn't, purchased rows don't open it, quick-add with `2 l melk` calls addItems with parsed fields; existing tests pass untouched except assertions on the quick-add placeholder copy if any (disclose). Full pass: suite, lint zero warnings, `tsc`, android export.

## Components

- `lib/db/shoppingList.ts` — `addManualItem` parsing + `setItemQuantity`.
- `components/shop/QuantityEditor.tsx` — the sheet (RN `Modal`, house styling).
- `app/(tabs)/shop.tsx` — `onLongPress` wiring + editor state + placeholder copy.
- `lib/i18n/{nb,en}.json` — the few new keys.
- Tests: additions to the shopping repo test file; `__tests__/quantity-editor.test.tsx`; shop-screen test additions.

## Error handling

Non-numeric amount input is prevented by the numeric keypad; a blank amount saves as null (no amount). No other failure modes beyond the norm.

## Testing

Per decision 6. Headline properties: parsing never changes what plain-name adds do today, and the editor can never touch purchased history or tombstones.

## Rollout

Feature branch `feature/shopping-quantities` off `develop`. No migration (quantity/unit columns exist), no dependencies, sync-safe by construction (repo-write discipline). Manual checklist appended to `docs/TESTING.md`.
