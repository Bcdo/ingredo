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

const SCRIPT_RE =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

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
      const match = candidate.match(/-?\d+/);
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
