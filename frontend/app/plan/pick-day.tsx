import { and, eq, isNull } from 'drizzle-orm';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rollingWeek, todayLocal } from '../../lib/dates';
import { db } from '../../lib/db/client';
import { addPlanEntry, movePlanEntry } from '../../lib/db/mealPlan';
import { getRecipe } from '../../lib/db/recipes';
import { mealPlanEntries } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { dayHeading } from '../../lib/planFormat';

export default function PickDayScreen() {
  const { recipe: recipeId, entry: entryId } = useLocalSearchParams<{
    recipe?: string;
    entry?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [saveFailed, setSaveFailed] = useState(false);

  const today = todayLocal();
  const week = rollingWeek(today);

  // Both loads happen once — the sheet owns no live state.
  const recipeDetails = useMemo(
    () => (typeof recipeId === 'string' ? getRecipe(db, recipeId) : null),
    [recipeId]
  );
  const entryRow = useMemo(
    () =>
      typeof entryId === 'string'
        ? db
            .select()
            .from(mealPlanEntries)
            .where(and(eq(mealPlanEntries.id, entryId), isNull(mealPlanEntries.deletedAt)))
            .get()
        : undefined,
    [entryId]
  );

  const mode = entryRow ? 'move' : recipeDetails ? 'add' : 'invalid';
  if (mode === 'invalid') {
    return <Redirect href="/(tabs)/plan" />;
  }

  const choose = (date: string) => {
    setSaveFailed(false);
    try {
      if (mode === 'move' && entryRow) {
        movePlanEntry(db, entryRow.id, date);
      } else if (recipeDetails) {
        addPlanEntry(db, {
          date,
          recipeId: recipeDetails.recipe.id,
          servings: recipeDetails.recipe.servings,
        });
      }
      router.back();
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <View
      className="flex-1 gap-3 bg-cream px-5"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
      <Text className="font-display text-xl text-ink">{t('plan.pickDayTitle')}</Text>

      {saveFailed ? (
        <View className="rounded-card bg-butter px-4 py-3">
          <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
        </View>
      ) : null}

      {week.map((date) => (
        <Pressable
          key={date}
          accessibilityRole="button"
          onPress={() => choose(date)}
          className="min-h-14 justify-center rounded-card bg-linen px-4 active:opacity-80">
          <Text className="font-body-bold text-base text-ink">{dayHeading(date, today)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
