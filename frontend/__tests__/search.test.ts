import { filterRecipes } from '../lib/search';

const items = [
  { title: 'Halloumi Burger', ingredientNames: ['halloumi', 'bun'] },
  { title: 'Tomato Soup', ingredientNames: ['tomatoes', 'salt'] },
  { title: 'Pannekaker', ingredientNames: ['egg', 'melk', 'hvetemel'] },
];

describe('filterRecipes', () => {
  it('returns everything for an empty query', () => {
    expect(filterRecipes(items, '')).toHaveLength(3);
    expect(filterRecipes(items, '   ')).toHaveLength(3);
  });
  it('matches titles case-insensitively', () => {
    expect(filterRecipes(items, 'tomato')).toEqual([items[1]]);
  });
  it('matches ingredient names', () => {
    expect(filterRecipes(items, 'melk')).toEqual([items[2]]);
  });
  it('returns empty for no match', () => {
    expect(filterRecipes(items, 'pizza')).toEqual([]);
  });
});
