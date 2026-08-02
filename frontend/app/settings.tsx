import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountSection } from '../components/settings/AccountSection';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { applyColorMode } from '../lib/colorMode';
import { db } from '../lib/db/client';
import {
  getColorMode,
  getLanguageMode,
  setColorMode,
  setLanguageMode,
  type ColorMode,
  type LanguageMode,
} from '../lib/db/settings';
import { t } from '../lib/i18n';
import { applyLanguageMode } from '../lib/locale';
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

  const [language, setLanguage] = useState<LanguageMode>(() => getLanguageMode(db));

  const selectLanguage = (next: LanguageMode) => {
    setLanguageMode(db, next);
    setLanguage(next);
    applyLanguageMode(next);
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
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <AccountSection />
          <View testID="appearance-section" className="px-4 pt-2">
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
          <View testID="language-section" className="px-4 pt-6">
            <Text className="mb-2 font-body-bold text-sm text-ink">{t('settings.language')}</Text>
            <SegmentedControl<LanguageMode>
              segments={[
                { key: 'nb', label: t('settings.languageNorwegian') },
                { key: 'en', label: t('settings.languageEnglish') },
                { key: 'system', label: t('settings.languageSystem') },
              ]}
              selected={language}
              onSelect={selectLanguage}
            />
          </View>
          <View className="px-4 pt-6">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/habits')}
              className="min-h-14 flex-row items-center justify-between rounded-card bg-linen px-4 active:opacity-80">
              <Text className="font-body-bold text-base text-ink">{t('habits.title')}</Text>
              <Ionicons name="chevron-forward" size={20} color={palette.ink} />
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
