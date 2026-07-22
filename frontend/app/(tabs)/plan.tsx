import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { addDays, rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { mealPlanEntries, recipeIngredients, recipes, shoppingItems } from '../../lib/db/schema';
import { addItems } from '../../lib/db/shoppingList';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';
import { aggregateRows, itemKey, type PlanIngredientRow } from '../../lib/shopping';

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
          isNull(recipes.deletedAt),
          isNull(mealPlanEntries.deletedAt)
        )
      )
      .orderBy(asc(mealPlanEntries.date), asc(mealPlanEntries.sortOrder)),
    [today]
  );

  const { data: ingredientRows } = useLiveQuery(
    db
      .select({
        entryServings: mealPlanEntries.servings,
        recipeServings: recipes.servings,
        recipeTitle: recipes.title,
        name: recipeIngredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        scaling: recipeIngredients.scaling,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
      .where(
        and(
          gte(mealPlanEntries.date, today),
          lte(mealPlanEntries.date, addDays(today, 6)),
          isNull(recipes.deletedAt),
          isNull(mealPlanEntries.deletedAt)
        )
      ),
    [today]
  );

  const { data: activeItems } = useLiveQuery(
    db
      .select({ normalizedName: shoppingItems.normalizedName, unit: shoppingItems.unit })
      .from(shoppingItems)
      .where(and(eq(shoppingItems.status, 'active'), isNull(shoppingItems.deletedAt)))
  );

  const pending = useMemo(() => {
    const activeKeys = new Set((activeItems ?? []).map((item) => itemKey(item)));
    return aggregateRows((ingredientRows ?? []) as PlanIngredientRow[]).filter(
      (item) => !activeKeys.has(itemKey(item))
    );
  }, [ingredientRows, activeItems]);

  const addWeek = () => {
    addItems(db, pending, 'skip-existing');
  };

  const byDate = new Map<string, PlanItem[]>();
  for (const row of rows ?? []) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  return (
    <View className="flex-1 bg-cream">
      <ScrollView className="flex-1" contentContainerClassName="gap-6 p-4">
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
      {pending.length > 0 ? (
        <View className="px-4 pb-4 pt-2">
          <Pressable
            accessibilityRole="button"
            onPress={addWeek}
            className="min-h-14 items-center justify-center rounded-card bg-sage px-6 py-4 active:opacity-80">
            <Text className="font-body-bold text-lg text-cream">
              {t('plan.addWeek', { count: pending.length })}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
