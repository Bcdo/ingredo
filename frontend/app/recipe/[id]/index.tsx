import { Ionicons } from '@expo/vector-icons';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../../components/ui/Button';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { Stepper } from '../../../components/ui/Stepper';
import { db } from '../../../lib/db/client';
import { softDeleteRecipe } from '../../../lib/db/recipes';
import { getUnitSystem, setUnitSystem, type UnitSystem } from '../../../lib/db/settings';
import { recipeIngredients, recipeInstructions, recipes } from '../../../lib/db/schema';
import { currentLocale, t } from '../../../lib/i18n';
import { displayQuantity } from '../../../lib/measure';
import { isLocalizableUnit } from '../../../lib/units';

function unitLabel(unit: string | null): string {
  if (unit === null) return '';
  return isLocalizableUnit(unit) ? t(`units.${unit}`) : unit;
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const [system, setSystem] = useState<UnitSystem>(() => getUnitSystem(db));

  const { data: recipeRows, updatedAt } = useLiveQuery(
    db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), isNull(recipes.deletedAt))),
    [id]
  );
  const { data: ingredients } = useLiveQuery(
    db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(asc(recipeIngredients.sortOrder)),
    [id]
  );
  const { data: instructions } = useLiveQuery(
    db
      .select()
      .from(recipeInstructions)
      .where(eq(recipeInstructions.recipeId, id))
      .orderBy(asc(recipeInstructions.sortOrder)),
    [id]
  );

  const recipe = recipeRows[0];
  if (updatedAt !== undefined && !recipe) {
    return <Redirect href="/(tabs)/recipes" />;
  }
  if (!recipe) return <View className="flex-1 bg-cream" />;

  const selectedServings = servingsOverride ?? recipe.servings;
  const scaleFactor = selectedServings / recipe.servings;
  const locale = currentLocale();

  const changeSystem = (next: UnitSystem) => {
    setSystem(next);
    setUnitSystem(db, next);
  };

  const confirmDelete = () => {
    Alert.alert(t('detail.deleteTitle'), t('detail.deleteMessage', { title: recipe.title }), [
      { text: t('detail.deleteCancel'), style: 'cancel' },
      {
        text: t('detail.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          softDeleteRecipe(db, recipe.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="min-h-14 justify-center pr-4">
          <Ionicons name="chevron-back" size={24} color="#3A322B" />
        </Pressable>
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/recipe/${recipe.id}/edit`)}
            className="min-h-14 justify-center px-3">
            <Text className="font-body-bold text-base text-clay">{t('detail.edit')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirmDelete}
            className="min-h-14 justify-center px-3">
            <Text className="font-body-bold text-base text-ink opacity-70">
              {t('detail.delete')}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Text className="font-display-bold text-3xl text-ink">{recipe.title}</Text>
        {recipe.description ? (
          <Text className="mt-2 font-body text-base text-ink opacity-80">{recipe.description}</Text>
        ) : null}
        <View className="mt-4 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="font-body-bold text-sm text-ink">{t('detail.servings')}</Text>
            <Stepper value={selectedServings} onChange={setServingsOverride} min={1} />
          </View>
          <SegmentedControl
            segments={[
              { key: 'metric', label: t('detail.unitsMetric') },
              { key: 'us', label: t('detail.unitsUS') },
            ]}
            selected={system}
            onSelect={changeSystem}
          />
        </View>

        {(ingredients ?? []).length > 0 ? (
          <>
            <Text className="mt-8 font-display text-xl text-ink">{t('detail.ingredients')}</Text>
            <View className="mt-3 gap-3">
              {(ingredients ?? []).map((ing) => {
                const display = displayQuantity(ing.quantity, ing.unit, {
                  scaleFactor,
                  system,
                  locale,
                  scaling: ing.scaling,
                });
                const showHint =
                  ing.scaling === 'fixed' && ing.quantity !== null && scaleFactor !== 1;
                return (
                  <View key={ing.id} className="flex-row items-baseline gap-3">
                    <Text className="min-w-16 font-display text-base text-clay">
                      {display ? `${display.amountText} ${unitLabel(display.unitCode)}`.trim() : ''}
                    </Text>
                    <Text className="flex-1 font-body text-base text-ink">
                      {ing.name}
                      {showHint ? (
                        <Text className="font-body text-xs text-ink opacity-50">
                          {'  ·  '}
                          {t('detail.adjustToTaste')}
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        {(instructions ?? []).length > 0 ? (
          <>
            <Text className="mt-8 font-display text-xl text-ink">{t('detail.method')}</Text>
            <View className="mt-3 gap-4">
              {(instructions ?? []).map((step, index) => (
                <View key={step.id} className="flex-row gap-4">
                  <Text className="font-display-bold text-2xl text-clay">{index + 1}</Text>
                  <Text className="flex-1 font-body text-base leading-relaxed text-ink">
                    {step.text}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {recipe.notes ? (
          <>
            <Text className="mt-8 font-display text-xl text-ink">{t('detail.notes')}</Text>
            <Text className="mt-2 font-body text-base text-ink opacity-80">{recipe.notes}</Text>
          </>
        ) : null}
      </ScrollView>

      <View className="px-5 pt-2" style={{ paddingBottom: insets.bottom + 8 }}>
        <Button
          label={t('detail.planIt')}
          onPress={() => router.push(`/plan/pick-day?recipe=${recipe.id}`)}
        />
      </View>
    </View>
  );
}
