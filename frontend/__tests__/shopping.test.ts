import {
  aggregateRows,
  itemKey,
  normalizeName,
  sumQuantities,
  type PlanIngredientRow,
} from '../lib/shopping';

const row = (overrides: Partial<PlanIngredientRow> = {}): PlanIngredientRow => ({
  entryServings: 4,
  recipeServings: 4,
  recipeTitle: 'Tomato Soup',
  name: 'Tomatoes',
  quantity: 400,
  unit: 'g',
  scaling: 'linear',
  ...overrides,
});

describe('aggregateRows', () => {
  it('scales linear ingredients by entry/recipe servings and leaves fixed ones alone', () => {
    const items = aggregateRows([
      row({ entryServings: 6, recipeServings: 4, quantity: 400, unit: 'g' }),
      row({
        name: 'Salt',
        entryServings: 6,
        recipeServings: 4,
        quantity: 1,
        unit: 'ts',
        scaling: 'fixed',
      }),
    ]);
    const tomatoes = items.find((i) => i.normalizedName === 'tomatoes')!;
    const salt = items.find((i) => i.normalizedName === 'salt')!;
    expect(tomatoes.quantity).toBe(600);
    expect(salt.quantity).toBe(5); // 1 ts fixed → 5 ml base, unscaled
    expect(salt.unit).toBe('ml');
  });

  it('sums same-dimension quantities in base units across unit spellings', () => {
    const items = aggregateRows([
      row({ name: 'Melk', quantity: 2, unit: 'dl', recipeTitle: 'Pannekaker' }),
      row({ name: 'melk ', quantity: 1, unit: 'l', recipeTitle: 'Vafler' }),
      row({ name: 'Mel', quantity: 500, unit: 'g' }),
      row({ name: 'mel', quantity: 1, unit: 'kg' }),
    ]);
    const milk = items.find((i) => i.normalizedName === 'melk')!;
    const flour = items.find((i) => i.normalizedName === 'mel')!;
    expect(milk).toMatchObject({ quantity: 1200, unit: 'ml', sources: ['Pannekaker', 'Vafler'] });
    expect(flour).toMatchObject({ quantity: 1500, unit: 'g' });
  });

  it('keeps mismatched dimensions as separate rows', () => {
    const items = aggregateRows([
      row({ name: 'Tomater', quantity: 400, unit: 'g' }),
      row({ name: 'Tomater', quantity: 2, unit: 'stk' }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.unit).sort()).toEqual(['g', 'stk']);
  });

  it('merges stk counts and exact-match free-text units, but not different free text', () => {
    const items = aggregateRows([
      row({ name: 'Løk', quantity: 2, unit: 'stk' }),
      row({ name: 'løk', quantity: 1, unit: 'stk' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'neve' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'neve' }),
      row({ name: 'Basilikum', quantity: 1, unit: 'pose' }),
    ]);
    const onions = items.find((i) => i.normalizedName === 'løk')!;
    expect(onions).toMatchObject({ quantity: 3, unit: 'stk' });
    const basil = items.filter((i) => i.normalizedName === 'basilikum');
    expect(basil).toHaveLength(2);
    expect(basil.find((i) => i.unit === 'neve')!.quantity).toBe(2);
    expect(basil.find((i) => i.unit === 'pose')!.quantity).toBe(1);
  });

  it('does not fold plural or language variants', () => {
    const items = aggregateRows([
      row({ name: 'Tomat', quantity: 1, unit: 'stk' }),
      row({ name: 'Tomater', quantity: 2, unit: 'stk' }),
    ]);
    expect(items).toHaveLength(2);
  });

  it('null quantities merge by contributing sources only, and sum is null only when all are null', () => {
    const items = aggregateRows([
      row({ name: 'Pepper', quantity: null, unit: null, recipeTitle: 'Carbonara' }),
      row({ name: 'pepper', quantity: null, unit: null, recipeTitle: 'Gryte' }),
      row({ name: 'Egg', quantity: 3, unit: null }),
      row({ name: 'Egg', quantity: null, unit: null, recipeTitle: 'Vafler' }),
    ]);
    const pepper = items.find((i) => i.normalizedName === 'pepper')!;
    const eggs = items.find((i) => i.normalizedName === 'egg')!;
    expect(pepper.quantity).toBeNull();
    expect(pepper.sources).toEqual(['Carbonara', 'Gryte']);
    expect(eggs.quantity).toBe(3);
  });

  it('normalizes the unit to base even when the first contribution has a null quantity', () => {
    const items = aggregateRows([
      row({ name: 'Smør', quantity: null, unit: 'kg' }),
      row({ name: 'smør', quantity: 200, unit: 'g' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 200, unit: 'g' });
  });

  it('dedupes sources, keeps first display casing, skips blank names, and guards zero servings', () => {
    const items = aggregateRows([
      row({ name: ' Fløte ', quantity: 2, unit: 'dl', recipeTitle: 'Gryte' }),
      row({ name: 'fløte', quantity: 1, unit: 'dl', recipeTitle: 'Gryte' }),
      row({ name: '   ', quantity: 1, unit: 'g' }),
      row({ name: 'Ris', quantity: 2, unit: 'dl', recipeServings: 0, entryServings: 4 }),
    ]);
    const cream = items.find((i) => i.normalizedName === 'fløte')!;
    expect(cream.name).toBe('Fløte');
    expect(cream.sources).toEqual(['Gryte']);
    expect(items.some((i) => i.normalizedName === '')).toBe(false);
    expect(items.find((i) => i.normalizedName === 'ris')!.quantity).toBe(200); // factor guard → 1
  });
});

describe('itemKey / normalizeName / sumQuantities', () => {
  it('keys by normalized name plus unit bucket', () => {
    expect(itemKey({ normalizedName: 'mel', unit: 'g' })).toBe(
      itemKey({ normalizedName: 'mel', unit: 'kg' })
    );
    expect(itemKey({ normalizedName: 'mel', unit: 'g' })).not.toBe(
      itemKey({ normalizedName: 'mel', unit: 'dl' })
    );
    expect(itemKey({ normalizedName: 'løk', unit: 'stk' })).not.toBe(
      itemKey({ normalizedName: 'løk', unit: null })
    );
  });

  it('normalizeName trims and lowercases', () => {
    expect(normalizeName('  Rød Løk ')).toBe('rød løk');
  });

  it('sumQuantities treats null as no contribution', () => {
    expect(sumQuantities(null, null)).toBeNull();
    expect(sumQuantities(2, null)).toBe(2);
    expect(sumQuantities(null, 3)).toBe(3);
    expect(sumQuantities(2, 3)).toBe(5);
  });
});
