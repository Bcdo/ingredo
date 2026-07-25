import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '../../lib/i18n';
import type { RecipeIdea } from '../../lib/suggestions/recipeIdeas';

type RailItem = { id: string; title: string };

type IdeasRailProps<T extends RailItem> = {
  ideas: RecipeIdea[];
  items: T[];
  onSelect: (item: T) => void;
};

// Quiet by design: nothing renders when history has nothing to say.
export function IdeasRail<T extends RailItem>({ ideas, items, onSelect }: IdeasRailProps<T>) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const resolved = ideas.flatMap((idea) => {
    const item = byId.get(idea.recipeId);
    return item ? [{ idea, item }] : [];
  });
  if (resolved.length === 0) return null;

  return (
    <View className="pt-3">
      <Text className="px-4 font-body-bold text-sm text-ink opacity-60">
        {t('suggestions.ideasTitle')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pt-2">
        {resolved.map(({ idea, item }) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => onSelect(item)}
            className="max-w-48 rounded-card bg-linen px-4 py-3 active:opacity-80">
            <Text className="font-display text-base text-ink" numberOfLines={2}>
              {item.title}
            </Text>
            <Text className="font-body text-xs text-ink opacity-60">
              {t(idea.kind === 'favorite' ? 'suggestions.reasonFavorite' : 'suggestions.reasonWhile')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
