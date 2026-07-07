import { displayQuantity, formatFraction } from '../lib/measure';

describe('formatFraction', () => {
  it.each([
    [2, '2'],
    [0.5, '½'],
    [3.3333, '3⅓'],
    [1.984, '2'], // rounds up to the next whole
    [0.845, '⅞'],
    [3.527, '3½'],
    [2.2046, '2¼'],
    [0.2, '¼'],
    [0.02, '⅛'], // never snaps a non-zero amount to zero
    [7.0547, '7'],
  ])('formats %f as %s', (value, expected) => {
    expect(formatFraction(value)).toBe(expected);
  });
});

const metricEn = { scaleFactor: 1, system: 'metric', locale: 'en' } as const;
const usEn = { scaleFactor: 1, system: 'us', locale: 'en' } as const;

describe('displayQuantity', () => {
  it('returns null for null quantities regardless of options', () => {
    expect(displayQuantity(null, 'g', usEn)).toBeNull();
    expect(displayQuantity(null, null, { ...metricEn, scaleFactor: 3 })).toBeNull();
  });

  it('scales linearly in metric without changing the unit', () => {
    expect(displayQuantity(600, 'g', { ...metricEn, scaleFactor: 1.5 })).toEqual({
      amountText: '900',
      unitCode: 'g',
    });
    expect(displayQuantity(1.5, 'dl', { ...metricEn, scaleFactor: 2 })).toEqual({
      amountText: '3',
      unitCode: 'dl',
    });
  });

  it('uses the locale decimal separator in metric', () => {
    expect(displayQuantity(1.5, 'dl', { ...metricEn, locale: 'nb' })).toEqual({
      amountText: '1,5',
      unitCode: 'dl',
    });
  });

  it('keeps fixed-scaling amounts constant but still converts them', () => {
    expect(displayQuantity(1, 'ts', { ...metricEn, scaleFactor: 2, scaling: 'fixed' })).toEqual({
      amountText: '1',
      unitCode: 'ts',
    });
    expect(displayQuantity(2, 'dl', { ...usEn, scaleFactor: 3, scaling: 'fixed' })).toEqual({
      amountText: '⅞',
      unitCode: 'cup',
    });
  });

  it('passes stk and free-text units through with a scaled number in both systems', () => {
    expect(displayQuantity(3, 'stk', { ...usEn, scaleFactor: 1.5 })).toEqual({
      amountText: '4.5',
      unitCode: 'stk',
    });
    expect(displayQuantity(2, 'never', { ...metricEn, scaleFactor: 2, locale: 'nb' })).toEqual({
      amountText: '4',
      unitCode: 'never',
    });
    expect(displayQuantity(1.5, 'stk', { ...metricEn, locale: 'nb' })).toEqual({
      amountText: '1,5',
      unitCode: 'stk',
    });
  });

  it('formats a unit-less quantity as a plain localized number', () => {
    expect(displayQuantity(2, null, { ...usEn, scaleFactor: 2 })).toEqual({
      amountText: '4',
      unitCode: null,
    });
  });

  it('keeps ts/ss codes in US mode with fraction formatting', () => {
    expect(displayQuantity(2, 'ts', usEn)).toEqual({ amountText: '2', unitCode: 'ts' });
    expect(displayQuantity(1, 'ss', { ...usEn, scaleFactor: 0.5 })).toEqual({
      amountText: '½',
      unitCode: 'ss',
    });
  });

  it('converts metric mass to oz below 1 lb and lb above', () => {
    expect(displayQuantity(100, 'g', usEn)).toEqual({ amountText: '3½', unitCode: 'oz' });
    expect(displayQuantity(600, 'g', { ...usEn, scaleFactor: 1.5 })).toEqual({
      amountText: '2',
      unitCode: 'lb',
    });
    expect(displayQuantity(1, 'kg', usEn)).toEqual({ amountText: '2¼', unitCode: 'lb' });
  });

  it('converts metric volume through the ts/ss/cup bands', () => {
    expect(displayQuantity(1, 'ml', usEn)).toEqual({ amountText: '¼', unitCode: 'ts' });
    expect(displayQuantity(0.1, 'ml', usEn)).toEqual({ amountText: '⅛', unitCode: 'ts' });
    expect(displayQuantity(15, 'ml', usEn)).toEqual({ amountText: '1', unitCode: 'ss' });
    expect(displayQuantity(0.5, 'dl', usEn)).toEqual({ amountText: '3⅓', unitCode: 'ss' });
    expect(displayQuantity(2, 'dl', usEn)).toEqual({ amountText: '⅞', unitCode: 'cup' });
    expect(displayQuantity(1, 'l', usEn)).toEqual({ amountText: '4¼', unitCode: 'cup' });
  });
});
