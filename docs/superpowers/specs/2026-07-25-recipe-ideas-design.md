# Recipe Ideas — Design Spec

**Date:** 2026-07-25
**Slice:** Phase 7 slice ② (of three: ① staples suggestions ✅, ② recipe ideas, ③ habits overview). "What should we make?" answered from your own history: an ideas rail in the add-to-plan flow surfacing often-cooked favorites and dishes you haven't had in a while.
**Scope:** a pure ideas heuristic over meal-plan history, a quiet horizontal rail in `app/plan/add.tsx`, i18n. Frontend only; read-only over existing data.
**Builds on:** `meal_plan_entries` history (recipeId, date, tombstones — synced), the plan-add picker's existing select flow, `notDeleted()`, i18n nb/en parity, the `suggestions.*` key group from slice ①.

## Goals

- Planning a meal starts with two good defaults from your own cooking history — zero typing.
- The rail is quiet: absent while searching, absent entirely when history has nothing to say, and tapping it behaves exactly like tapping the recipe in the list (select → servings footer), no shortcut semantics.
- Zero schema changes, zero sync impact, zero backend work; young collections see no difference.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| Habits overview screen | Phase 7 slice ③ |
| Dismissals for ideas | Not planned — ignoring a passive rail costs nothing (unlike the staples chips, which occupy list space every trip) |
| Ingredient-aware ideas ("you have flour") | Out of scope — pantry state isn't tracked |
| Live reactivity of the rail | Deliberate: one-shot history read on mount; the modal lives seconds (approach decision below) |
| ML/external services | Never — local heuristics only |

## Key decisions

1. **One-shot history read, pure heuristic.** `lib/suggestions/recipeIdeas.ts` exports `getPlanHistory(db)` (non-tombstoned `meal_plan_entries` as `{recipeId, date}` rows, one `.all()` read on screen mount) and the pure `computeRecipeIdeas(history, recipeIds, targetDate, today)`. No live query: a modal's lifetime is seconds, and staying query-free keeps the existing plan-add tests' mock structure intact (one small disclosed mock addition).
2. **Two idea kinds, merged:**
   - **Often cooked** (`kind: 'favorite'`): planned ≥ 2 times AND last planned more than 7 days before `today` (never suggest what you just had), ranked by times-planned descending, ties by staleness descending.
   - **It's been a while** (`kind: 'while'`): planned ≥ 1 time AND last planned ≥ 21 days before `today`, ranked by staleness descending.
   Merge favorites first, then rediscoveries, deduplicated by recipeId (a recipe qualifying for both appears once, as a favorite), capped at **6**.
3. **Exclusions:** recipes already planned on the **target date** (you don't plan the same dish twice in a day); recipes not in the picker's item list (deleted recipes drop out by construction — `computeRecipeIdeas` takes the picker's recipe ids as its universe). Dates compare as `yyyy-MM-dd` strings (the schema's format; string comparison is chronological).
4. **Surface:** `components/plan/IdeasRail.tsx`, rendered between the search box and the recipe list in `app/plan/add.tsx`, ONLY when the search query is empty and ideas exist. A small heading (`suggestions.ideasTitle`: "Forslag" / "Ideas") and a horizontal scroll of chips: recipe title (2-line clamp) over a tiny reason caption (`suggestions.reasonFavorite`: "Ofte laget" / "A favorite"; `suggestions.reasonWhile`: "Lenge siden sist" / "It's been a while"). Tap → the screen's existing `select(item)` — identical behavior to tapping the list row. No ideas or active search → the rail renders nothing.
5. **Testing:** heuristic unit tests — favorite threshold (≥2) and 7-day recency exclusion, while threshold (21-day staleness), dedup-prefers-favorite, target-date exclusion, universe filtering, ranking within and across kinds, cap 6, string-date boundary math; rail tests — renders both kinds with captions, tap fires onSelect with the item, renders nothing when empty; plan-add screen keeps working with ONE disclosed mock addition (`jest.mock` of `lib/suggestions/recipeIdeas` returning empty history/ideas) — no other changes to existing tests. Full pass: suite, lint zero warnings, `tsc`, android export.

## Components

- `lib/suggestions/recipeIdeas.ts` — `PlanHistoryRow`, `RecipeIdea { recipeId, kind: 'favorite' | 'while' }`, `getPlanHistory(db)`, `computeRecipeIdeas(history, recipeIds, targetDate, today)`.
- `components/plan/IdeasRail.tsx` — props `{ ideas: RecipeIdea[], items: PickerItem-like[], onSelect(item) }`; resolves titles from the picker items; horizontal chips.
- `app/plan/add.tsx` — mount: one-shot `getPlanHistory` in a `useMemo`, `computeRecipeIdeas` over the picker items, rail hidden while `query !== ''`.
- `lib/i18n/{nb,en}.json` — `suggestions.ideasTitle`, `suggestions.reasonFavorite`, `suggestions.reasonWhile`.
- Tests: `__tests__/recipe-ideas-heuristic.test.ts`, `__tests__/ideas-rail.test.tsx`; one disclosed mock line in `__tests__/plan-add.test.tsx`.

## Error handling

None beyond the norm — pure derivation over local data.

## Testing

Per decision 5. The headline property: the rail proposes only dishes your history genuinely supports, never today's dish, never something you had this week (favorites), and disappears completely rather than showing weak suggestions.

## Rollout

Feature branch `feature/recipe-ideas` off `develop`. No migration, no dependencies, no backend contact. Manual checklist appended to `docs/TESTING.md` (plan history is easy to fabricate by planning entries on past dates via back-dated `date` values).
