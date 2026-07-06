import { Ionicons } from '@expo/vector-icons';
import { desc, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db/client';
import { recipeIngredients, recipes } from '../../lib/db/schema';
import { t } from '../../lib/i18n';
import { filterRecipes } from '../../lib/search';

type ListItem = { id: string; title: string; servings: number; ingredientNames: string[] };

export default function RecipesScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const { data: recipeRows } = useLiveQuery(
    db.select().from(recipes).where(isNull(recipes.deletedAt)).orderBy(desc(recipes.updatedAt))
  );
  const { data: ingredientRows } = useLiveQuery(
    db
      .select({ recipeId: recipeIngredients.recipeId, name: recipeIngredients.name })
      .from(recipeIngredients)
  );

  const items: ListItem[] = useMemo(() => {
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
  const hasRecipes = items.length > 0;

  return (
    <View className="flex-1 bg-cream">
      {hasRecipes ? (
        <>
          <View className="px-4 pt-3">
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
            numColumns={2}
            columnWrapperClassName="gap-3 px-4"
            contentContainerClassName="gap-3 py-4"
            ListEmptyComponent={
              <Text className="px-4 pt-8 text-center font-body text-base text-ink opacity-70">
                {t('recipes.noResults')}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                className="flex-1 active:opacity-80"
                onPress={() => router.push(`/recipe/${item.id}`)}>
                <Card className="min-h-28 justify-between">
                  <Text className="font-display text-lg text-ink" numberOfLines={3}>
                    {item.title}
                  </Text>
                  <Text className="mt-2 font-body text-sm text-ink opacity-70">
                    {t('recipes.servingsCount', { count: item.servings })}
                  </Text>
                </Card>
              </Pressable>
            )}
          />
        </>
      ) : (
        <EmptyState
          title={t('recipes.emptyTitle')}
          body={t('recipes.emptyBody')}
          actionLabel={t('recipes.emptyAction')}
          onAction={() => router.push('/recipe/new')}
        />
      )}
      {hasRecipes ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('recipes.addRecipe')}
          onPress={() => router.push('/recipe/new')}
          className="absolute bottom-6 right-6 h-16 w-16 items-center justify-center rounded-full bg-clay shadow-lg active:opacity-80">
          <Ionicons name="add" size={32} color="#FBF7F1" />
        </Pressable>
      ) : null}
    </View>
  );
}
