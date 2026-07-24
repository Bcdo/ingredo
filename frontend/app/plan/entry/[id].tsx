import { and, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../../components/ui/Button';
import { Stepper } from '../../../components/ui/Stepper';
import { db } from '../../../lib/db/client';
import { removePlanEntry, setPlanEntryServings } from '../../../lib/db/mealPlan';
import { notDeleted } from '../../../lib/db/predicates';
import { mealPlanEntries, recipes } from '../../../lib/db/schema';
import { t } from '../../../lib/i18n';

export default function PlanEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();

  const { data: rows, updatedAt } = useLiveQuery(
    db
      .select({
        id: mealPlanEntries.id,
        recipeId: mealPlanEntries.recipeId,
        servings: mealPlanEntries.servings,
        title: recipes.title,
      })
      .from(mealPlanEntries)
      .innerJoin(recipes, eq(mealPlanEntries.recipeId, recipes.id))
      .where(
        and(
          eq(mealPlanEntries.id, id),
          notDeleted(recipes),
          notDeleted(mealPlanEntries)
        )
      ),
    [id]
  );

  const entry = rows[0];
  if (updatedAt !== undefined && !entry) {
    return <Redirect href="/(tabs)/plan" />;
  }
  if (!entry) return <View className="flex-1 bg-cream" />;

  return (
    <View
      className="flex-1 gap-6 bg-cream px-5"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
      <Text className="font-display-bold text-2xl text-ink" numberOfLines={3}>
        {entry.title}
      </Text>

      <View className="flex-row items-center justify-between">
        <Text className="font-body-bold text-sm text-ink">{t('form.servingsLabel')}</Text>
        <Stepper
          value={entry.servings}
          onChange={(next) => setPlanEntryServings(db, entry.id, next)}
          min={1}
        />
      </View>

      <View className="gap-3">
        <Button
          label={t('plan.openRecipe')}
          onPress={() => router.push(`/recipe/${entry.recipeId}`)}
        />
        <Button
          label={t('plan.moveDay')}
          variant="ghost"
          onPress={() => router.push(`/plan/pick-day?entry=${entry.id}`)}
        />
        <Button
          label={t('plan.remove')}
          variant="ghost"
          onPress={() => {
            removePlanEntry(db, entry.id);
            router.back();
          }}
        />
      </View>
    </View>
  );
}
