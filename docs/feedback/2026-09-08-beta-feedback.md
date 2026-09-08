# Beta feedback, 2026-09-08 (operator's own use, Android + iPhone)

Six items, triaged with code investigation. Status 2026-09-08: B1 fixed on develop (e385746); F3 and F4 done on feature/dinner-shopping-card, where F3 became a dinner-scoped reminder card ("Handle til middag") and the "I kveld" heading was dropped; F2 done on feature/shop-checkoff-animation (sage tick moment, Reanimated layout transitions, legacy LayoutAnimation removed); B2 guarded on fix/stale-edit-overwrite (edit screen refuses to save over a recipe changed elsewhere; the superseded-row idea was dropped because keeping such rows dirty would re-push in a loop, and the cursor-gap race stays a documented server tradeoff); F1 done on feature/us-units (cup/oz/lb chips in the recipe form, fractions in the quantity field, metric-canonical storage with snap-back, importer knows cup/oz/lb). All six items addressed.

## Bugs

### B1. Step text duplicates while typing (Android only)

Cause found. `RecipeForm.tsx:332-374` renders step rows through `Sortable.Grid`
with an inline `renderItem`. The library hands `renderItem` to an external
store and flushes it in a `useEffect`, so a controlled `value` now reaches
the native `TextInput` one commit later than before the reorder slice.
Android (Fabric) reconciles the late `value` against text Gboard has already
committed and re-applies it around the composing region, which duplicates
words. iOS drops stale value writes while editing, so it never shows.
Aggravators: `onChangeText` maps over a closure-captured `state.instructions`
(stale under fast typing), and every keystroke re-creates every row's node
because the inline `renderItem` is a new function each render.

Fix shape: extract a `StepRow` that owns its text locally (`defaultValue` or
local state, never accepting parent writes while focused) and reports up via
`onChangeText`; make the parent update functional; `useCallback` the
`renderItem` and use its `index` param instead of `findIndex`; `React.memo`
the row. Same stale-closure pattern exists for ingredients (`patchIngredient`).

### B2. Steps and notes briefly missing on a recipe, then back

**Resolved 2026-09-08 with server evidence: not a sync bug.** The operator had
two independent recipes, "No plan pasta" in household Alone and a
copy-to-household of it in Bodø made at 06:39 UTC and renamed "No time
pasta". The steps and notes were added to the Alone original at 09:58, after
the copy existed; copies never sync with their source by design. Seen from
Bodø the recipe "had no steps"; from Alone it did. A fresh copy made after
the steps existed carried them, so `copyRecipeToHousehold` is fine. The
stale-edit guard shipped in this round stays as a general safeguard. The
analysis below is kept for reference.

Most likely a two-device last-write-wins clobber. Sync decides the winner by
the writing device's wall clock (`recipes.ts:90`, `SyncService.cs:194`), a
push replaces the whole aggregate (children absent = deleted server-side,
`SyncService.cs:243-249`), and a clean local row applies server state
unconditionally even when older (`apply.ts:22-26`, asserted in
`sync-apply.test.ts:92`). Two routes to an empty version winning: clock skew
between the phones, or the edit screen's one-shot snapshot
(`edit.tsx:14`, `useMemo(getRecipe)`) being saved after a pull changed the
recipe underneath it. The steps come back when the other device's copy is
pushed again. Notes and steps vanishing *together* rules out a pure render
timing issue, since notes live on the same row as the title.

Secondary contributors: the documented pull-cursor gap
(`docs/superpowers/specs/2026-07-22-sync-endpoints-design.md:27`), and
`applyRecipe` deleting and re-inserting children on every pull, which can
paint an empty Method block for a frame.

Field check: compare `recipes.updated_at` for that recipe on each phone with
the server row. Deterministic repro for the backend half: push v2 with steps
at T+1000, push v1 without steps at T+2000, pull, expect empty; push v2 again,
expect restored.

## Feature requests

### F1. Enter US measurements when writing a recipe

Storage is metric-canonical (`units.ts:4`, `CANONICAL_MEASURES`); the
Metric/US toggle is display-only, one direction (`measure.ts:53-81`, no
inverse). The form's `UnitPicker` offers only metric chips plus a free-text
"other" that stores an unrecognised string. `parseQuantity` accepts decimals
only, no `1/2` or `½`. Temperature does not exist anywhere.

Shape: convert at the input boundary, keep storing metric. Add US→base
factors and `toCanonical()` in `measure.ts`; US chips (cup, oz, lb, tsp,
tbsp) in `UnitPicker` that convert on save; fraction parsing (reuse
`parseAmount` from `lib/import/ingredientLine.ts`, extract to shared);
mirror in the shopping `QuantityEditor`. °F cheapest as a display-time
regex over instruction text. Round-trip snap-back (1 cup → 237 ml → 1 cup)
is acceptable unless an `original_unit` column is added, which drags in a
migration and backend DTO changes. Medium-large, 1-2 days.

### F2. Animation when checking off a shopping item

Items move to "Recently purchased" (by design, `DESIGN_SYSTEM.md:20-36`).
The three mutations in `shop.tsx:82-92` use legacy `LayoutAnimation`, which
is unreliable on the new architecture, hence the abrupt jump. Reanimated 4
is already installed and barely used. Shape: `Animated.View` rows with
`entering`/`exiting`/`layout={LinearTransition}` keyed by item id, optional
sage tint on check-off; extract `components/shop/ShoppingRow.tsx`; apply
the same to `StaplesSection`. Small, half a day.

### F3. Separate "I kveld" from "Handleliste" on the Today screen

`app/(tabs)/index.tsx`: Tonight and Tomorrow have section headings; the
shopping card (`components/today/ShoppingCard.tsx`) has none and uses the
same linen `Card`, so three identical rectangles sit in a uniform `gap-6`.
Cheapest, most on-system fix: give the shopping card a section heading
like its siblings (`today.shoppingTitle` already exists in both locales) and
drop the in-card title. Alternatives: sage fill (documented "plan→shop
bridge" colour, pattern exists in the recipe screen's added banner) or an
outlined card. Very small, under an hour.

### F4. Inactive household does not look tappable

`components/settings/HouseholdsSection.tsx:244-256`: the inactive row is a
bare `Pressable` with no background, border, radius, press feedback, chevron,
or minimum height (`py-2` on a ~40 px row, against the app's `min-h-14`
norm and `DESIGN_SYSTEM.md:16`). The active row is a large clay-outlined
panel, so the size ratio reads as hierarchy, not state. Shape: `min-h-14
rounded-card active:opacity-80`, `bg-linen` or `border-linen`, trailing
chevron, `accessibilityState.selected`; keep `testID=household-row-<id>`.
Small, 1-3 hours, one file.

## Suggested order

1. B1 (contained, one file, hurts every Android recipe entry).
2. F3 + F4 together (tiny, same afternoon).
3. F2.
4. B2 (needs a design decision on conflict handling; at minimum make the
   edit screen re-read after a pull, and stop clearing `dirty` on
   "superseded").
5. F1 (largest; decide on snap-back vs stored original unit first).
