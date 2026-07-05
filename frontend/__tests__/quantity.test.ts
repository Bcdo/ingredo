import { parseQuantity, formatQuantity } from '../lib/quantity';

describe('parseQuantity', () => {
  it('parses plain numbers', () => expect(parseQuantity('2')).toBe(2));
  it('parses dot decimals', () => expect(parseQuantity('1.5')).toBe(1.5));
  it('parses comma decimals', () => expect(parseQuantity('1,5')).toBe(1.5));
  it('trims whitespace', () => expect(parseQuantity(' 3 ')).toBe(3));
  it('returns null for empty', () => expect(parseQuantity('')).toBeNull());
  it('returns null for non-numeric', () => expect(parseQuantity('en klype')).toBeNull());
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
