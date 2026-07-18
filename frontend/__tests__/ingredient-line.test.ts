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
