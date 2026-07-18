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
    const contentType = response.headers.get('content-type');
    if (contentType !== null && !contentType.includes('text/')) return null;
    const html = await response.text();
    return extractRecipe(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
