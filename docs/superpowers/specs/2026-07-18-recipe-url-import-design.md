# Recipe URL Import — Design Spec

**Date:** 2026-07-18
**Slice:** First post-MVP frontend feature slice (frontend only, no backend). Implements the "Paste a link" import strip from `design/DESIGN.md` §3.7.
**Scope:** Paste a recipe URL on the new-recipe screen → the app fetches the page, reads its schema.org Recipe JSON-LD, and fills the form (title, description, servings, ingredients, steps). The form becomes review-and-fix. No usable data → a gentle notice, write manually as today.
**Builds on:** recipe form state (`lib/form.ts`: `RecipeFormState`, `IngredientDraft`, `draftKey`, `formatQuantity`), canonical units (`lib/units.ts` `UNITS`), quantity conventions (`lib/quantity.ts`), butter-notice pattern, i18n key parity.

## Goals

- Most recipes start on a website: importing one is paste + tap, then review (`DESIGN.md` §3.7 tap budget: URL import = 2).
- Never a wrong guess: everything imported lands in the editable form; anything the parser is unsure about degrades to plain text the user fixes with one tap.
- No per-site code. The only supported source is schema.org Recipe structured data (JSON-LD) — the de-facto standard recipe sites embed for search engines, Norwegian sites included.

## Non-goals (deferred)

| Deferred item | Why / comes with |
|---|---|
| Photo import | The app has no image support anywhere (no column, no storage, no display) — photos are their own future slice; the design doc's "fills photo" waits for it |
| HTML-scraping fallback for sites without JSON-LD | This is the open-ended overhead the feature deliberately avoids; failure mode is "write manually" |
| Microdata / RDFa parsing | Rare without JSON-LD alongside; add only if real-world misses justify it |
| Backend fetch/cache endpoint | Phase 2+; on-device fetch needs no server |
| Natural-language ingredient chip entry (typing "2 tbsp olive oil" live) | Separate §3.7 feature; shares the line parser when it comes |
| Import strip on the edit screen | Import is for creating; overwriting an existing recipe from a URL is a footgun |

## Key decisions

1. **JSON-LD only, tolerantly walked.** `<script type="application/ld+json">` blocks are extracted from raw HTML by regex (no HTML parser dependency), `JSON.parse`d individually (one bad block doesn't kill the rest), and searched for the first object whose `@type` equals or contains `Recipe` — looking through top-level objects, arrays, and `@graph` arrays, in document order. No usable object → import fails as a whole.
2. **Field mapping is defensive; every field optional except title.**
   - `name` → title (string, trimmed; missing/empty title → treat as no recipe).
   - `description` → description ('' when absent).
   - `recipeYield` → servings: the field may be a number, numeric string, prose string ("4 porsjoner", "Serves 6"), or array (first usable element wins); take the first integer found in it, clamp to ≥ 1; unusable → default 4.
   - `recipeIngredient` (fallback: legacy `ingredients`) → string array of raw lines, each run through the line parser (decision 3).
   - `recipeInstructions` → step texts: array of `HowToStep` (`.text`), `HowToSection` (flatten `.itemListElement`), or plain strings; a single string value is split on newlines. Empty/whitespace steps dropped.
   - All HTML entities in extracted strings decoded for the common set (`&amp;` `&quot;` `&#39;` `&nbsp;` `&lt;` `&gt;` and numeric `&#…;`); tags stripped.
3. **Conservative ingredient-line parsing.** `parseIngredientLine(line)` → `{ quantity: number | null, unit: string | null, name: string }`:
   - Leading amount, if present: decimal with comma or dot (`0,5`, `1.5`), integer, unicode fraction (`½ ¼ ¾ ⅓ ⅔`), ascii fraction (`1/2`), or mixed number (`1 1/2`, `1½`).
   - Following unit token, if it matches a closed bilingual map onto canonical `UNITS` codes: g/gram(s)/gr→`g`, kg/kilo(gram)→`kg`, ml→`ml`, dl→`dl`, l/liter(s)/litre(s)→`l`, ts/tsp/teaspoon(s)/teskje(er)→`ts`, ss/tbsp/tablespoon(s)/spiseskje(er)→`ss`, stk/stykk(er)/pc(s)/piece(s)→`stk`. Matching is case-insensitive on a whole token (word boundary).
   - The remainder (trimmed) is the name. An amount with an unrecognized unit token keeps the quantity and folds the token into the name (`"2 cups flour"` → `{2, null, "cups flour"}`); no amount → the whole line is the name. A line whose remainder would be empty after splitting (e.g. `"2 ss"`) is treated as unparseable: the whole trimmed line becomes the name with null quantity/unit. The parser never returns an empty name for a non-empty line.
   - Scaling is always `'linear'` (the form's default; user can flag fixed items in review).
4. **One fetch wrapper owns all I/O.** `fetchRecipeFromUrl(url)` → `Promise<ImportedRecipe | null>`: trims input, prepends `https://` when no scheme, fetches with a 10 s `AbortController` timeout and `Accept: text/html`, extracts per decisions 1–2. Any failure — network, timeout, non-OK status, no JSON-LD, no Recipe, no title — resolves `null`. It never throws to the UI.
5. **The import strip lives inside `RecipeForm`, enabled by prop.** `RecipeForm` gains `allowImport?: boolean` (default false; only `recipe/new` passes true). The strip renders above the title field: URL input + Import button (min-h-14, existing input/button styling), button disabled while the URL is empty or a fetch is in flight (in-flight label swaps to a localized "Importing…"). Success maps the result through `formStateFromImport` (new `lib/form.ts` sibling: quantities localized via `formatQuantity(…, currentLocale())`, keys via `draftKey()`, `notes: ''`) and **replaces** the form state; the existing dirty-state tracking then guards cancel as usual. Failure shows the butter notice `import.failed` (auto-clears on the next import attempt or URL edit). Re-importing over an edited form is allowed — review-and-fix implies the import is the starting point, and the dirty-cancel guard already protects against losing manual work by accident at exit; the strip is the top-of-form entry point used before manual entry in practice.
6. **Locale-independence holds.** The unit-token map is a closed set covering both app languages (structured mapping, not free-language parsing, per the bilingual principle); quantity strings entering the form are formatted for the current locale exactly like edit-mode does.

## Components

### `lib/import/recipeJsonLd.ts` (new, pure)

- `export type ImportedRecipe = { title: string; description: string; servings: number; ingredientLines: string[]; steps: string[] }`.
- `extractRecipe(html: string): ImportedRecipe | null` — decisions 1–2. No fetch, no DB, no i18n.

### `lib/import/ingredientLine.ts` (new, pure)

- `parseIngredientLine(line: string): { quantity: number | null; unit: string | null; name: string }` — decision 3. Imports `UNITS` codes only for type-safety of the map's values.

### `lib/import/fetchRecipe.ts` (new)

- `fetchRecipeFromUrl(url: string): Promise<ImportedRecipe | null>` — decision 4. The only impure module; mocked in component tests.

### `lib/form.ts` (modified)

- `formStateFromImport(imported: ImportedRecipe): RecipeFormState` — maps lines through `parseIngredientLine`, quantities through `formatQuantity(…, currentLocale())`, fresh `draftKey()`s, `scaling: 'linear'`, `notes: ''`.

### `components/RecipeForm.tsx` (modified)

- `allowImport?: boolean` prop; import strip UI + local state (`url`, `importing`, `importFailed`) per decision 5.

### `app/recipe/new.tsx` (modified)

- Passes `allowImport` to `RecipeForm`. (Edit screen unchanged.)

### i18n (`en.json` / `nb.json`)

- `import.placeholder`: "Paste a recipe link" / "Lim inn en oppskriftslenke"
- `import.button`: "Import" / "Importer"
- `import.importing`: "Importing…" / "Importerer…"
- `import.failed`: "Couldn't read a recipe from this link." / "Fant ingen oppskrift på denne lenken."

## Error handling

`fetchRecipeFromUrl` maps every failure to `null` (decision 4); the strip's only failure UI is the butter notice. Repository writes are untouched — saving goes through the existing form save path.

## Testing

- Extractor: fixture HTML strings covering plain Recipe object, `@graph`-wrapped (WordPress-style), top-level array, `@type` array (`["Recipe","NewsArticle"]`), `HowToStep` and plain-string instructions, single-string instructions with newlines, prose/array `recipeYield` (incl. "4 porsjoner"), entity-encoded titles, malformed JSON block followed by a good one, HTML without any Recipe → null. No live network anywhere.
- Line parser: table tests — `"400 g hakkede tomater"`, `"0,5 dl fløte"`, `"1 1/2 ss olivenolje"`, `"½ ts salt"`, `"2 cups flour"` (unknown unit folds into name), `"Salt og pepper"` (name-only), `"3 egg"` (count with no unit), case variants, en tokens (`tbsp`, `tsp`).
- `formStateFromImport`: quantities localized (nb comma), keys unique, linear scaling, notes empty.
- RecipeForm screen tests (mocking `lib/import/fetchRecipe`): strip hidden without `allowImport`; successful import fills title/ingredients/steps; failure shows the `import.failed` notice; button disabled while empty/in-flight.
- Full pass: suite, lint zero warnings, `tsc`, android bundle export; manual checklist appended to `docs/TESTING.md` (real Norwegian + English recipe URLs, timeout behavior on airplane mode, review-and-fix then save, bilingual strings).

## Rollout

Feature branch `feature/recipe-url-import` off `develop`, merged per the usual flow. Theme experiment branches need no rebase for this (they only diverge in `lib/theme.js` / fonts), but can be rebased opportunistically.
