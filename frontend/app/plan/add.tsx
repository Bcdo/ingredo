import { desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Stepper } from '../../components/ui/Stepper';
import { db } from '../../lib/db/client';
import { addPlanEntry } from '../../lib/db/mealPlan';
import { recipeIngredients, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { filterRecipes } from '../../lib/search';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type PickerItem = { id: string; title: string; servings: number; ingredientNames: string[] };

export default function AddPlanEntryScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PickerItem | null>(null);
  const [servings, setServings] = useState(1);
  const [saveFailed, setSaveFailed] = useState(false);

  const { data: recipeRows } = useLiveQuery(
    db.select().from(recipes).where(isNull(recipes.deletedAt)).orderBy(desc(recipes.updatedAt))
  );
  const { data: ingredientRows } = useLiveQuery(
    db
      .select({ recipeId: recipeIngredients.recipeId, name: recipeIngredients.name })
      .from(recipeIngredients)
  );

  const items: PickerItem[] = useMemo(() => {
    const namesByRecipe = new Map<string, string[]>();
    for (const row of ingredientRows ?? []) {
      const names = namesByRecipe.get(row.recipeId) ?? [];
      names.push(row.name);
      namesByRecipe.set(row.recipeId, names);
    }
    return (recipeRows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      servings: r.servings,
      ingredientNames: namesByRecipe.get(r.id) ?? [],
    }));
  }, [recipeRows, ingredientRows]);

  const filtered = useMemo(() => filterRecipes(items, query), [items, query]);

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return <Redirect href="/(tabs)/plan" />;
  }

  const select = (item: PickerItem) => {
    setSelected(item);
    setServings(item.servings);
  };

  const add = () => {
    if (!selected) return;
    try {
      addPlanEntry(db, { date, recipeId: selected.id, servings });
      router.back();
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="min-h-14 justify-center pr-4">
          <Text className="font-body-bold text-base text-ink">{t('form.cancel')}</Text>
        </Pressable>
        <Text className="font-display text-xl text-ink">{t('plan.pickRecipeTitle')}</Text>
        <View className="w-14" />
      </View>

      {saveFailed ? (
        <View className="mx-4 mb-2 rounded-card bg-butter px-4 py-3">
          <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title={t('recipes.emptyTitle')}
          body={t('recipes.emptyBody')}
          actionLabel={t('recipes.emptyAction')}
          onAction={() => router.push('/recipe/new')}
        />
      ) : (
        <>
          <View className="px-4">
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('recipes.searchPlaceholder')}
              placeholderTextColor="#3A322B66"
              className="min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerClassName="gap-3 p-4"
            ListEmptyComponent={
              <Text className="pt-8 text-center font-body text-base text-ink opacity-70">
                {t('recipes.noResults')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => select(item)}
                className={`rounded-card p-4 active:opacity-80 ${
                  selected?.id === item.id ? 'bg-clay' : 'bg-linen'
                }`}>
                <Text
                  className={`font-display text-lg ${
                    selected?.id === item.id ? 'text-cream' : 'text-ink'
                  }`}
                  numberOfLines={2}>
                  {item.title}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {selected ? (
        <View
          className="gap-3 border-t border-linen bg-cream px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="flex-row items-center justify-between">
            <Text className="font-body-bold text-sm text-ink">{t('form.servingsLabel')}</Text>
            <Stepper value={servings} onChange={setServings} min={1} />
          </View>
          <Button label={t('plan.add')} onPress={add} />
        </View>
      ) : null}
    </View>
  );
}
