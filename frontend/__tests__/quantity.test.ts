import { parseQuantity, formatQuantity } from '../lib/quantity';

describe('parseQuantity', () => {
  it('parses plain numbers', () => expect(parseQuantity('2')).toBe(2));
  it('parses dot decimals', () => expect(parseQuantity('1.5')).toBe(1.5));
  it('parses comma decimals', () => expect(parseQuantity('1,5')).toBe(1.5));
  it('trims whitespace', () => expect(parseQuantity(' 3 ')).toBe(3));
  it('returns null for empty', () => expect(parseQuantity('')).toBeNull());
  it('returns null for non-numeric', () => expect(parseQuantity('en klype')).toBeNull());
  // US recipes are written in fractions; the field accepts them directly.
  it.each([
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['½', 0.5],
    ['1½', 1.5],
    ['1 ½', 1.5],
    ['3/4', 0.75],
  ])('parses the fraction %s as %f', (input, expected) => {
    expect(parseQuantity(input)).toBeCloseTo(expected, 6);
  });
  it('returns null for a zero denominator', () => expect(parseQuantity('1/0')).toBeNull());
  it('returns null when text trails the number', () => expect(parseQuantity('2 cups')).toBeNull());
  it('returns null for zero and negatives', () => {
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('formats integers without decimals', () => expect(formatQuantity(3)).toBe('3'));
  it('keeps meaningful decimals', () => expect(formatQuantity(1.5)).toBe('1.5'));
  it('rounds long fractions to 2 decimals', () => expect(formatQuantity(1 / 3)).toBe('0.33'));
  it('returns empty string for null', () => expect(formatQuantity(null)).toBe(''));
});

describe('formatQuantity locale', () => {
  it('uses a comma separator for nb', () => {
    expect(formatQuantity(1.5, 'nb')).toBe('1,5');
  });

  it('defaults to a dot separator', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(1.5, 'en')).toBe('1.5');
  });

  it('keeps two-decimal precision with either separator', () => {
    expect(formatQuantity(0.333, 'nb')).toBe('0,33');
    expect(formatQuantity(900, 'nb')).toBe('900');
  });
});
