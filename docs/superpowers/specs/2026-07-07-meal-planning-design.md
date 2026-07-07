# Weekly Meal Planning — Design Spec

**Date:** 2026-07-07
**Slice:** Third feature slice of the Phase 1 local MVP (frontend only, no backend).
**Scope:** Assign recipes to days (rolling 7-day week), view the week at a glance on the Plan tab, tonight/tomorrow on the Today tab, and a "Plan it" entry point on recipe detail.
**Builds on:** recipe CRUD (`2026-07-05`), scaling & units (`2026-07-07`).

## Goals

- A user can plan dinners onto any of the next seven days, with a per-meal servings count, entirely offline (`USER_STORIES.md` §Meal Planning; `DESIGN.md` §3.2).
- The Today tab answers "what's for dinner tonight / tomorrow" (`DESIGN.md` §3.1).
- Planning a dinner costs 2 taps; the plan is the future source for shopping-list generation.

## Non-goals (deferred)

| Deferred item | Comes with |
|---|---|
| "Add week to shopping list" sticky CTA, ingredient aggregation | Shopping slice |
| Long-press drag between days, swipe-left to remove | Later polish slice (tap → entry sheet covers the flows now) |
| Household avatars on meal cards, co-planning | Phase 4 |
| Shopping glance card + partner activity on Today | Shopping slice / Phase 4 |
| Recipe-picker filter chips (Quick, Favourites…) | Need fields that don't exist yet |
| Week navigation / planning beyond 7 days | Later; rolling window sidesteps week-start locale logic |
| Plan history views (past days) | Past entries stay in the DB, just outside the window |

## Key decisions

1. **Local-date strings.** `meal_plan_entries.date` is a local `YYYY-MM-DD` text column. "Dinner on Tuesday" is a calendar fact, not an instant: strings compare lexicographically for the rolling window and eliminate the DST/timezone off-by-one bug class. A pure `lib/dates.ts` owns the string math.
2. **Rolling 7 days from today.** Today anchored on top (clay date token per `DESIGN.md` §3.2), then six more days. No navigation, no week-start locale handling.
3. **Multiple dinners per day.** A day stacks 1..n meal cards plus an add slot; `sort_order` orders within the day. The Today hero shows the day's first entry.
4. **Per-entry servings.** Each entry stores an integer servings count, defaulting to the recipe's servings at planning time. This is the number the shopping slice multiplies by.
5. **Hard delete for entries** (unlike recipes' soft delete). Planned dinners are transient facts; removing one is intent to erase. Phase 5 sync adds tombstones if its protocol needs them.
6. **Soft-deleted recipes make their entries invisible**, not broken: every read inner-joins `recipes` with `deleted_at IS NULL`, so entries pointing at deleted recipes drop out of all views. Rows are cleaned up implicitly only if the recipe row is ever hard-deleted (FK cascade); no cleanup job in this slice.
7. **Tap → entry sheet instead of gestures.** Tapping a meal card opens a small modal (servings stepper + Open/Move/Remove). Gesture-based drag/swipe layers on later without schema or flow changes; the sheet keeps everything headlessly testable.
8. **Modal routes for all pickers**, matching the `recipe/new` pattern.

## Data model

### `meal_plan_entries` (additive drizzle migration)
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | UUID, client-generated |
| `date` | text NOT NULL | local `YYYY-MM-DD`; indexed |
| `recipe_id` | text FK → recipes | `ON DELETE CASCADE` |
| `servings` | integer NOT NULL | ≥ 1 by stepper construction |
| `sort_order` | integer NOT NULL | position within the day |
| `created_at` | integer | epoch ms |
| `updated_at` | integer | epoch ms |

## Date utility

`lib/dates.ts` — pure functions over `YYYY-MM-DD` strings, no timezone surface, Node-testable:

- `todayLocal(now?: Date): string` — local calendar date.
- `addDays(date: string, n: number): string` — string-safe day arithmetic (month/year rollover correct).
- `rollingWeek(start: string): string[]` — `start` plus the next six dates.
- `dayLabel(date: string, today: string): { key: 'today' | 'tomorrow' | 'weekday'; weekdayIndex: number; dayOfMonth: number }` — screens map this to localized text (`plan.today`, `plan.tomorrow`, weekday names from the i18n files; no `Intl` dependency).

## Repository

`lib/db/mealPlan.ts` — writes only, transactional where multi-statement, `updated_at` maintained:

- `addPlanEntry(db, input: { date: string; recipeId: string; servings: number }): string` — `sort_order` = current max within `date` + 1.
- `movePlanEntry(db, id: string, toDate: string): void` — appends to the target day's order.
- `setPlanEntryServings(db, id: string, servings: number): void`
- `removePlanEntry(db, id: string): void` — hard delete.

Reads live in screens via `useLiveQuery`: entries with `date` in the rolling window, inner-joined to `recipes` (`deleted_at IS NULL`) for live titles, ordered by `date, sort_order`.

## Navigation & screens

- **Plan tab** (`app/(tabs)/plan.tsx`, replaces placeholder): vertical list of seven day sections from `rollingWeek(todayLocal())`. Each section: day header (Today/Tomorrow/weekday + date; today gets the clay date token), stacked meal cards (recipe title, servings line), and a dashed **"+ Add dinner"** slot → `/plan/add?date=<date>`. Tapping a meal card → `/plan/entry/<id>`.
- **Entry sheet** (`app/plan/entry/[id].tsx`, modal): recipe title, servings `Stepper` (writes through `setPlanEntryServings` immediately), actions: **Open recipe** (→ `/recipe/<recipeId>`), **Move to another day** (→ `/plan/pick-day?entry=<id>`), **Remove** (removes, closes; no confirmation — one entry, instantly re-plannable, not destructive to data that took effort). Missing/stale id → back.
- **Recipe picker** (`app/plan/add.tsx`, modal, `?date=` required): search field reusing `filterRecipes` over live recipes; tappable rows (title + servings). Selecting a row reveals a bottom bar: servings `Stepper` preset to the recipe's servings + **Add** button → `addPlanEntry`, close. Empty recipe collection → the recipes empty state copy with a "create recipe" action → `/recipe/new`.
- **Day picker** (`app/plan/pick-day.tsx`, modal, dual-mode): seven rows (same labels as the Plan tab). `?recipe=<id>` → `addPlanEntry` with the recipe's default servings, close (used by "Plan it"). `?entry=<id>` → `movePlanEntry`, close (used by Move). Unknown/missing params or ids → back.
- **Today tab** (`app/(tabs)/index.tsx`, replaces placeholder): **Tonight** — hero card for today's first entry (title, servings, tap → recipe detail); additional same-day entries as compact rows beneath. **Tomorrow** — peek list of tomorrow's titles. Nothing planned today → calm empty card ("Nothing planned tonight") with a **"Plan your week"** action → Plan tab. Same for an entirely empty plan.
- **Recipe detail** (`app/recipe/[id]/index.tsx`): sticky bottom bar with a full-width clay **"Plan it"** `Button` (≥56 pt, respects bottom inset) → `/plan/pick-day?recipe=<id>`.

## i18n

New keys in **both** `en.json` and `nb.json` (key-symmetry test enforces):

- `days.0` … `days.6` — weekday names, Monday-first indexing (`dayLabel.weekdayIndex` follows ISO: 0 = Monday).
- `plan.*`: `title`, `addDinner`, `pickRecipeTitle`, `pickDayTitle`, `add`, `openRecipe`, `moveDay`, `remove`, `today`, `tomorrow`.
- `today.*`: `tonight`, `tomorrow`, `nothingTonight`, `planWeek`.
- `detail.planIt`.
- Servings lines reuse `recipes.servingsCount`.

## Validation & edge cases

- Same recipe plannable multiple times per day — two entries, both valid.
- Servings ≥ 1 by `Stepper` construction; picker preset to the recipe's servings.
- Entries for past dates persist in the DB but fall outside every view's window.
- Soft-deleted recipe → its entries vanish from Plan/Today/entry sheet (join filter); entry sheet on such an id redirects back.
- `/plan/add` without a valid `date` param, or any picker/sheet route with unknown ids → back (mirrors the recipe screens' missing-id redirect convention).
- All-empty week: no special empty state on the Plan tab — the seven dashed add slots are the empty state (`DESIGN.md` §3.2).
- DB write failures surface as the established butter-toned notice pattern where a screen owns a write (entry sheet, pickers); reads are live queries.

## Testing

- **Node tests:** `lib/dates.ts` (today/addDays across month & year boundaries, rollingWeek shape, dayLabel today/tomorrow/weekday indexing) — pass explicit `Date` values, no clock mocking.
- **Repository tests** (better-sqlite3, real migrations): add (sort_order assignment), move (appends to target day), setServings, remove; window query joins exclude soft-deleted recipes.
- **Component tests** (established `useLiveQuery`/router mocking): Plan tab renders 7 day sections with today label + add slots, card tap routes to entry sheet; Today tab hero/tomorrow/empty states; recipe picker search + add flow calls `addPlanEntry`; day picker in both modes; entry sheet stepper/remove.
- **Manual pass** (deferred to device): appended to `TESTING.md` — plan a dinner in 2 taps, move/remove via sheet, tonight/tomorrow on Today, Norwegian labels, plan survives relaunch.

## New dependencies

None.
