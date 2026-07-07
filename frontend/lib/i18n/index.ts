import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';

import en from './en.json';
import nb from './nb.json';

export const i18n = new I18n({ en, nb });
i18n.enableFallback = true;
i18n.defaultLocale = 'en';
i18n.locale = getLocales()[0]?.languageCode ?? 'en';

export const t = i18n.t.bind(i18n);

export function currentLocale(): 'en' | 'nb' {
  return i18n.locale.startsWith('nb') ? 'nb' : 'en';
}
