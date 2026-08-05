import { formatCode } from '../lib/codeFormat';

describe('formatCode', () => {
  it('uppercases and appends the hyphen after the third character', () => {
    expect(formatCode('a', '')).toBe('A');
    expect(formatCode('Ab', 'A')).toBe('AB');
    expect(formatCode('ABc', 'AB')).toBe('ABC-');
    expect(formatCode('ABC-d', 'ABC-')).toBe('ABC-D');
  });

  it('never re-appends the hyphen while deleting', () => {
    expect(formatCode('ABC', 'ABC-')).toBe('ABC');
    expect(formatCode('AB', 'ABC')).toBe('AB');
    expect(formatCode('', 'A')).toBe('');
  });

  it('normalizes pasted codes of any shape', () => {
    expect(formatCode('abcdef', '')).toBe('ABC-DEF');
    expect(formatCode('abc def', '')).toBe('ABC-DEF');
    expect(formatCode('ABC-DEF', '')).toBe('ABC-DEF');
  });

  it('strips junk and truncates to six significant characters', () => {
    expect(formatCode('a!b@c#d$e%f^g', '')).toBe('ABC-DEF');
    expect(formatCode('abcdefgh', '')).toBe('ABC-DEF');
    // 0, 1, I, L, O are not in the server's code alphabet, but only the
    // ambiguous digits are stripped client-side; letters pass through and
    // the server stays the validator.
    expect(formatCode('ab0cd1ef', '')).toBe('ABC-DEF');
  });

  it('reflows after a mid-code deletion', () => {
    expect(formatCode('AB-DEF', 'ABC-DEF')).toBe('ABD-EF');
  });
});
