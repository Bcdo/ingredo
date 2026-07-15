# Shopping List — Design Spec

**Date:** 2026-07-15
**Slice:** Fourth feature slice of the Phase 1 local MVP (frontend only, no backend).
**Scope:** A persistent shopping list on the Shop tab with the no-checkbox purchase interaction and a minimal Recently Purchased shelf; items arrive via the Plan-tab "Add week" CTA, the recipe-detail "Add ingredients" button, and a quick-add bar.
**Builds on:** recipe CRUD (`2026-07-05`), scaling & units (`2026-07-07`), meal planning (`2026-07-07`).

## Goals

- Planning becomes shopping in one tap: the Plan tab's sticky CTA aggregates the week's ingredients, merged and de-duplicated, onto the shopping list (`DESIGN.md` §3.2; `USER_STORIES.md` §Shopping).
- In the store, purchasing is one tap on a full-width card — no checkboxes, whole card is the target — and undo is one tap on the shelf below (`DESIGN.md` §3.5, `UX_NOTES.md`).
- Recipe detail can push its (scaled) ingredients to the list, excluding ones the user already has; manual items are one typed word away.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Store categories, walking-order grouping, auto-categorization (needs a bilingual keyword map) | Categories slice |
| Full Recently Purchased: time grouping ("this trip · earlier this week"), history jobs | Recently Purchased slice |
| "Put back" toast after purchase | Later polish (the shelf on the same screen is the undo path) |
| Editing an item's name/quantity in place | Later; delete+re-add covers Phase 1 |
| Sage bloom/glide purchase choreography | Later polish; this slice uses `LayoutAnimation` |
| Long-press recipe-card quick sheet ("Add ingredients to list") | Later polish slice |
| Today-tab shopping glance card | Later slice (local version) or Phase 4 (household version) |
| Partner avatars, live presence, shared lists | Phase 4 |
| Suggestions / frequently purchased | Phase 6 |

## Key decisions

1. **Persistent snapshot list, not a derived view.** A `shopping_items` table is the single source of truth; entry points write into it; the Shop tab renders it. The list stays stable while shopping even if the plan changes afterwards. Manual items, purchases, and the future Recently Purchased slice all fall out naturally. (Rejected: deriving the list live from the plan — tombstone bookkeeping for purchases/removals, and it kills the keystone one-tap action.)
2. **Merge key = `normalized_name` + unit dimension.** `normalized_name` is `name.trim().toLowerCase()`. Same-dimension quantities (via `CANONICAL_MEASURES`: mass, volume; `stk` counts as its own dimension; `null` unit is its own bucket; unknown free-text units bucket by exact unit string) convert to base units and sum. Mismatched dimensions stay separate rows. No singular/plural or language folding ("tomat" ≠ "tomater") per the bilingual no-language-parsing rule.
3. **Plan CTA skips existing keys; detail/quick-add merge-sum.** "Add week" adds only aggregated ingredients whose key has no *active* row — tapping it twice is a no-op (`DESIGN.md` §3.2 "skips what's already listed"). Recipe-detail add and quick-add instead merge into an existing active row (sum quantity where dimensions allow, append source); adding butter when butter is listed bumps it rather than duplicating or vanishing.
4. **Scaling before merging.** Plan aggregation scales each recipe's `linear` ingredients by `entry.servings / recipe.servings`; `fixed` ingredients contribute their quantity as-is per entry. Recipe-detail add uses the screen's current `scaleFactor` (existing state) the same way. Quantities are stored in canonical base units (g / ml / stk / original free-text unit); display formatting reuses `displayQuantity` with the household unit-system setting, so US ⇄ metric keeps working.
5. **Purchased is a status, not a deletion.** Tapping an active card sets `status='purchased'` + `purchased_at`; the shelf renders purchased items (most recent first); tapping a shelf item restores it (`status='active'`, `purchased_at=null`), quantity intact. Rows are hard-deleted only by a future clear-shelf action (not in this slice) — the shelf may grow; acceptable for Phase 1.
6. **Provenance travels with the item.** `sources` holds the contributing recipe titles (deduped, insertion order; empty for manual items) and renders as the card subtitle ("Kikertcurry · Fredagsgryte") so substitutions can be judged in the aisle. Stored denormalized (JSON text column) — titles at add-time are a snapshot, which matches the snapshot model.
7. **Soft-deleted recipes:** aggregation reads plan entries through the same live-recipe inner join the plan screens use, so deleted recipes never contribute ingredients. Already-added items keep their snapshot (by design).
8. **Flat list order:** active items by `created_at` (insertion order — stable under merges, which only update quantity/sources); shelf by `purchased_at` desc.

## Data model

### `shopping_items` (additive drizzle migration)

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `newId()` |
| `name` | text | Display casing from first contributor |
| `normalized_name` | text | trim+lowercase; indexed with `status` for merge lookups |
| `quantity` | real, nullable | In base units (g / ml / stk / free-text unit's own scale); null = "to taste" |
| `unit` | text, nullable | Base unit code (`g`, `ml`, `stk`), a free-text unit string, or null |
| `sources` | text | JSON array of recipe titles; `[]` for manual items |
| `status` | text | `'active'` \| `'purchased'` |
| `purchased_at` | integer, nullable | epoch ms; set on purchase, cleared on restore |
| `created_at` / `updated_at` | integer | epoch ms |

## Components

### `lib/shopping.ts` (new, pure)

- `aggregatePlanIngredients(entries)` — takes the `(recipe servings, entry servings, ingredients[])` rows for the same rolling 7-day window the Plan tab renders (today + 6, via `lib/dates.ts`) and returns merged `AggregatedItem[]` `{ name, normalizedName, quantity: number|null, unit: string|null, sources: string[] }` per Key decisions 2–4. Also used to compute the CTA count.
- `scaleIngredient(ingredient, factor)` and `toBase(quantity, unit)` helpers as needed — reusing `CANONICAL_MEASURES` from `lib/units.ts`; no duplication of conversion tables.

### `lib/db/shoppingList.ts` (new repository)

- `getShoppingItems(db)` split by status (or two query helpers) — screens use drizzle live queries directly, mirroring existing screens.
- `addItems(db, items: AggregatedItem[], mode: 'skip-existing' | 'merge')` — implements Key decision 3 in one transaction; returns count added/merged.
- `addManualItem(db, name)` — quantity-less active item (merges per `'merge'` mode).
- `purchaseItem(db, id)` / `restoreItem(db, id)` — status flips per Key decision 5.

### `app/(tabs)/shop.tsx` (rewritten from placeholder)

- Quick-add `TextInput` pinned top (submit → `addManualItem`, clears input; blank input is a no-op).
- Active section: full-width cards (≥56pt) — name, clay quantity (`displayQuantity` + unit-system setting), sources subtitle when non-empty. Whole card tappable → `purchaseItem` with a `LayoutAnimation` transition.
- "Recently purchased" shelf below: compact dashed-outline cards, tap → `restoreItem`.
- Empty state (no items at all) per the app's `EmptyState` pattern.

### `app/(tabs)/plan.tsx` (modified)

- Sticky bottom sage CTA "Add week to shopping list · N ingredients"; N = count from `aggregatePlanIngredients` minus keys already active; hidden when N = 0. Tap → `addItems(..., 'skip-existing')`; the live count collapsing to 0 hides the CTA (that is the confirmation).

### `app/recipe/[id]/index.tsx` (modified)

- Ingredient rows become tappable to toggle per-row exclusion (dimmed style, local state, resets on leave).
- "Add N ingredients to shopping list" button below the ingredients block; N = non-excluded rows. Tap → scale by current `scaleFactor`, `addItems(..., 'merge')`, brief butter-notice confirmation reusing the screen's existing notice pattern.

### i18n

All new user-facing strings in both `en.json` and `nb.json`: shop title/empty state/quick-add placeholder/shelf heading, plan CTA (with count interpolation), detail add-button (with count), confirmation notices.

## Error handling

Synchronous SQLite through the repository layer, as everywhere else. Screens with an existing butter-notice pattern surface write failures through it; otherwise failures throw (RedBox in dev). No bespoke handling.

## Testing

- `lib/shopping.ts` unit tests: linear scaling by servings ratio; fixed ingredients unscaled; same-dimension summing across units (dl+l, g+kg, ts+ss); dimension mismatch → separate rows; null-quantity merging; free-text unit exact-match bucketing; name normalization (case/whitespace, no plural folding).
- Repository tests (in-memory DB): add with `skip-existing` twice is a no-op; `merge` sums quantities and appends sources; manual add; purchase/restore round-trip preserves quantity; soft-deleted recipe's ingredients excluded from aggregation input query.
- Screen tests: Shop tab renders sections, quick-add flow, tap-to-purchase and tap-to-restore wiring; Plan CTA shows correct count, hides at 0, calls the repository; detail exclusion toggling adjusts N and the written set.
- Full pass: suite, lint zero warnings, `tsc`, android bundle export; manual checklist appended to `docs/TESTING.md`.
