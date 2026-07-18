import { getLocales } from 'expo-localization';
import { useSyncExternalStore } from 'react';

import type { LanguageMode } from './db/settings';
import { i18n } from './i18n';

// Owns post-startup language switching: resolves the stored mode to an
// effective locale, mutates the shared i18n instance, and bumps a version
// the root layout keys its content View on — remounting the tree so every
// screen re-renders in the new language. Only this module touches
// i18n.locale after lib/i18n's device-locale initialization.
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return version;
}

function deviceLocale(): 'en' | 'nb' {
  return getLocales()[0]?.languageCode?.startsWith('nb') ? 'nb' : 'en';
}

export function applyLanguageMode(mode: LanguageMode): void {
  i18n.locale = mode === 'system' ? deviceLocale() : mode;
  version += 1;
  listeners.forEach((listener) => listener());
}

export function useLocaleVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
