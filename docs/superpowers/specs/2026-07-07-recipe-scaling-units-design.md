# Recipe Scaling & Unit Conversion — Design Spec

**Date:** 2026-07-07
**Slice:** Second feature slice of the Phase 1 local MVP (frontend only, no backend).
**Scope:** Display-time recipe scaling (servings stepper) and US ⇄ Metric unit conversion on the recipe detail screen, a per-ingredient "fixed / to taste" scaling flag, plus the persisted unit-system preference.
**Builds on:** `2026-07-05-recipe-management-design.md` (recipe CRUD, schema, i18n, tokens, test infra).

## Goals

- On the recipe detail screen, a user can scale a recipe to any serving count and every ingredient quantity rescales in place (`DESIGN.md` §3.4).
- A user can toggle displayed quantities between Metric and US customary units; the choice persists app-wide.
- Both are **display-time transforms**: the stored recipe is never modified.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| "Add N ingredients to shopping list" honoring the current scale | Shopping slice |
| Household-wide unit default | Phase 4 (the settings table introduced here is its seed) |
| Auto re-ranging within a system (1500 g → 1.5 kg) | Explicitly declined for this slice; metric mode always keeps the authored unit |
| Automatic spice/leavening scaling heuristics | Declined — needs language-dependent ingredient classification and invents numbers; the per-ingredient fixed flag is the structured answer |
| Density-based volume ↔ weight conversion | Never crossed — no density data |
| fl oz as a display unit | Omitted; tsp/tbsp/cup cover cooking volumes |
| Settings screen | Later slice; the only setting lives as a toggle on the detail screen |

## Key decisions

1. **Dimension-based unit registry** (not pairwise mapping, not a library). Each canonical unit carries a dimension and a factor to a base unit; conversion goes value → base → best display unit for the target system. Table-driven, extensible, pure, Node-testable.
2. **Scaling is ephemeral per visit.** The detail screen always opens at the recipe's saved servings. The stepper adjusts the view only.
3. **The unit system persists app-wide** in a new generic `settings` key–value table (SQLite, additive migration) — the natural seed for the Phase 4 household default.
4. **`ts`/`ss` are culinarily identical to tsp/tbsp** (5 ml / 15 ml). In US mode they relabel; no math. The ~1.4% US-legal difference is irrelevant in cooking.
5. **Metric mode never changes the authored unit.** 500 g × 3 displays as 1500 g; 12 ss stays 12 ss. Unit selection only happens when crossing into US, where a display unit must be chosen anyway.
6. **US values render as cook-friendly fractions; metric stays decimal** with a locale-aware separator (`1,5 dl` in nb, `1.5 dl` in en) — this folds in the deferred decimal-comma polish item from the previous slice.
7. **Per-ingredient scaling flag instead of spice heuristics.** Seasonings and leavening don't scale linearly, but there is no formula — it's per-ingredient judgment, and name-based "spice detection" would be language-dependent (which this project avoids). Each ingredient gets `scaling: 'linear' | 'fixed'` (default linear). Fixed rows keep their authored amount when the recipe is scaled and show a subtle "adjust to taste" hint; they still unit-convert.

## Unit registry

Extends `lib/units.ts`. Canonical (storable) codes are unchanged: `g, kg, ml, dl, l, ts, ss, stk` + free text.

| Unit | Dimension | Factor to base | Notes |
|---|---|---|---|
| `g` | mass (base g) | 1 | |
| `kg` | mass | 1000 | |
| `ml` | volume (base ml) | 1 | |
| `dl` | volume | 100 | |
| `l` | volume | 1000 | |
| `ts` | volume | 5 | displays as "ts" (nb) / "tsp" (en) |
| `ss` | volume | 15 | displays as "ss" (nb) / "tbsp" (en) |
| `stk` | count | — | scales, never converts |

US display-only units (never stored):

| Unit | Dimension | Factor to base |
|---|---|---|
| `oz` | mass | 28.3495 |
| `lb` | mass | 453.592 |
| `tsp` | volume | 5 (equated with `ts`) |
| `tbsp` | volume | 15 (equated with `ss`) |
| `cup` | volume | 236.588 |

## Transform pipeline

One pure entry point in `lib/measure.ts`:

```
displayQuantity(quantity: number | null, unit: string | null,
                opts: { scaleFactor: number; system: 'metric' | 'us'; locale: 'en' | 'nb';
                        scaling?: 'linear' | 'fixed' /* default 'linear' */ })
  → { amountText: string; unitCode: string | null } | null   // null when quantity is null
```

1. **Scale:** `scaled = quantity × scaleFactor` where `scaleFactor = selectedServings / recipe.servings`.
2. **Route:**
   - `quantity === null` → return null (row renders name-only, as today).
   - Ingredient has `scaling: 'fixed'` → skip step 1 (authored amount kept, even when the stepper is moved); conversion and formatting still apply. The screen adds a subtle localized "adjust to taste" hint to fixed rows whenever `scaleFactor ≠ 1`.
   - Free-text unit or `stk` → amount formatted per locale, unit unchanged, in both systems.
   - `system === 'metric'` → authored unit kept; decimal formatting.
   - `system === 'us'` and unit is `ts`/`ss` → unit code kept (its localized label already reads "tsp"/"tbsp" in English); fraction formatting.
   - `system === 'us'` and unit is mass/volume metric → convert to base, pick US display unit by band, fraction formatting.
3. **Bands (US only):**
   - volume: `< 15 ml` → tsp · `< 59.15 ml` (¼ cup) → tbsp · else cup
   - mass: `< 453.592 g` (1 lb) → oz · else lb
4. **Format:**
   - Metric: round to at most 2 decimals (matching the existing `formatQuantity` precision, so unscaled authored values render unchanged), trim trailing zeros, locale decimal separator (comma for nb).
   - US: snap to the nearest representable value — whole numbers plus eighths and thirds (⅛, ¼, ⅓, ⅜, ½, ⅝, ⅔, ¾, ⅞) — rendered with fraction glyphs (`2¼ cup`). A non-zero quantity never snaps to zero — floor at the smallest step (⅛).

Band boundaries are compared against the *unrounded* base amount so tiny floating-point noise cannot flip the chosen unit.

`formatQuantity` in `lib/quantity.ts` becomes locale-aware (used by the metric path); existing callers pass the device locale.

## Schema changes

One additive drizzle-kit migration covering both changes below.

### `recipe_ingredients` — new column
| Column | Type | Notes |
|---|---|---|
| `scaling` | text NOT NULL default `'linear'` | `'linear'` \| `'fixed'`; fixed = amount does not follow the servings stepper |

`RecipeInput`/repository (`lib/db/recipes.ts`) and the form mapping (`lib/form.ts`, `IngredientDraft`) carry the field through; existing rows default to `linear`.

## Settings storage

New table (same migration):

### `settings`
| Column | Type | Notes |
|---|---|---|
| `key` | text PK | e.g. `unit_system` |
| `value` | text | |

Repository `lib/db/settings.ts`: `getUnitSystem(db): 'metric' | 'us'` (default `'metric'` when unset) and `setUnitSystem(db, system)`. The detail screen reads once on mount into component state and writes through on toggle — no live query; the control and the affected rows live on the same screen.

## UI — recipe detail screen only

The static "N servings" line above the ingredients is replaced by a control row:

- **Servings stepper** — existing `Stepper` primitive, initialized to `recipe.servings`, min 1, integer steps, with the localized "servings" label. Changing it recomputes `scaleFactor` and every quantity re-renders.
- **Unit toggle** — new `components/ui/SegmentedControl.tsx` (two segments here: Metric | US; styled like the form's unit chips, selected segment clay on cream). Reusable primitive for later slices. Tapping persists via `setUnitSystem` and re-renders.

Fixed-scaling rows render their authored amount with a subtle "adjust to taste" hint (small, ink at reduced opacity — not an error tone) whenever the stepper differs from the saved servings.

Touch targets ≥ 56 pt; quantities remain clay Fraunces per `DESIGN.md` §3.4.

## UI — recipe form

Each ingredient row gains a small toggle chip below the unit picker: **"Scales with servings"** (default, linear) ⇄ **"Fixed amount / to taste"**. Same chip styling as the unit picker; state maps to `IngredientDraft.scaling`. The form still always edits the authored recipe at its saved servings — the flag changes only how the detail screen scales the row. List and detail navigation are otherwise untouched.

## i18n

New keys in **both** `en.json` and `nb.json` (key-symmetry test enforces):

- `units.oz`, `units.lb`, `units.cup` — nb uses the loanwords "oz", "lb", "cup" (a US cup ≠ a Norwegian "kopp"; no false translation). `ts`/`ss` keep their codes in US mode and their existing labels ("tsp"/"tbsp" in en, "ts"/"ss" in nb) — no new keys needed for them.
- `detail.servings` (stepper row label), `detail.unitsMetric`, `detail.unitsUS` (toggle segments).
- `detail.adjustToTaste` (hint on fixed rows when scaled), `form.scalingLinear` / `form.scalingFixed` (ingredient-row toggle chips).

## Validation & edge cases

- Null quantity → name-only row, regardless of scale/system/scaling flag.
- Free-text unit / `stk` → number scales, unit text unchanged.
- Fixed rows ignore the stepper but still follow the unit toggle; the hint appears only when `scaleFactor ≠ 1`.
- Fraction snapping floors at ⅛ — a non-zero amount never displays as 0.
- Stepper enforces integers ≥ 1 by construction; scaleFactor of 1 renders exactly the stored quantities (identity round-trip).
- Unknown/free-text units never hit the registry — routed out before conversion.

## Testing

- **Node tests** (`__tests__/measure.test.ts`): registry factors, band selection at and around boundaries, fraction snapping (incl. the ⅛ floor and identity at scaleFactor 1), locale decimal formatting, `stk`/free-text/null passthrough, fixed-scaling rows (unscaled but converted). Golden table of end-to-end cases (e.g. `600 g, ×1.5, us → "2 lb"`; `2 dl, ×1, us → "⅞ cup"` — exact expected strings computed in the plan, not guessed).
- **Repository test** (`__tests__/settings-repository.test.ts`): better-sqlite3 — default when unset, set/overwrite/read round-trip. Existing recipe-repository tests extend to cover the `scaling` column round-trip and its `linear` default on legacy rows (migration applied to a database created from the previous migration set).
- **Component test** (extends `__tests__/recipe-detail.test.tsx` mocking approach): control row renders; stepping 4 → 8 doubles a displayed linear quantity while a fixed row stays constant and shows the adjust-to-taste hint; toggling to US converts it and calls `setUnitSystem`; setting read on mount.
- Manual pass per `TESTING.md` on device: stepper feel, toggle persistence across app restart, Norwegian locale comma display.

## New dependencies

None.
