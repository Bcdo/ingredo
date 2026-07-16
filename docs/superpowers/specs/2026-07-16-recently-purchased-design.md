# Recently Purchased — Design Spec

**Date:** 2026-07-16
**Slice:** Fifth feature slice of the Phase 1 local MVP (frontend only, no backend). Completes the Phase 1 roadmap.
**Scope:** Turn the Shop tab's flat "Recently purchased" shelf into the designed staples library: time-grouped history (this trip · earlier this week · earlier), deduped one-card-per-item display, and age-split tap semantics (undo vs. quick re-add).
**Builds on:** shopping list (`2026-07-15`) — `shopping_items` rows with `status`/`purchased_at`, `itemKey` bucketing, `restoreItem`, `addItems` merge mode.

## Goals

- The shelf answers "did we already buy parmesan?" at a glance — purchases grouped by recency, each item shown once (`DESIGN.md` §3.6 jobs 1–3; `UX_NOTES.md` §Recently Purchased Purpose).
- Staples re-add in one tap without erasing their purchase history; a genuine mis-tap still undoes cleanly.
- Purchase history is never deleted — it is the raw material for Phase 6 (frequency suggestions).

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| "Buy again" suggestion row (most frequently purchased) | Phase 6 (roadmap: Suggestions / Frequently purchased / Shopping habits) |
| Person attribution on shelf items | Phase 4 (households) |
| Clear-shelf / history pruning | Not planned — history is an asset; the deduped display keeps the shelf tidy regardless of row count |
| Schema changes | None needed — `status` + `purchased_at` already carry everything |

## Key decisions

1. **One card per item.** The shelf displays purchased rows deduped by `itemKey` (same normalized-name + unit-bucket key used everywhere), keeping each key's most recent purchase (max `purchased_at`). Older duplicate rows remain in the DB as history but never render. The shelf reads as a staples library, not a log.
2. **Items with an active row are hidden from the shelf.** If milk is already on the list, a shelf card for it would be a confusing tap target (re-add would double quantities). Exclusion is by `itemKey` against the active set. Corollary: after any tap (undo or re-add) the item gains an active row and drops off the shelf display.
3. **Fixed time windows, clock injected.** "This trip" = `purchased_at` within the last 6 hours; "Earlier this week" = last 7 days; "Earlier" = older. A pure function takes `now` as an argument — no hidden `Date.now()` in the grouping logic. Empty groups don't render.
4. **Tap semantics split by group.**
   - **This trip → undo (move):** the existing `restoreItem` — the row flips back to active, quantity intact, shelf entry gone. A mis-tap correction leaves no bogus history.
   - **Earlier this week / Earlier → quick re-add (copy):** new `readdItem` creates a fresh active item copying `name`/`normalizedName`/`quantity`/`unit`; `sources` is emptied (stale recipe attribution would mislead in the aisle); the purchased row is untouched, so history survives. Written through `addItems(..., 'merge')` so an unexpected active twin merges instead of duplicating.
5. **Undo resurfacing quirk accepted:** undoing the newest purchase of an item lets its next-newest history row resurface on the shelf (in whatever group its age puts it). Coherent — the history genuinely exists — and self-explanatory in use.
6. **Display order:** within each group, `purchased_at` desc. Group order: trip, week, older.

## Components

### `lib/shelf.ts` (new, pure)

- `THIS_TRIP_MS = 6 * 60 * 60 * 1000`, `WEEK_MS = 7 * 24 * 60 * 60 * 1000` — exported constants.
- `groupShelfItems(purchasedRows, activeKeys: Set<string>, now: number)` → `{ trip: Row[]; week: Row[]; older: Row[] }`:
  1. dedupe `purchasedRows` by `itemKey`, keeping max `purchased_at`;
  2. drop rows whose key is in `activeKeys`;
  3. bucket by `now - purchased_at` against the two windows;
  4. sort each bucket by `purchased_at` desc.
- Imports `itemKey` from `lib/shopping.ts`; no DB, no i18n, no clock.

### `lib/db/shoppingList.ts` (modified)

- Add `readdItem(db, id): void` — load the row by id; if found, `addItems(db, [{ name, normalizedName, quantity, unit, sources: [] }], 'merge')`. The source row is not modified. Missing id is a no-op.

### `app/(tabs)/shop.tsx` (modified)

- The existing purchased live query already returns all purchased rows; the active live query already exists — derive `activeKeys` from it.
- Shelf section: keep the "Recently purchased" heading; render the three groups from `groupShelfItems(purchased, activeKeys, Date.now())` with subheadings `shop.groupTrip` / `shop.groupWeek` / `shop.groupOlder`, omitting empty groups; card styling unchanged (dashed outline).
- Tap dispatch: trip-group cards call `restoreItem`; week/older cards call `readdItem`. `LayoutAnimation` on both, as today.

### i18n (`en.json` / `nb.json`)

- `shop.groupTrip`: "This trip" / "Denne turen"
- `shop.groupWeek`: "Earlier this week" / "Tidligere denne uken"
- `shop.groupOlder`: "Earlier" / "Tidligere"

## Error handling

Repository writes are synchronous SQLite like everything else; the Shop tab has no notice pattern and lets failures throw (RedBox in dev), matching the shopping-list spec.

## Testing

- `lib/shelf.ts` unit tests: dedupe keeps newest per key; active-key exclusion; window boundary cases (exactly 6h / 7d fall to the older side); group sort order; empty input.
- Repository tests: `readdItem` creates a fresh active copy (quantity/unit intact, sources `[]`), leaves the purchased row untouched, merges into an existing active twin, no-ops on missing id.
- Screen tests: group subheadings render (clock-sensitive rows fixed relative to a mocked/frozen reference); trip-group tap calls `restoreItem`; older-group tap calls `readdItem`; item with an active twin absent from the shelf.
- Full pass: suite, lint zero warnings, `tsc`, android bundle export; manual checklist appended to `docs/TESTING.md`.
