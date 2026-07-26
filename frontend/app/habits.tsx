import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '../lib/db/client';
import { t } from '../lib/i18n';
import { computeHabits, getHabitsData } from '../lib/suggestions/habits';
import { usePalette } from '../lib/usePalette';

export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const habits = useMemo(() => computeHabits(getHabitsData(db)), []);

  const totals = [
    { key: 'recipes', value: habits.totals.recipeCount, caption: t('habits.recipesCaption') },
    { key: 'planned', value: habits.totals.plannedCount, caption: t('habits.plannedCaption') },
    { key: 'purchased', value: habits.totals.purchasedCount, caption: t('habits.purchasedCaption') },
  ];

  const lists = [
    {
      key: 'recipes',
      title: t('habits.topRecipes'),
      rows: habits.topRecipes.map((row) => ({ key: row.id, label: row.title, count: row.count })),
    },
    {
      key: 'items',
      title: t('habits.topItems'),
      rows: habits.topItems.map((row) => ({
        key: row.normalizedName,
        label: row.name,
        count: row.count,
      })),
    },
  ];

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="font-display text-xl text-ink">{t('habits.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.close')}
          onPress={() => router.back()}
          className="h-14 w-10 items-center justify-center">
          <Ionicons name="close" size={24} color={palette.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerClassName="gap-6 p-4">
        <View className="flex-row gap-3">
          {totals.map((total) => (
            <View key={total.key} className="flex-1 items-center rounded-card bg-linen py-4">
              <Text className="font-display text-2xl text-clay">{total.value}</Text>
              <Text className="mt-1 text-center font-body text-xs text-ink opacity-70">
                {total.caption}
              </Text>
            </View>
          ))}
        </View>
        {lists.map((list) =>
          list.rows.length > 0 ? (
            <View key={list.key}>
              <Text className="mb-2 font-display text-lg text-ink opacity-70">{list.title}</Text>
              <View className="gap-2">
                {list.rows.map((row) => (
                  <View
                    key={row.key}
                    className="flex-row items-center justify-between rounded-card bg-linen px-4 py-3">
                    <Text className="flex-1 font-body-bold text-base text-ink" numberOfLines={1}>
                      {row.label}
                    </Text>
                    <Text className="font-display text-base text-clay">
                      {t('habits.times', { count: row.count })}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null
        )}
      </ScrollView>
    </View>
  );
}
