# Dev Sample Data Seeding — Design Spec

**Date:** 2026-07-15
**Slice:** Developer tooling for manual testing (frontend only, dev builds only).
**Scope:** A `__DEV__`-only "Load sample data" action on the Recipes tab empty state that inserts 8 realistic dinner recipes through the existing repository layer.
**Builds on:** recipe CRUD (`2026-07-05`), scaling & units (`2026-07-07`), meal planning (`2026-07-07`) — whose manual checklist (`docs/TESTING.md`) this exists to serve.

## Goals

- A tester on a fresh install can populate the app with realistic recipes in one tap instead of typing them in.
- Seeded data is indistinguishable from hand-entered data: it flows through `createRecipe`, so every downstream feature (search, scaling, planning, soft delete) treats it identically.
- The seed is safe to tap twice and safe alongside hand-entered recipes.

## Non-goals

| Deferred / excluded item | Why |
|---|---|
| Seeded plan entries | Creating entries is exactly what the manual checklist exercises (2-tap planning, Plan it, move/remove) |
| "Clear all data" action | Not needed; wipe the app or emulator instead |
| Production visibility | Dev tooling only; the button renders only when `__DEV__` is true |
| CLI / adb push of a prebuilt DB | Expo Go sandboxes its data directory; not reachable without root |
| Localized sample content | Recipes are user content, not UI chrome; only the button label goes through i18n |

## Key decisions

1. **Seed through the repository, not raw SQL.** `seedSampleData(db)` calls the existing `createRecipe(db, input)` per sample. No new write path, IDs/timestamps come from the same code as real usage.
2. **Idempotent by title.** Before inserting a sample, skip it if a non-deleted recipe with the same title already exists. Tapping twice duplicates nothing; re-seeding after deleting some samples restores only the missing ones; hand-entered recipes are never touched.
3. **Empty-state placement.** The button appears as a secondary action under the existing empty-state CTA on the Recipes tab, and only in dev builds. When recipes exist the button is gone — the populated screen stays faithful to what users see.
4. **i18n like everything else.** The label is `recipes.devSeed` in both `en.json` and `nb.json`, per the bilingual convention, even though it is dev-only (keeps the key-parity test meaningful).

## Components

### `lib/dev/sampleData.ts` (new)

- `SAMPLE_RECIPES: RecipeInput[]` — exactly 8 everyday dinners (e.g. tacos, pasta carbonara, kjøttkaker, oven-baked salmon). Each has:
  - 4–8 ingredients using only canonical units from `lib/units.ts` (`g`, `kg`, `ml`, `dl`, `l`, `ts`, `ss`, `stk`) or `null` unit where natural ("salt, to taste" style entries);
  - at least one recipe with a `scaling: 'fixed'` ingredient so the scaling UI is exercised;
  - 2–4 instruction steps;
  - varied servings across the set (2, 4, 6);
  - one recipe findable in search only via an ingredient name (its title shares no words with the ingredient).
- `seedSampleData(db: DB): number` — synchronous like the rest of the repo layer; for each sample, skips it when a row in `recipes` with the same `title` and `deleted_at IS NULL` exists, otherwise `createRecipe`. Returns the number inserted (handy for tests; UI ignores it).

### `app/(tabs)/recipes.tsx` (modified)

- In the empty-state branch only, when `__DEV__` is true, render a secondary button labeled `t('recipes.devSeed')` beneath the existing `EmptyState` action. Pressing it calls `seedSampleData(db)`; the existing live queries refresh the list automatically.

### `lib/i18n/en.json`, `lib/i18n/nb.json` (modified)

- Add `recipes.devSeed`: "Load sample data" / "Legg inn eksempeldata".

## Error handling

`seedSampleData` runs synchronously against the local SQLite database, same as every other repository call; a failure throws like any other repo call and surfaces in dev via the RedBox. No bespoke handling.

## Testing

- `__tests__/sample-data.test.ts` — unit tests against an in-memory DB:
  - seeding an empty DB inserts all 8 with full details (ingredients + instructions present);
  - seeding twice inserts nothing the second time (returns 0);
  - a hand-entered recipe is untouched and samples with deleted twins are re-inserted;
  - every sample's units are members of `UNITS` (or `null`), guarding the data file against drift.
- `__tests__/recipes-screen.test.tsx` (or existing recipes screen test file) — empty state shows the dev seed button (Jest runs with `__DEV__` true) and tapping it populates the list.
