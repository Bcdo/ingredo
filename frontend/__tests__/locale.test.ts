import { act, renderHook } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { currentLocale, i18n } from '../lib/i18n';
import { applyLanguageMode, useLocaleVersion } from '../lib/locale';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'en' }]),
}));

const getLocalesMock = getLocales as jest.Mock;

describe('applyLanguageMode', () => {
  afterEach(() => {
    applyLanguageMode('en');
  });

  it('forces nb and en, and currentLocale agrees', () => {
    applyLanguageMode('nb');
    expect(i18n.locale).toBe('nb');
    expect(currentLocale()).toBe('nb');

    applyLanguageMode('en');
    expect(i18n.locale).toBe('en');
    expect(currentLocale()).toBe('en');
  });

  it('resolves system from the device locale, defaulting to en', () => {
    getLocalesMock.mockReturnValue([{ languageCode: 'nb' }]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('nb');

    getLocalesMock.mockReturnValue([{ languageCode: 'de' }]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('en');

    getLocalesMock.mockReturnValue([]);
    applyLanguageMode('system');
    expect(i18n.locale).toBe('en');
  });

  it('bumps the version observed by useLocaleVersion on every apply', () => {
    const { result } = renderHook(() => useLocaleVersion());
    const before = result.current;

    act(() => applyLanguageMode('nb'));
    expect(result.current).toBe(before + 1);

    act(() => applyLanguageMode('nb'));
    expect(result.current).toBe(before + 2);
  });
});
