import { i18n, t } from '../lib/i18n';

describe('i18n', () => {
  afterEach(() => {
    i18n.locale = 'en';
  });

  it('resolves English strings', () => {
    expect(t('tabs.recipes')).toBe('Recipes');
  });

  it('resolves Norwegian strings', () => {
    i18n.locale = 'nb';
    expect(t('tabs.recipes')).toBe('Oppskrifter');
  });

  it('falls back to English for unsupported locales', () => {
    i18n.locale = 'de';
    expect(t('tabs.recipes')).toBe('Recipes');
  });

  it('has a label for every canonical unit in both locales', () => {
    const { UNITS } = require('../lib/units');
    for (const locale of ['en', 'nb']) {
      i18n.locale = locale;
      for (const code of UNITS) {
        const label = t(`units.${code}`);
        expect(label).toBeTruthy();
        expect(label).not.toContain('missing');
      }
    }
  });

  it('has identical key sets in en and nb', () => {
    const en = require('../lib/i18n/en.json');
    const nb = require('../lib/i18n/nb.json');
    const flatten = (obj: object, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]
      );
    expect(flatten(nb).sort()).toEqual(flatten(en).sort());
  });
});
