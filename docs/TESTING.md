# Testing Strategy

## Goal

Use tests where they provide clear value, especially for logic that would be tedious or risky to manually test repeatedly.

## Test Stack

- Jest
- React Native Testing Library

Expo officially documents Jest-based testing, so Jest is preferred for this project.

## What to Test Early

### Recipe Scaling

Example:

```text
Original servings: 2
Target servings: 4
200g chicken → 400g chicken
```

### Unit Conversion

Examples:

```text
1 cup → 240 ml
1 tbsp → 15 ml
1 tsp → 5 ml
1 oz → 28 g
```

### Shopping List Generation

Test:

- Add ingredients from recipe
- Skip ingredients user already has
- Merge duplicates if implemented
- Preserve quantities and units

## What to Test Later

### Offline Sync

Test:

- Offline actions are queued
- Actions retry when online
- Duplicate actions are avoided
- Sync failures do not lose local data

### Conflict Resolution

Test:

- Last write wins
- Soft-deleted records stay deleted
- Concurrent changes behave predictably

## Manual Testing

Manual testing happens in the GitHub Project Review column.

Checklist:

- Android
- iOS if available
- Offline mode
- Online mode
- Empty states
- Longer text
- Small screen layout

## Testing Rule

Every utility function should have tests.

Every sync-related feature should have tests.

Simple UI screens can be tested manually at first.

## Recipe scaling & unit conversion (manual pass)

- Open a recipe → step servings up/down → quantities rescale in place; leaving and reopening resets to saved servings.
- Toggle Metric/US → quantities convert (fractions on US); kill and relaunch the app → the toggle choice is remembered.
- Mark an ingredient "Fixed amount" in the edit form → save → scale the recipe → that row stays constant and shows the "adjust to taste" hint.
- Norwegian device language: decimals show commas ("1,5 dl"); all new labels localized.

## Weekly meal planning (manual pass)

- Plan tab shows today (clay token) plus the next six days; every day ends with a dashed "+ Add dinner" slot.
- Plan a dinner in 2 taps: add slot → pick recipe → Add. It appears under the right day and on Today (if planned for today).
- Tap a meal card → entry sheet: change servings (persists), Move to another day, Remove.
- Recipe detail → "Plan it" → pick a day → entry lands in the plan with the recipe's servings.
- Today tab: tonight hero opens the recipe; tomorrow peek lists tomorrow's dinners; empty state's "Plan your week" jumps to the Plan tab.
- Soft-delete a planned recipe → its plan entries disappear everywhere.
- Norwegian device language: day names, all plan/today labels localized.
- Kill and relaunch — the plan persists.

## Shopping list (manual pass)

- Plan a few dinners, open Plan tab → sage CTA shows "Add week to shopping list · N ingredients"; tap → items land on the Shop tab, CTA disappears; tapping into Plan again shows no CTA (nothing new to add).
- Two recipes sharing an ingredient (e.g. kjøttdeig in Tacos + Kjøttkaker) produce ONE list item with the summed quantity and both recipe names as subtitle.
- An ingredient in grams in one recipe and stk in another produces two separate rows.
- Shop tab: tap an item card → it moves to the "Recently purchased" shelf; tap it on the shelf → it comes back with the quantity intact.
- Quick-add: type an item, return → appears in the list; typing the same name again merges instead of duplicating; input stays if blank.
- Recipe detail: bump servings, tap two ingredient rows to exclude (they dim), tap "Add N ingredients…" → sage notice, items on the Shop tab reflect the scaled quantities; excluded rows absent.
- Adding the same recipe's ingredients twice doubles quantities on the list (merge mode), while re-tapping the Plan CTA never duplicates.
- US units toggle on recipe detail: shopping list still shows sensible amounts (base metric stored, US displayed when toggled).
- Norwegian device language: all shop/plan/detail strings localized.
- Kill and relaunch — list and shelf persist.

## Recently purchased shelf (manual pass)

- Buy a few items → they land under "This trip"; tapping one there is an undo: it returns to the list and leaves no shelf entry behind.
- An item purchased earlier (>6h: "Earlier this week"; >7d: "Earlier") re-adds on tap: it appears on the list with its old quantity, no recipe subtitle, and its history row survives (purchase it again → it's back on the shelf).
- An item bought several times appears exactly once on the shelf, in the group of its most recent purchase.
- An item currently on the active list never shows on the shelf; finishing it (tap to purchase) puts it under "This trip".
- Empty groups show no heading; the shelf heading disappears entirely when every purchased item has an active twin.
- Norwegian device language: "Denne turen / Tidligere denne uken / Tidligere" group headings.
- Kill and relaunch — grouping persists (recomputed from purchase timestamps).

## Colour mode setting (manual pass)

- Gear icon on the Today header opens Settings; the close button returns.
- Selecting Light / Dark / System restyles the app immediately behind the modal (visible on a design/* theme branch; on develop dark mirrors light, so Light and Dark look identical there).
- The selection persists across kill & relaunch.
- System follows the OS light/dark toggle live; Light and Dark ignore it.
- Norwegian device language: Innstillinger / Utseende / Lys / Mørk / System.

## Recipe URL import (manual pass)

- New recipe → paste a real Norwegian recipe URL (e.g. from matprat.no or godt.no) → Import fills title, servings, ingredients (quantities/units split where unambiguous), and steps; review and save works.
- An English-language recipe URL imports equally well (tbsp/tsp map to ss/ts).
- A non-recipe URL (e.g. a news article) shows "Couldn't read a recipe from this link." and leaves the form untouched.
- Airplane mode: import fails with the notice after the timeout, no crash, form untouched.
- A scheme-less paste ("matprat.no/…") works; the button is disabled while the field is empty and shows "Importing…" while fetching.
- The edit screen has no import strip.
- Norwegian device language: "Lim inn en oppskriftslenke / Importer / Importerer… / Fant ingen oppskrift på denne lenken."

## Language setting (manual pass)

- Settings → Language/Språk: choosing Norsk switches the whole app instantly — the modal closes and Today renders in Norwegian. English likewise.
- Quantity formatting follows: the same ingredient shows 0,5 under Norsk and 0.5 under English.
- System: the app follows the device language; with System selected, changing the device language switches the app (relaunch OK).
- The choice persists across kill & relaunch.
- The colour-mode setting still works after a language switch, and its labels translate (Lys/Mørk under Norsk).

## Backend foundation (manual pass)

- `cd backend && cp -n .env.example .env && docker compose up --build` → api healthy at http://localhost:8080/health.
- Scalar UI at http://localhost:8080/scalar lists the five recipe endpoints.
- Create → list → get → update → delete a recipe through Scalar; deleted recipe vanishes from the list but re-creating its id returns 409 (soft-deleted rows keep their id).
- `docker compose down && docker compose up` → data survives (named volume).
- `dotnet test` from backend/ passes with Docker running (Testcontainers pulls postgres:17-alpine on first run).

## Authentication (manual pass)

- `docker compose up --build` (with `JWT_KEY` set in `.env`) → register via Scalar → response carries access + refresh tokens.
- Anonymous `GET /api/v1/recipes` is 401; with the Bearer token it lists; recipes created by a second registered user are invisible to the first (list, get, update, delete all behave as not-found).
- Duplicate registration with the same email (any casing) → 409; wrong password and unknown email on login → identical 401s.
- Refresh with the current refresh token → new pair; refresh with the OLD token afterwards → 401 AND the new pair stops refreshing too (family revoked). Logout → refresh 401, repeat logout still 204.
- Restart the api container: tokens issued before the restart still work (key from env, state in postgres).
- If startup fails on an existing compose volume after this slice (recipes now require a household), `docker compose down -v` once — dev data is disposable.
