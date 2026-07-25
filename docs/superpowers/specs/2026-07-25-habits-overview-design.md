# Habits Overview — Design Spec

**Date:** 2026-07-25
**Slice:** Phase 7 slice ③ — the roadmap's final slice. A small, fun stats screen: what your household actually cooks and buys, from local history.
**Scope:** a pure aggregation function, a modal screen opened from Settings, i18n. Frontend only; read-only over existing data.
**Builds on:** live recipes, `meal_plan_entries` and purchased `shopping_items` history (all synced), the modal-screen pattern (`app/settings.tsx` + root-Stack registration), the freshest-name-by-`normalizedName` display trick from the staples slice, i18n nb/en parity.

## Goals

- One glanceable screen answering "what do we actually cook and buy?" — three totals, top-5 most-cooked, top-5 most-bought.
- Passive and quiet: reached deliberately via Settings, no chrome anywhere else, honest zeros for young data.
- Zero schema changes, zero sync impact, zero backend work.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Planning streaks | Dropped (user decision — streaks guilt-trip) |
| Time-windowed stats ("this month") | All-time only; windows are YAGNI until asked for |
| Charts/graphs | Numbers and lists only — no charting dependency |
| Tapping a stat to navigate | Not planned; the screen is a leaf |
| Live reactivity | One-shot reads on mount (modal lives seconds; same rationale as the ideas rail) |

## Key decisions

1. **Pure aggregator** `computeHabits(recipes, planEntries, purchases)` in `lib/suggestions/habits.ts` (sibling to the two existing heuristics; language-neutral — ids, names, counts):
   - `totals`: `recipeCount` (live recipes), `plannedCount` (non-tombstoned plan entries, all-time incl. future), `purchasedCount` (purchased non-tombstoned shopping rows).
   - `topRecipes`: top **5** by times-planned, joined to live recipe titles — entries whose recipe is deleted are excluded from this list (but still count in `plannedCount`). Shape `{ title, count }`.
   - `topItems`: top **5** by purchase count grouped by `normalizedName`, displayed with the most recent purchase's `name`. Shape `{ name, count }`.
   - Ranking ties break alphabetically by display name (deterministic across devices).
2. **Screen** `app/habits.tsx`: modal like Settings (root-Stack registration with `presentation: 'modal', headerShown: false` — the established pattern), title + close button header, then: the totals row (three big display-font numbers with small captions, always shown — zeros included), "Most cooked" list (`title × count`), "Most bought" list (`name × count`). Each top-list section renders only when non-empty. Data: one-shot reads in a `useMemo` on mount (recipes `notDeleted` id+title; plan entries `notDeleted` recipeId; shopping rows `status='purchased'` + `notDeleted` normalizedName/name/purchasedAt).
3. **Entry point:** a "Vaner" / "Habits" navigation row at the bottom of `app/settings.tsx` (below the Language section), house row styling, `router.push('/habits')`.
4. **Copy (nb + en, `habits.*` keys):** screen title ("Vaner" / "Habits"), totals captions ("Oppskrifter" / "Recipes", "Måltider planlagt" / "Meals planned", "Varer kjøpt" / "Items purchased"), section titles ("Mest laget" / "Most cooked", "Mest kjøpt" / "Most bought"), count format `habits.times` ("× %{count}").
5. **Testing:** aggregator unit tests — totals counting incl. tombstone exclusion, deleted-recipe exclusion from topRecipes but not plannedCount, normalizedName grouping + freshest-name display, top-5 caps, alphabetical tie-break; screen test — totals + both lists render from fixtures, empty lists hidden, zeros shown; settings test gains the nav-row assertion (existing assertions untouched); i18n parity. Full pass: suite, lint zero warnings, `tsc`, android export.

## Components

- `lib/suggestions/habits.ts` — types + `computeHabits(...)` (pure) + one-shot readers `getHabitsData(db)` (the three queries).
- `app/habits.tsx` — the screen.
- `app/_layout.tsx` — Stack.Screen registration for `habits` (modal, headerShown false).
- `app/settings.tsx` — the navigation row.
- `lib/i18n/{nb,en}.json` — `habits.*` keys.
- Tests: `__tests__/habits.test.ts` (aggregator + readers on the test DB), `__tests__/habits-screen.test.tsx`, one nav-row addition to `__tests__/settings-screen.test.tsx`.

## Error handling

None beyond the norm — pure derivation over local data.

## Testing

Per decision 5. The headline property: the numbers are honest — tombstones never count, deleted recipes vanish from the list but not from history totals, and grouping never mixes distinct items.

## Rollout

Feature branch `feature/habits-overview` off `develop`. No migration, no dependencies, no backend contact. Manual checklist appended to `docs/TESTING.md`. This completes Phase 7 — and with it, the original roadmap.
