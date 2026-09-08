import { Ionicons } from '@expo/vector-icons';
import { and, asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../../lib/db/client';
import { inHousehold, notDeleted } from '../../lib/db/predicates';
import { shoppingItems } from '../../lib/db/schema';
import { parseSources } from '../../lib/db/shoppingList';
import { useActiveHouseholdId } from '../../lib/household';
import { t } from '../../lib/i18n';
import { usePalette } from '../../lib/usePalette';
import { Card } from '../ui/Card';

type ShoppingCardProps = {
  // Titles of the dinners the Today screen is showing. The card is a
  // reminder for those meals only: it lists the active items that were added
  // from one of them and hides when nothing is outstanding.
  dinnerTitles: string[];
};

export function ShoppingCard({ dinnerTitles }: ShoppingCardProps) {
  const router = useRouter();
  const palette = usePalette();
  const householdId = useActiveHouseholdId();

  const { data: rows } = useLiveQuery(
    db
      .select({ id: shoppingItems.id, name: shoppingItems.name, sources: shoppingItems.sources })
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.status, 'active'),
          notDeleted(shoppingItems),
          inHousehold(shoppingItems, householdId)
        )
      )
      .orderBy(asc(shoppingItems.createdAt)),
    [householdId]
  );

  // Attribution is by recipe title, which is what the list stores per item.
  const wanted = new Set(dinnerTitles);
  const items = (rows ?? []).filter((row) =>
    parseSources(row.sources).some((title) => wanted.has(title))
  );
  if (items.length === 0) return null;

  const preview =
    items
      .slice(0, 3)
      .map((row) => row.name)
      .join(', ') + (items.length > 3 ? '…' : '');

  return (
    <View className="gap-3">
      <Text className="font-display text-xl text-ink">{t('today.shopForDinner')}</Text>
      <Pressable
        accessibilityRole="button"
        className="active:opacity-80"
        onPress={() => router.push('/(tabs)/shop')}>
        <Card className="gap-1">
          <View className="flex-row items-center justify-between">
            <Text className="font-body text-base text-ink">
              {t('today.itemsToBuy', { count: items.length })}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={palette.ink} />
          </View>
          <Text className="font-body text-sm text-ink opacity-70" numberOfLines={1}>
            {preview}
          </Text>
        </Card>
      </Pressable>
    </View>
  );
}
