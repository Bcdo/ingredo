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
    ['-3 servings', 1],
  ])('parses recipeYield %p to %i servings', (recipeYield, expected) => {
    const doc = { ...BASE, recipeYield };
    expect(extractRecipe(page(doc))?.servings).toBe(expected);
  });

  it('skips a Recipe node without a usable name in favor of a later one', () => {
    const graph = {
      '@graph': [
        { ...BASE, name: '' },
        { ...BASE, name: 'Vafler' },
      ],
    };
    expect(extractRecipe(page(graph))?.title).toBe('Vafler');
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
