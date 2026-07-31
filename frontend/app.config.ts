import type { ConfigContext, ExpoConfig } from 'expo/config';

// Filled by `eas init` (see eas.json task) — used for both the EAS project
// link and the expo-updates URL.
const EAS_PROJECT_ID = '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Ingredo',
  slug: 'ingredo',
  version: '1.0.0',
  scheme: 'ingredo',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  assetBundlePatterns: ['**/*'],
  platforms: ['ios', 'android'],
  plugins: ['expo-router', 'expo-localization', 'expo-sqlite', 'expo-font', 'expo-secure-store'],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'no.kodesmien.ingredo',
  },
  android: {
    package: 'no.kodesmien.ingredo',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
  },
  runtimeVersion: { policy: 'sdkVersion' },
  ...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
  extra: {
    apiUrl: process.env.INGREDO_API_URL ?? 'http://10.0.2.2:8080',
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
