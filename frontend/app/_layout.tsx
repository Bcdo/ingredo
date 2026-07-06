import '../global.css';

import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Karla_400Regular, Karla_700Bold } from '@expo-google-fonts/karla';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../drizzle/migrations';
import { Button } from '../components/ui/Button';
import { db } from '../lib/db/client';
import { t } from '../lib/i18n';

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
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { state, retry: () => setAttempt((a) => a + 1) };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Karla_400Regular,
    Karla_700Bold,
  });
  const { state, retry } = useDbMigrations();

  if (state === 'error') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-cream px-10">
        <Text className="text-center font-body text-lg text-ink">
          {t('startup.migrationFailed')}
        </Text>
        <Button label={t('startup.retry')} onPress={retry} />
      </View>
    );
  }

  if (state === 'pending' || !fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color="#C96B45" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ contentStyle: { backgroundColor: '#FBF7F1' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="recipe/new" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="recipe/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen
          name="recipe/[id]/edit"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
