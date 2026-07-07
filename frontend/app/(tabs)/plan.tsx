import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { addDays, rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';

type PlanItem = { id: string; date: string; servings: number; title: string };

export default function PlanScreen() {
  const router = useRouter();
  const today = todayLocal();
  const week = rollingWeek(today);

  const { data: rows } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        date: mealPlanEntries.date,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, addDays(today, 6)),
          isNull(recipes.deletedAt)
        )
      )
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)),
    [today]
  );

  const byDate = new Map<string, PlanItem[]>();
  for (const row of rows ?? []) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return (
    <ScrollView className="flex-1 bg-cream" contentContainerClassName="gap-6 p-4">
      {week.map((date) => (
        <View key={date} className="gap-2">
          {date === today ? (
            <View className="self-start rounded-full bg-clay px-3 py-1">
              <Text className="font-body-bold text-sm text-cream">{dayHeading(date, today)}</Text>
            </View>
          ) : (
            <Text className="font-display text-lg text-ink">{dayHeading(date, today)}</Text>
          )}
          {(byDate.get(date) ?? []).map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              className="active:opacity-80"
              onPress={() => router.push(`/plan/entry/${item.id}`)}>
              <Card>
                <Text className="font-display text-lg text-ink" numberOfLines={2}>
                  {item.title}
                </Text>
                <Text className="mt-1 font-body text-sm text-ink opacity-70">
                  {t('recipes.servingsCount', { count: item.servings })}
                </Text>
              </Card>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('plan.addDinner')} — ${dayHeading(date, today)}`}
            onPress={() => router.push(`/plan/add?date=${date}`)}
            className="min-h-14 items-center justify-center rounded-card border-2 border-dashed border-linen active:opacity-80">
            <Text className="font-body-bold text-base text-clay">+ {t('plan.addDinner')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
