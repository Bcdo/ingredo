# Recipe URL Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a recipe URL on the new-recipe screen → fetch the page, read its schema.org Recipe JSON-LD, fill the form (title, description, servings, ingredients, steps) for review-and-fix; any failure shows a gentle notice.

**Architecture:** Three new modules under `lib/import/`: a pure JSON-LD extractor (`recipeJsonLd.ts`), a pure conservative ingredient-line parser (`ingredientLine.ts`), and the only impure piece, a fetch wrapper (`fetchRecipe.ts`) that resolves `null` on every failure. `lib/form.ts` gains `formStateFromImport` mapping an `ImportedRecipe` into `RecipeFormState`. `RecipeForm` gains an `allowImport` prop rendering the import strip; only `recipe/new` enables it.

**Tech Stack:** Expo SDK 54, React Native `fetch` + `AbortController`, NativeWind, Jest + `@testing-library/react-native` v13.

**Spec:** `docs/superpowers/specs/2026-07-18-recipe-url-import-design.md`

## Global Constraints

- JSON-LD only; no HTML-parser dependency (regex script extraction); one malformed block must not prevent later blocks from parsing.
- Extractor: first node whose `@type` is `'Recipe'` (string or array member), searching top-level objects, arrays, and `@graph` members in document order. Missing/empty `name` → node unusable. `recipeYield` → first integer found (number, string, or array element), clamped ≥ 1, default 4.
- Line parser: amounts are decimal comma/dot, integer, unicode fraction (½ ¼ ¾ ⅓ ⅔), ascii fraction (`1/2`), mixed (`1 1/2`, `1½`); unit tokens come from a closed bilingual map onto canonical `UNITS` codes, matched case-insensitively as whole tokens; unrecognized token folds into the name; empty-remainder lines (e.g. `"2 ss"`) fall back to whole-line-as-name; the parser never returns an empty name for a non-empty line; quantities must be finite and > 0.
- `fetchRecipeFromUrl` never throws: 10 s abort timeout, `https://` prepended when no scheme, non-OK/no-recipe/network failure all resolve `null`.
- New strings in BOTH `lib/i18n/en.json` and `lib/i18n/nb.json` (key-parity test enforces it).
- Test constraints: `@testing-library/react-native` v13 sync `render(...)`; async import flow asserted with `await screen.findBy…`; out-of-scope vars referenced inside `jest.mock` factories must be `mock`-prefixed; no live network in any test.
- Run all commands from `frontend/`. Zero lint warnings, clean `npx tsc --noEmit`, all tests green before every commit.

## File Structure

- Create: `lib/import/ingredientLine.ts`, `lib/import/recipeJsonLd.ts`, `lib/import/fetchRecipe.ts`.
- Modify: `lib/form.ts` (+`formStateFromImport`), `components/RecipeForm.tsx` (import strip), `app/recipe/new.tsx` (`allowImport`), `lib/i18n/en.json`, `lib/i18n/nb.json`.
- Tests: new `__tests__/ingredient-line.test.ts`, `__tests__/recipe-jsonld.test.ts`, `__tests__/fetch-recipe.test.ts`, `__tests__/recipe-import.test.tsx`; extend `__tests__/form.test.ts`.

---

### Task 1: Conservative ingredient-line parser

**Files:**
- Create: `lib/import/ingredientLine.ts`
- Test: `__tests__/ingredient-line.test.ts` (new)

**Interfaces:**
- Consumes: `UNITS` / `UnitCode` from `lib/units.ts` (type-safety of the token map only).
- Produces (used by Task 3): `type ParsedIngredientLine = { quantity: number | null; unit: string | null; name: string }`; `parseIngredientLine(line: string): ParsedIngredientLine`.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout develop
git checkout -b feature/recipe-url-import
```

(Working tree must be clean; the repo may be parked on a `design/*` branch from theme testing.)

- [ ] **Step 1: Write the failing tests**

Create `__tests__/ingredient-line.test.ts`:

```ts
import { parseIngredientLine } from '../lib/import/ingredientLine';

describe('parseIngredientLine', () => {
  it.each([
    ['400 g hakkede tomater', 400, 'g', 'hakkede tomater'],
    ['400g hakkede tomater', 400, 'g', 'hakkede tomater'],
    ['0,5 dl fløte', 0.5, 'dl', 'fløte'],
    ['1.5 l vann', 1.5, 'l', 'vann'],
    ['1 1/2 ss olivenolje', 1.5, 'ss', 'olivenolje'],
    ['1½ ss olivenolje', 1.5, 'ss', 'olivenolje'],
    ['½ ts salt', 0.5, 'ts', 'salt'],
    ['3/4 dl melk', 0.75, 'dl', 'melk'],
    ['2 tbsp olive oil', 2, 'ss', 'olive oil'],
    ['1 tsp vanilla', 1, 'ts', 'vanilla'],
    ['2 teskjeer kanel', 2, 'ts', 'kanel'],
    ['4 stykker kyllingfilet', 4, 'stk', 'kyllingfilet'],
    ['2 KG poteter', 2, 'kg', 'poteter'],
  ])('parses %s', (line, quantity, unit, name) => {
    expect(parseIngredientLine(line)).toEqual({ quantity, unit, name });
  });

  it('keeps the quantity but folds an unrecognized unit token into the name', () => {
    expect(parseIngredientLine('2 cups flour')).toEqual({
      quantity: 2,
      unit: null,
      name: 'cups flour',
    });
  });

  it('treats a count without a unit as quantity + name', () => {
    expect(parseIngredientLine('3 egg')).toEqual({ quantity: 3, unit: null, name: 'egg' });
  });

  it('passes a line without an amount through as name only', () => {
    expect(parseIngredientLine('Salt og pepper')).toEqual({
      quantity: null,
      unit: null,
      name: 'Salt og pepper',
    });
  });

  it('falls back to whole-line-as-name when nothing would remain', () => {
    expect(parseIngredientLine('2 ss')).toEqual({ quantity: null, unit: null, name: '2 ss' });
  });

  it('rejects a zero denominator and keeps the line as name', () => {
    expect(parseIngredientLine('1/0 dl melk')).toEqual({
      quantity: null,
      unit: null,
      name: '1/0 dl melk',
    });
  });

  it('trims surrounding whitespace and returns empty name only for an empty line', () => {
    expect(parseIngredientLine('  2 dl melk  ')).toEqual({ quantity: 2, unit: 'dl', name: 'melk' });
    expect(parseIngredientLine('   ')).toEqual({ quantity: null, unit: null, name: '' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ingredient-line`
Expected: FAIL — `Cannot find module '../lib/import/ingredientLine'`.

- [ ] **Step 3: Implement lib/import/ingredientLine.ts**

Create `lib/import/ingredientLine.ts`:

```ts
import type { UnitCode } from '../units';

// Closed bilingual token map onto canonical unit codes — a structured
// mapping, not language parsing (bilingual principle). Tokens match
// case-insensitively as whole words.
const UNIT_TOKENS: Record<string, UnitCode> = {
  g: 'g',
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  dl: 'dl',
  l: 'l',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  litres: 'l',
  ts: 'ts',
  tsp: 'ts',
  teaspoon: 'ts',
  teaspoons: 'ts',
  teskje: 'ts',
  teskjeer: 'ts',
  ss: 'ss',
  tbsp: 'ss',
  tablespoon: 'ss',
  tablespoons: 'ss',
  spiseskje: 'ss',
  spiseskjeer: 'ss',
  stk: 'stk',
  stykk: 'stk',
  stykker: 'stk',
  pc: 'stk',
  pcs: 'stk',
  piece: 'stk',
  pieces: 'stk',
};

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
};

export type ParsedIngredientLine = {
  quantity: number | null;
  unit: string | null;
  name: string;
};

function parseAmount(input: string): { value: number; rest: string } | null {
  let m = input.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (m) {
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: input.slice(m[0].length) };
  }
  m = input.match(/^(\d+)\s*\/\s*(\d+)/);
  if (m) return { value: Number(m[1]) / Number(m[2]), rest: input.slice(m[0].length) };
  m = input.match(/^(\d+)\s*([½¼¾⅓⅔])/);
  if (m) return { value: Number(m[1]) + FRACTIONS[m[2]], rest: input.slice(m[0].length) };
  m = input.match(/^([½¼¾⅓⅔])/);
  if (m) return { value: FRACTIONS[m[1]], rest: input.slice(m[0].length) };
  m = input.match(/^(\d+(?:[.,]\d+)?)/);
  if (m) return { value: Number(m[1].replace(',', '.')), rest: input.slice(m[0].length) };
  return null;
}

// Conservative by design: only split what is unambiguous; anything else
// degrades to name-only text the review-and-fix form absorbs. Never
// returns an empty name for a non-empty line.
export function parseIngredientLine(line: string): ParsedIngredientLine {
  const trimmed = line.trim();
  if (trimmed === '') return { quantity: null, unit: null, name: '' };

  const amount = parseAmount(trimmed);
  if (!amount || !Number.isFinite(amount.value) || amount.value <= 0) {
    return { quantity: null, unit: null, name: trimmed };
  }

  const rest = amount.rest.trimStart();
  const tokenMatch = rest.match(/^([A-Za-zÀ-ÿ]+)(?=\s|$)/);
  const unit = tokenMatch ? (UNIT_TOKENS[tokenMatch[1].toLowerCase()] ?? null) : null;
  const name = (unit ? rest.slice(tokenMatch![1].length) : rest).trim();

  if (name === '') return { quantity: null, unit: null, name: trimmed };
  return { quantity: amount.value, unit, name };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ingredient-line`
Expected: PASS — 19 tests (13 table cases + 6 singles).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/import/ingredientLine.ts __tests__/ingredient-line.test.ts
git commit -m "feat: add conservative ingredient line parser"
```

---

### Task 2: JSON-LD recipe extractor

**Files:**
- Create: `lib/import/recipeJsonLd.ts`
- Test: `__tests__/recipe-jsonld.test.ts` (new)

**Interfaces:**
- Consumes: nothing app-internal (pure string/JSON work).
- Produces (used by Tasks 3–4): `export type ImportedRecipe = { title: string; description: string; servings: number; ingredientLines: string[]; steps: string[] }`; `extractRecipe(html: string): ImportedRecipe | null`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/recipe-jsonld.test.ts`:

```ts
import { extractRecipe } from '../lib/import/recipeJsonLd';

function page(...jsonBlocks: (string | object)[]): string {
  const scripts = jsonBlocks
    .map((block) => (typeof block === 'string' ? block : JSON.stringify(block)))
    .map((json) => `<script type="application/ld+json">${json}</script>`)
    .join('\n');
  return `<html><head><title>Site</title>${scripts}</head><body><p>hello</p></body></html>`;
}

const BASE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Pannekaker',
  description: 'Klassiske pannekaker',
  recipeYield: '4 porsjoner',
  recipeIngredient: ['3 egg', '400 g hvetemel'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Visp sammen egg og mel.' },
    { '@type': 'HowToStep', text: 'Stek i panne.' },
  ],
};

describe('extractRecipe', () => {
  it('extracts a plain Recipe object', () => {
    expect(extractRecipe(page(BASE))).toEqual({
      title: 'Pannekaker',
      description: 'Klassiske pannekaker',
      servings: 4,
      ingredientLines: ['3 egg', '400 g hvetemel'],
      steps: ['Visp sammen egg og mel.', 'Stek i panne.'],
    });
  });

  it('finds the Recipe inside a @graph wrapper', () => {
    const wrapped = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, BASE] };
    expect(extractRecipe(page(wrapped))?.title).toBe('Pannekaker');
  });

  it('finds the Recipe in a top-level array and with an array @type', () => {
    const arrayType = { ...BASE, '@type': ['Recipe', 'NewsArticle'] };
    expect(extractRecipe(page([{ '@type': 'BreadcrumbList' }, arrayType]))?.title).toBe(
      'Pannekaker'
    );
  });

  it('skips a malformed JSON block and reads the next one', () => {
    expect(extractRecipe(page('{not json!!', BASE))?.title).toBe('Pannekaker');
  });

  it('handles plain-string instructions and single-string instructions with newlines', () => {
    const plain = { ...BASE, recipeInstructions: ['Gjør A.', 'Gjør B.'] };
    expect(extractRecipe(page(plain))?.steps).toEqual(['Gjør A.', 'Gjør B.']);
    const single = { ...BASE, recipeInstructions: 'Gjør A.\nGjør B.\n\n' };
    expect(extractRecipe(page(single))?.steps).toEqual(['Gjør A.', 'Gjør B.']);
  });

  it('flattens HowToSection instructions', () => {
    const sectioned = {
      ...BASE,
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Røre',
          itemListElement: [{ '@type': 'HowToStep', text: 'Visp.' }],
        },
        { '@type': 'HowToStep', text: 'Stek.' },
      ],
    };
    expect(extractRecipe(page(sectioned))?.steps).toEqual(['Visp.', 'Stek.']);
  });

  it.each([
    ['4 porsjoner', 4],
    ['Serves 6', 6],
    [8, 8],
    [['2 pieces', '4'], 2],
    ['ingen tall', 4],
    [undefined, 4],
  ])('parses recipeYield %p to %i servings', (recipeYield, expected) => {
    const doc = { ...BASE, recipeYield };
    expect(extractRecipe(page(doc))?.servings).toBe(expected);
  });

  it('decodes entities and strips tags in text fields', () => {
    const messy = {
      ...BASE,
      name: 'Fish &amp; chips&nbsp;<b>deluxe</b>',
      recipeIngredient: ['1 ss salt &#39;flakes&#39;'],
    };
    const result = extractRecipe(page(messy));
    expect(result?.title).toBe('Fish & chips deluxe');
    expect(result?.ingredientLines).toEqual(["1 ss salt 'flakes'"]);
  });

  it('returns null without a Recipe node or without a title', () => {
    expect(extractRecipe(page({ '@type': 'WebSite', name: 'Matblogg' }))).toBeNull();
    expect(extractRecipe(page({ ...BASE, name: '' }))).toBeNull();
    expect(extractRecipe('<html><body>no structured data</body></html>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- recipe-jsonld`
Expected: FAIL — `Cannot find module '../lib/import/recipeJsonLd'`.

- [ ] **Step 3: Implement lib/import/recipeJsonLd.ts**

Create `lib/import/recipeJsonLd.ts`:

```ts
// Pure schema.org Recipe extraction from raw HTML. JSON-LD only — the
// de-facto standard recipe sites embed for search engines — walked
// tolerantly: top-level objects, arrays, and @graph members, first
// usable Recipe in document order wins. No HTML parser dependency; one
// malformed block never hides the next.

export type ImportedRecipe = {
  title: string;
  description: string;
  servings: number;
  ingredientLines: string[];
  steps: string[];
};

type Node = Record<string, unknown>;

const SCRIPT_RE = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function asNode(value: unknown): Node | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Node)
    : null;
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecipeNode(node: Node): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

function candidateNodes(parsed: unknown): Node[] {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const nodes: Node[] = [];
  for (const root of roots) {
    const node = asNode(root);
    if (!node) continue;
    nodes.push(node);
    if (Array.isArray(node['@graph'])) {
      for (const child of node['@graph']) {
        const childNode = asNode(child);
        if (childNode) nodes.push(childNode);
      }
    }
  }
  return nodes;
}

function parseServings(value: unknown): number {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(1, Math.floor(candidate));
    }
    if (typeof candidate === 'string') {
      const match = candidate.match(/\d+/);
      if (match) return Math.max(1, Number(match[0]));
    }
  }
  return 4;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(cleanText)
    .filter((item) => item !== '');
}

function stepNodeTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = cleanText(value);
    return text === '' ? [] : [text];
  }
  const node = asNode(value);
  if (!node) return [];
  if (Array.isArray(node.itemListElement)) {
    return node.itemListElement.flatMap(stepNodeTexts);
  }
  const raw =
    typeof node.text === 'string' ? node.text : typeof node.name === 'string' ? node.name : '';
  const text = cleanText(raw);
  return text === '' ? [] : [text];
}

function stepTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map(cleanText)
      .filter((item) => item !== '');
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap(stepNodeTexts);
}

function toImportedRecipe(node: Node): ImportedRecipe | null {
  const title = typeof node.name === 'string' ? cleanText(node.name) : '';
  if (title === '') return null;
  return {
    title,
    description: typeof node.description === 'string' ? cleanText(node.description) : '',
    servings: parseServings(node.recipeYield),
    ingredientLines: stringList(node.recipeIngredient ?? node.ingredients),
    steps: stepTexts(node.recipeInstructions),
  };
}

export function extractRecipe(html: string): ImportedRecipe | null {
  for (const match of html.matchAll(SCRIPT_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    for (const node of candidateNodes(parsed)) {
      if (!isRecipeNode(node)) continue;
      const recipe = toImportedRecipe(node);
      if (recipe) return recipe;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- recipe-jsonld`
Expected: PASS — 14 tests (8 singles + 6 yield table cases).

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/import/recipeJsonLd.ts __tests__/recipe-jsonld.test.ts
git commit -m "feat: add schema.org recipe JSON-LD extractor"
```

---

### Task 3: Fetch wrapper and form-state mapping

**Files:**
- Create: `lib/import/fetchRecipe.ts`
- Modify: `lib/form.ts`
- Test: `__tests__/fetch-recipe.test.ts` (new); extend `__tests__/form.test.ts`

**Interfaces:**
- Consumes: `extractRecipe`/`ImportedRecipe` (Task 2); `parseIngredientLine` (Task 1); existing `draftKey`, `formatQuantity`, `currentLocale`, `RecipeFormState` in `lib/form.ts`.
- Produces (used by Task 4): `fetchRecipeFromUrl(url: string): Promise<ImportedRecipe | null>`; `formStateFromImport(imported: ImportedRecipe): RecipeFormState`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/fetch-recipe.test.ts`:

```ts
import { fetchRecipeFromUrl } from '../lib/import/fetchRecipe';

const RECIPE_HTML = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'Recipe',
  name: 'Tacos',
  recipeIngredient: ['400 g kjøttdeig'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Stek kjøttdeigen.' }],
})}</script></head><body></body></html>`;

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('fetchRecipeFromUrl', () => {
  it('fetches, extracts, and prepends https:// to a scheme-less paste', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => RECIPE_HTML });

    const result = await fetchRecipeFromUrl('  matsiden.no/tacos  ');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://matsiden.no/tacos',
      expect.objectContaining({ headers: { Accept: 'text/html' } })
    );
    expect(result?.title).toBe('Tacos');
  });

  it('keeps an explicit scheme untouched', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => RECIPE_HTML });
    await fetchRecipeFromUrl('http://example.com/r');
    expect(fetchMock).toHaveBeenCalledWith('http://example.com/r', expect.anything());
  });

  it.each([
    ['empty input', () => fetchRecipeFromUrl('   '), false],
    ['non-OK response', () => fetchRecipeFromUrl('example.com'), true],
    ['network failure', () => fetchRecipeFromUrl('example.com'), true],
    ['page without a recipe', () => fetchRecipeFromUrl('example.com'), true],
  ])('resolves null on %s and never throws', async (label, call, needsMock) => {
    if (label === 'non-OK response') fetchMock.mockResolvedValue({ ok: false });
    if (label === 'network failure') fetchMock.mockRejectedValue(new Error('offline'));
    if (label === 'page without a recipe') {
      fetchMock.mockResolvedValue({ ok: true, text: async () => '<html></html>' });
    }
    await expect(call()).resolves.toBeNull();
    if (!needsMock) expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Append to `__tests__/form.test.ts` (reusing the file's existing imports from `../lib/form`; add `formStateFromImport` to that import):

```ts
describe('formStateFromImport', () => {
  const imported = {
    title: 'Pannekaker',
    description: 'Klassiske',
    servings: 6,
    ingredientLines: ['400 g hvetemel', 'Salt og pepper'],
    steps: ['Visp.', 'Stek.'],
  };

  it('maps an imported recipe into review-ready form state', () => {
    const state = formStateFromImport(imported);
    expect(state.title).toBe('Pannekaker');
    expect(state.description).toBe('Klassiske');
    expect(state.servings).toBe(6);
    expect(state.notes).toBe('');
    expect(state.ingredients).toHaveLength(2);
    expect(state.ingredients[0]).toMatchObject({
      quantity: '400',
      unit: 'g',
      name: 'hvetemel',
      scaling: 'linear',
    });
    expect(state.ingredients[1]).toMatchObject({ quantity: '', unit: null, name: 'Salt og pepper' });
    expect(state.instructions.map((step) => step.text)).toEqual(['Visp.', 'Stek.']);
  });

  it('assigns unique draft keys', () => {
    const state = formStateFromImport(imported);
    const keys = [...state.ingredients, ...state.instructions].map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- fetch-recipe && npm test -- form.test`
Expected: FAIL — `Cannot find module '../lib/import/fetchRecipe'`; `formStateFromImport` is not exported.

- [ ] **Step 3: Implement fetchRecipe.ts and formStateFromImport**

Create `lib/import/fetchRecipe.ts`:

```ts
import { extractRecipe, type ImportedRecipe } from './recipeJsonLd';

const TIMEOUT_MS = 10_000;

// The import feature's only impure module. Resolves null on every failure
// — network, timeout, non-OK, no usable Recipe — so the UI never needs a
// try/catch.
export async function fetchRecipeFromUrl(url: string): Promise<ImportedRecipe | null> {
  const trimmed = url.trim();
  if (trimmed === '') return null;
  const target = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return null;
    const html = await response.text();
    return extractRecipe(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

In `lib/form.ts`, extend the imports:

```ts
import { parseIngredientLine } from './import/ingredientLine';
import type { ImportedRecipe } from './import/recipeJsonLd';
```

and add after `formStateFromRecipe`:

```ts
export function formStateFromImport(imported: ImportedRecipe): RecipeFormState {
  return {
    title: imported.title,
    description: imported.description,
    servings: imported.servings,
    notes: '',
    ingredients: imported.ingredientLines.map((line) => {
      const parsed = parseIngredientLine(line);
      return {
        key: draftKey(),
        quantity: formatQuantity(parsed.quantity, currentLocale()),
        unit: parsed.unit,
        name: parsed.name,
        scaling: 'linear' as const,
      };
    }),
    instructions: imported.steps.map((text) => ({ key: draftKey(), text })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- fetch-recipe && npm test -- form.test`
Expected: PASS — 6 fetch tests; form suite green with the 2 new tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add lib/import/fetchRecipe.ts lib/form.ts __tests__/fetch-recipe.test.ts __tests__/form.test.ts
git commit -m "feat: add recipe fetch wrapper and import form mapping"
```

---

### Task 4: Import strip in the recipe form

**Files:**
- Modify: `components/RecipeForm.tsx`, `app/recipe/new.tsx`, `lib/i18n/en.json`, `lib/i18n/nb.json`
- Test: `__tests__/recipe-import.test.tsx` (new)

**Interfaces:**
- Consumes: `fetchRecipeFromUrl` (Task 3), `formStateFromImport` (Task 3), existing `Input`, butter-notice styling, i18n `t`.
- Produces: `RecipeForm` prop `allowImport?: boolean` (default false); nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/recipe-import.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { RecipeForm } from '../components/RecipeForm';
import { emptyFormState } from '../lib/form';
import { t } from '../lib/i18n';
import { fetchRecipeFromUrl } from '../lib/import/fetchRecipe';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('../lib/import/fetchRecipe', () => ({
  fetchRecipeFromUrl: jest.fn(),
}));

const fetchRecipeMock = fetchRecipeFromUrl as jest.Mock;

const IMPORTED = {
  title: 'Pannekaker',
  description: 'Klassiske',
  servings: 6,
  ingredientLines: ['400 g hvetemel'],
  steps: ['Visp sammen.'],
};

describe('RecipeForm import strip', () => {
  beforeEach(() => {
    fetchRecipeMock.mockReset();
  });

  it('is hidden unless allowImport is set', () => {
    render(<RecipeForm heading="New" initialState={emptyFormState()} onSave={jest.fn()} />);
    expect(screen.queryByPlaceholderText(t('import.placeholder'))).toBeNull();
  });

  it('disables the import button while the URL is empty', () => {
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );
    const button = screen.getByRole('button', { name: t('import.button') });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(button);
    expect(fetchRecipeMock).not.toHaveBeenCalled();
  });

  it('fills the form from a successful import', async () => {
    fetchRecipeMock.mockResolvedValue(IMPORTED);
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );

    fireEvent.changeText(
      screen.getByPlaceholderText(t('import.placeholder')),
      'matsiden.no/pannekaker'
    );
    fireEvent.press(screen.getByRole('button', { name: t('import.button') }));

    expect(await screen.findByDisplayValue('Pannekaker')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('hvetemel')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Visp sammen.')).toBeOnTheScreen();
    expect(fetchRecipeMock).toHaveBeenCalledWith('matsiden.no/pannekaker');
  });

  it('shows the failure notice when nothing could be imported', async () => {
    fetchRecipeMock.mockResolvedValue(null);
    render(
      <RecipeForm allowImport heading="New" initialState={emptyFormState()} onSave={jest.fn()} />
    );

    fireEvent.changeText(screen.getByPlaceholderText(t('import.placeholder')), 'example.com');
    fireEvent.press(screen.getByRole('button', { name: t('import.button') }));

    expect(await screen.findByText(t('import.failed'))).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- recipe-import`
Expected: FAIL — missing `import.*` i18n keys and/or `Unable to find an element with placeholder` (the strip doesn't exist; `allowImport` is not a prop).

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n/en.json`, add a top-level section after `"settings"`:

```json
  "import": {
    "placeholder": "Paste a recipe link",
    "button": "Import",
    "importing": "Importing…",
    "failed": "Couldn't read a recipe from this link."
  },
```

In `lib/i18n/nb.json`, same position:

```json
  "import": {
    "placeholder": "Lim inn en oppskriftslenke",
    "button": "Importer",
    "importing": "Importerer…",
    "failed": "Fant ingen oppskrift på denne lenken."
  },
```

- [ ] **Step 4: Implement the strip in components/RecipeForm.tsx**

Extend the lib imports:

```tsx
import { draftKey, formStateFromImport, type IngredientDraft, type RecipeFormState } from '../lib/form';
import { fetchRecipeFromUrl } from '../lib/import/fetchRecipe';
```

Extend the props type:

```tsx
type RecipeFormProps = {
  heading: string;
  initialState: RecipeFormState;
  onSave: (state: RecipeFormState) => void;
  allowImport?: boolean;
};
```

and the signature: `export function RecipeForm({ heading, initialState, onSave, allowImport = false }: RecipeFormProps) {`.

Inside `RecipeForm`, after the `saveFailed` state, add:

```tsx
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const canImport = importUrl.trim() !== '' && !importing;

  const runImport = async () => {
    setImporting(true);
    setImportFailed(false);
    const imported = await fetchRecipeFromUrl(importUrl);
    if (imported) {
      setState(formStateFromImport(imported));
    } else {
      setImportFailed(true);
    }
    setImporting(false);
  };
```

In the `<ScrollView>`, as the FIRST child (above the title `<View>`), add:

```tsx
        {allowImport ? (
          <View className="gap-2">
            <View className="flex-row gap-2">
              <Input
                value={importUrl}
                onChangeText={(next) => {
                  setImportUrl(next);
                  setImportFailed(false);
                }}
                placeholder={t('import.placeholder')}
                className="flex-1"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canImport }}
                disabled={!canImport}
                onPress={runImport}
                className={`min-h-14 items-center justify-center rounded-card bg-clay px-4 ${
                  canImport ? '' : 'opacity-40'
                } active:opacity-80`}>
                <Text className="font-body-bold text-base text-cream">
                  {importing ? t('import.importing') : t('import.button')}
                </Text>
              </Pressable>
            </View>
            {importFailed ? (
              <View className="rounded-card bg-butter px-4 py-3">
                <Text className="font-body text-sm text-ink">{t('import.failed')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
```

- [ ] **Step 5: Enable the strip on the new-recipe screen**

In `app/recipe/new.tsx`, pass the prop:

```tsx
    <RecipeForm
      allowImport
      heading={t('form.newTitle')}
      initialState={emptyFormState()}
```

(The edit screen is untouched.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- recipe-import && npm test -- recipe-form && npm test -- i18n`
Expected: PASS — 4 new import tests; existing recipe-form tests unaffected; i18n parity green.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint
npx tsc --noEmit
git add components/RecipeForm.tsx app/recipe/new.tsx lib/i18n/en.json lib/i18n/nb.json __tests__/recipe-import.test.tsx
git commit -m "feat: add paste-a-link import strip to new recipe form"
```

---

### Task 5: Final verification and manual checklist

**Files:**
- Modify: root `docs/TESTING.md` (append the manual checklist)

**Interfaces:**
- Consumes: everything.
- Produces: a verified slice and the tester-facing checklist.

- [ ] **Step 1: Full automated pass**

Run from `frontend/`:

```bash
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform android
```

Expected: all green (180 pre-slice tests plus the new suites — report the actual total), zero lint warnings, bundle exports. Fix anything that isn't before proceeding.

- [ ] **Step 2: Append the manual checklist to docs/TESTING.md**

Append at the end of `/home/mrb/Work/Programming/ingredo/docs/TESTING.md`:

```markdown

## Recipe URL import (manual pass)

- New recipe → paste a real Norwegian recipe URL (e.g. from matprat.no or godt.no) → Import fills title, servings, ingredients (quantities/units split where unambiguous), and steps; review and save works.
- An English-language recipe URL imports equally well (tbsp/tsp map to ss/ts).
- A non-recipe URL (e.g. a news article) shows "Couldn't read a recipe from this link." and leaves the form untouched.
- Airplane mode: import fails with the notice after the timeout, no crash, form untouched.
- A scheme-less paste ("matprat.no/…") works; the button is disabled while the field is empty and shows "Importing…" while fetching.
- The edit screen has no import strip.
- Norwegian device language: "Lim inn en oppskriftslenke / Importer / Importerer… / Fant ingen oppskrift på denne lenken."
```

- [ ] **Step 3: Commit**

```bash
git add ../docs/TESTING.md
git commit -m "docs: add recipe URL import manual test checklist"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1–2 (extractor: blocks/`@graph`/arrays/`@type` arrays/yield/steps/entities → T2), decision 3 (conservative line parsing incl. empty-remainder fallback and zero-denominator guard → T1), decision 4 (fetch wrapper semantics → T3), decision 5 (strip inside `RecipeForm` behind `allowImport`, state replacement, butter notice, notice cleared on URL edit → T4), decision 6 (bilingual token map, locale-formatted quantities → T1/T3), i18n keys (T4), non-goals untouched (no photo, no scraping, no edit-screen strip), verification + checklist (T5).
- **Known judgment calls:** `fetchRecipeFromUrl` is tested via a mocked `global.fetch` — the 10 s abort path is exercised only as "rejection → null" (a fake-timer abort test would couple to AbortController internals for little value; airplane-mode behavior is on the manual checklist). The strip clears `importFailed` on URL edit via the `onChangeText` handler, satisfying the spec's "auto-clears on the next import attempt or URL edit". `stepNodeTexts` prefers `.text` over `.name` for `HowToStep` (name is often a heading like "Step 1"). The success screen-test asserts `fetchRecipeFromUrl` receives the raw pasted string — normalization lives inside the wrapper, per decision 4.
- **Type consistency check:** `ImportedRecipe` originates in `recipeJsonLd.ts` (T2) and is imported type-only by `fetchRecipe.ts`/`form.ts` (T3); `parseIngredientLine` returns `{ quantity: number | null; unit: string | null; name: string }` which `formStateFromImport` maps through `formatQuantity(number | null)` → the form's string quantity and `IngredientDraft.unit: string | null` (canonical codes are a subset of string) — matches `lib/form.ts` as read; `RecipeForm`'s new prop is optional with a default, so the untouched edit screen and existing tests compile unchanged; test mock aliases (`fetchRecipeMock`) are derived after import, satisfying the `mock`-prefix hoisting rule.
