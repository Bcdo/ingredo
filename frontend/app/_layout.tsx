import '../global.css';

import { Alegreya_600SemiBold, Alegreya_700Bold } from '@expo-google-fonts/alegreya';
import { AlegreyaSans_400Regular, AlegreyaSans_700Bold } from '@expo-google-fonts/alegreya-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { vars } from 'nativewind';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../drizzle/migrations';
import { Button } from '../components/ui/Button';
import { applyColorMode } from '../lib/colorMode';
import { restoreSession } from '../lib/api/client';
import { db } from '../lib/db/client';
import { getColorMode, getLanguageMode } from '../lib/db/settings';
import { initActiveHousehold } from '../lib/household';
import { t } from '../lib/i18n';
import { cssVars } from '../lib/theme';
import { applyLanguageMode, useLocaleVersion } from '../lib/locale';
import { getLastSyncedAt } from '../lib/sync/cursor';
import { syncNow } from '../lib/sync/engine';
import { initRealtime } from '../lib/sync/realtime';
import { initLastSyncedAt } from '../lib/sync/status';
import { initSyncTriggers } from '../lib/sync/trigger';
import { usePalette } from '../lib/usePalette';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

type MigrationState = 'pending' | 'ready' | 'error';

function useDbMigrations() {
  const [state, setState] = useState<MigrationState>('pending');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState('pending');
    migrate(db as never, migrations)
      .then(() => !cancelled && setState('ready'))
      .catch((err) => {
        console.warn('migration failed', err);
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry: () => setAttempt((a) => a + 1) };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Alegreya_600SemiBold,
    Alegreya_700Bold,
    AlegreyaSans_400Regular,
    AlegreyaSans_700Bold,
  });
  const { state, retry } = useDbMigrations();

  useEffect(() => {
    if (state === 'ready') {
      applyColorMode(getColorMode(db));
      applyLanguageMode(getLanguageMode(db));
      initLastSyncedAt(getLastSyncedAt(db));
      const teardownHousehold = initActiveHousehold(db);
      void restoreSession().then(() => syncNow());
      const teardownTriggers = initSyncTriggers();
      const teardownRealtime = initRealtime();
      return () => {
        teardownHousehold();
        teardownTriggers();
        teardownRealtime();
      };
    }
  }, [state]);
  const palette = usePalette();
  const localeVersion = useLocaleVersion();
  const themeVars = vars(cssVars(palette));

  if (state === 'error') {
    return (
      <View style={themeVars} className="flex-1 items-center justify-center gap-4 bg-cream px-10">
        <Text className="text-center font-body text-lg text-ink">
          {t('startup.migrationFailed')}
        </Text>
        <Button label={t('startup.retry')} onPress={retry} />
      </View>
    );
  }

  if (state === 'pending' || !fontsLoaded) {
    return (
      <View style={themeVars} className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color={palette.clay} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View key={localeVersion} style={themeVars} className="flex-1">
        <Stack screenOptions={{ contentStyle: { backgroundColor: palette.cream } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="recipe/new" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="recipe/[id]/index" options={{ headerShown: false }} />
          <Stack.Screen
            name="recipe/[id]/edit"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="plan/add" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen
            name="plan/pick-day"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="plan/entry/[id]"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="habits" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen
            name="account/sign-in"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="account/register"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="account/reset"
            options={{ presentation: 'modal', headerShown: false }}
          />
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}
