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
