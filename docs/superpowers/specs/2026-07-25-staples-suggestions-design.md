# Staples Suggestions — Design Spec

**Date:** 2026-07-25
**Slice:** Phase 7 slice ① (of three: ① staples suggestions, ② recipe suggestions when planning, ③ habits overview). The vision doc's "reuse previous shopping habits with minimal effort" made actionable: the app notices what you buy regularly and quietly offers it when it's probably due.
**Scope:** a pure staples heuristic over purchase history, a quiet dismissible suggestion section on the Shop tab, dismiss persistence. Frontend only; read-only over existing data.
**Builds on:** `shopping_items` purchase history (`status = 'purchased'`, `purchasedAt`, `normalizedName` — synced since Phase 5), the `addItems` merge path, the settings key-value store, the `notDeleted()` predicate, i18n nb/en parity.

## Goals

- When a staple is probably due, adding it costs one tap from the screen you're already on.
- The section is quiet: it renders nothing when nothing is due, never toasts, never notifies.
- Zero schema changes, zero sync impact, zero backend work: purchases already sync, so both household devices independently derive the same suggestions; dismissals stay per-device.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Recipe suggestions when planning | Phase 7 slice ② |
| Habits overview screen | Phase 7 slice ③ |
| Co-purchase "forgotten something" nudge | Dropped (user decision) |
| Synced dismissals | Never planned — a dismissal is a personal "stop asking" |
| Quantity/unit suggestions ("2 L melk") | Suggest the name only; quantity is a store-side decision |
| ML/external services | Never — local heuristics only (bilingual-safe by construction) |

## Key decisions

1. **The staple heuristic is a pure function** in `lib/suggestions/staples.ts`, operating on `{ normalizedName, name, purchasedAt }` rows (purchased, non-tombstoned):
   - Group by `normalizedName` (case/whitespace-normalized already — language-neutral, no parsing).
   - An item is a **staple** when it has ≥ 3 purchases. Its **typical interval** is the median gap between consecutive purchase timestamps (median resists one vacation gap). Groups whose median gap is under 1 day (several buys in one shopping event — same-trip noise, not a cadence) or over 60 days (not habitual enough to predict) are ignored.
   - A staple is **due** when `now - lastPurchasedAt ≥ 0.8 × typicalInterval`.
   - Rank by overdueness ratio (`elapsed / typicalInterval`, descending); cap at 5 suggestions.
   - Display name: the most recent purchase's `name` (freshest casing/spelling).
2. **Exclusions applied by the caller layer:** items whose `normalizedName` is currently on the active list (any active row, tombstone-filtered) are excluded — you already have it; dismissed items are excluded until re-purchased (below).
3. **Dismissals are device-local**, stored in the settings table under one key `staple_dismissals` as a JSON map `{ [normalizedName]: dismissedAtEpochMs }` (same never-sync comment as `color_mode`). A dismissal expires automatically when the item has a purchase newer than the dismissal timestamp — buying it again re-opens the habit. Accessors in `lib/suggestions/dismissals.ts` following the `lib/db/settings.ts` idiom; the map is pruned of expired entries on write.
4. **Surface:** `components/shop/StaplesSection.tsx`, rendered on the Shop tab under the active list (above the purchased shelf). Title `suggestions.staplesTitle` ("Do you need…?" / "Trenger dere…?"), items as chips: tap the chip body → `addItems(db, [{name, normalizedName, quantity: null, unit: null, sources: []}], 'merge')` (aggregates and syncs like any manual add — and its `scheduleSync` fires); tap the chip's small × → dismiss. When no suggestions: render `null` — no header, no empty state, nothing.
5. **Reactivity:** the section derives from a `useLiveQuery` over purchased shopping rows and one over active rows (both `notDeleted`-filtered), plus dismissals read at render; adding or dismissing updates the section immediately (add → the item becomes active → excluded; dismiss → local state bump + persisted).
6. **Copy (nb + en, `suggestions.*` keys):** section title; chip accessibility labels ("Add <name>" / "Legg til <name>", "Dismiss <name>" / "Avvis <name>"). No other UI text.
7. **Testing:** heuristic unit tests — grouping, 3-purchase minimum, median interval with an outlier gap, 60-day cap, 0.8 due threshold, overdueness ranking, cap at 5, display-name freshness; dismissal tests — persist/read, expiry-on-repurchase, prune; section tests — renders due staples, add flows through `addItems` and the item leaves the section, dismiss hides and persists, renders nothing when empty, active-list exclusion; existing shop-screen tests pass UNTOUCHED. Full pass: suite, lint zero warnings, `tsc`, android export.

## Components

- `lib/suggestions/staples.ts` — types + `computeStaples(rows, now): StapleSuggestion[]` (pure).
- `lib/suggestions/dismissals.ts` — `getStapleDismissals(db)`, `dismissStaple(db, normalizedName)`, expiry/prune logic.
- `components/shop/StaplesSection.tsx` — the surface.
- `app/(tabs)/shop.tsx` — mounts the section between the active list and the shelf.
- `lib/i18n/{nb,en}.json` — `suggestions.*` keys.
- Tests: `__tests__/staples-heuristic.test.ts`, `__tests__/staples-dismissals.test.ts`, `__tests__/staples-section.test.tsx`.

## Error handling

None beyond the norm: pure derivation over local data; a malformed dismissals JSON parses to an empty map (same defensive pattern as `parseSources`).

## Testing

Per decision 7. The headline property: a suggestion appears only when history genuinely predicts it (three purchases, habitual cadence, due now, not on the list, not dismissed).

## Rollout

Feature branch `feature/staples-suggestions` off `develop`. No migration, no new dependencies, no backend contact. Manual checklist appended to `docs/TESTING.md` (needs seeded purchase history — note that `purchasedAt` timestamps can be back-dated via the sample-data dev seed or SQLite browser for testing).
