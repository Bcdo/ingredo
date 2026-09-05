// Native modules that node-side tests need mocked.
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('crypto').randomUUID(),
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
    __store: store,
  };
});

// Intentionally minimal: only what components actually import (RecipeForm's
// Animated.ScrollView + useAnimatedRef). Extend this mock whenever new
// reanimated APIs are used, or every suite fails far from the cause.
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      ScrollView: RN.ScrollView,
      View: RN.View,
      createAnimatedComponent: (component) => component,
    },
    useAnimatedRef: () => ({ current: null }),
  };
});
