import { Ionicons } from '@expo/vector-icons';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '../../../lib/db/client';
import { softDeleteRecipe } from '../../../lib/db/recipes';
import { recipeIngredients, recipeInstructions, recipes } from '../../../lib/db/schema';
import { t } from '../../../lib/i18n';
import { formatQuantity } from '../../../lib/quantity';
import { UNITS } from '../../../lib/units';

function unitLabel(unit: string | null): string {
  if (unit === null) return '';
  return (UNITS as readonly string[]).includes(unit) ? t(`units.${unit}`) : unit;
}

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: recipeRows } = useLiveQuery(
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

  const recipe = recipeRows?.[0];
  if (recipeRows !== undefined && !recipe) {
    return <Redirect href="/(tabs)/recipes" />;
  }
  if (!recipe) return <View className="flex-1 bg-cream" />;

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
        <Text className="mt-3 font-body-bold text-sm text-ink opacity-70">
          {t('recipes.servingsCount', { count: recipe.servings })}
        </Text>

        {(ingredients ?? []).length > 0 ? (
          <>
            <Text className="mt-8 font-display text-xl text-ink">{t('detail.ingredients')}</Text>
            <View className="mt-3 gap-3">
              {(ingredients ?? []).map((ing) => (
                <View key={ing.id} className="flex-row items-baseline gap-3">
                  <Text className="min-w-16 font-display text-base text-clay">
                    {`${formatQuantity(ing.quantity)} ${unitLabel(ing.unit)}`.trim()}
                  </Text>
                  <Text className="flex-1 font-body text-base text-ink">{ing.name}</Text>
                </View>
              ))}
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
    </View>
  );
}
