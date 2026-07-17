import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '../components/ui/SegmentedControl';
import { applyColorMode } from '../lib/colorMode';
import { db } from '../lib/db/client';
import { getColorMode, setColorMode, type ColorMode } from '../lib/db/settings';
import { t } from '../lib/i18n';
import { usePalette } from '../lib/usePalette';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const [mode, setMode] = useState<ColorMode>(() => getColorMode(db));

  const select = (next: ColorMode) => {
    setColorMode(db, next);
    applyColorMode(next);
    setMode(next);
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="font-display text-xl text-ink">{t('settings.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.close')}
          onPress={() => router.back()}
          className="h-14 w-10 items-center justify-center">
          <Ionicons name="close" size={24} color={palette.ink} />
        </Pressable>
      </View>
      <View className="px-4 pt-2">
        <Text className="mb-2 font-body-bold text-sm text-ink">{t('settings.appearance')}</Text>
        <SegmentedControl<ColorMode>
          segments={[
            { key: 'light', label: t('settings.modeLight') },
            { key: 'dark', label: t('settings.modeDark') },
            { key: 'system', label: t('settings.modeSystem') },
          ]}
          selected={mode}
          onSelect={select}
        />
      </View>
    </View>
  );
}
