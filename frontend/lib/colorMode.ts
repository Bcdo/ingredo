import { Appearance } from 'react-native';

import type { ColorMode } from './db/settings';

// One place owns the mode→scheme mapping: 'system' clears the override so
// the OS scheme flows through ('unspecified' since React Native 0.83, null
// before); 'light'/'dark' force it app-wide. Everything downstream
// (useColorScheme, usePalette, the root vars() injection) already listens
// to the resulting scheme.
export function applyColorMode(mode: ColorMode): void {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
}
