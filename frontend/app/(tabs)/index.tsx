import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { addDays, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';

type TodayItem = { id: string; date: string; recipeId: string; servings: number; title: string };

export default function TodayScreen() {
  const router = useRouter();
  const today = todayLocal();
  const tomorrow = addDays(today, 1);

  const { data: rows } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        date: mealPlanEntries.date,
        recipeId: mealPlanEntries.recipeId,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, tomorrow),
          isNull(recipes.deletedAt),
          isNull(mealPlanEntries.deletedAt)
        )
      )
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)),
    [today]
  );

  const items = (rows ?? []) as TodayItem[];
  const tonights = items.filter((row) => row.date === today);
  const tomorrows = items.filter((row) => row.date === tomorrow);
  const hero = tonights[0];

  return (
    <ScrollView className="flex-1 bg-cream" contentContainerClassName="gap-6 p-4">
      <View className="gap-3">
        <Text className="font-display text-xl text-ink">{t('today.tonight')}</Text>
        {hero ? (
          <>
            <Pressable
              accessibilityRole="button"
              className="active:opacity-80"
              onPress={() => router.push(`/recipe/${hero.recipeId}`)}>
              <Card className="min-h-28 justify-between">
                <Text className="font-display-bold text-2xl text-ink" numberOfLines={3}>
                  {hero.title}
                </Text>
                <Text className="mt-2 font-body text-sm text-ink opacity-70">
                  {t('recipes.servingsCount', { count: hero.servings })}
                </Text>
              </Card>
            </Pressable>
            {tonights.slice(1).map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                className="min-h-14 active:opacity-80"
                onPress={() => router.push(`/recipe/${item.recipeId}`)}>
                <Card>
                  <Text className="font-display text-base text-ink" numberOfLines={2}>
                    {item.title}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </>
        ) : (
          <Card className="gap-4">
            <Text className="font-body text-base text-ink opacity-70">
              {t('today.nothingTonight')}
            </Text>
            <Button label={t('today.planWeek')} onPress={() => router.push('/(tabs)/plan')} />
          </Card>
        )}
      </View>

      {tomorrows.length > 0 ? (
        <View className="gap-3">
          <Text className="font-display text-xl text-ink">{t('today.tomorrow')}</Text>
          {tomorrows.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              className="min-h-14 active:opacity-80"
              onPress={() => router.push(`/recipe/${item.recipeId}`)}>
              <Card>
                <Text className="font-display text-base text-ink" numberOfLines={2}>
                  {item.title}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
