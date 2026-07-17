import { useColorScheme } from 'react-native';

import { palettes } from './theme';

// The active palette for raw color props (Ionicons, placeholders, navigator
// options) that NativeWind classes can't style. Re-renders on scheme change.
export function usePalette() {
  return useColorScheme() === 'dark' ? palettes.dark : palettes.light;
}
