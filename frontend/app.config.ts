import { execSync } from 'node:child_process';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Filled by `eas init` (see eas.json task) — used for both the EAS project
// link and the expo-updates URL.
const EAS_PROJECT_ID = '3b3e2eab-750e-4779-b257-3e1b187d373d';

// Snapshotted at config-evaluation time: `eas update` evaluates this file
// on the publishing machine, so each update carries the commit it shipped
// from. Null when git is unavailable (e.g. a tarball checkout).
function readGitHash(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Ingredo',
  slug: 'ingredo',
  version: '0.1.0',
  scheme: 'ingredo',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],
  platforms: ['ios', 'android'],
  plugins: [
    'expo-router',
    'expo-localization',
    'expo-sqlite',
    'expo-font',
    'expo-secure-store',
    'expo-web-browser',
    'expo-status-bar',
    // The top-level `splash` field went away in SDK 56; the plugin owns it.
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#FBF7F1',
      },
    ],
  ],
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
    versionCode: 3,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FBF7F1',
    },
  },
  runtimeVersion: { policy: 'sdkVersion' },
  ...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
  extra: {
    apiUrl: process.env.INGREDO_API_URL ?? 'http://10.0.2.2:8080',
    build: { gitHash: readGitHash() },
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
