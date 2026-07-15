import { asc, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db/client';
import { shoppingItems } from '../../lib/db/schema';
import { getUnitSystem, type UnitSystem } from '../../lib/db/settings';
import { addManualItem, parseSources, purchaseItem, restoreItem } from '../../lib/db/shoppingList';
import { currentLocale, t } from '../../lib/i18n';
import { displayQuantity } from '../../lib/measure';
import { unitLabel } from '../../lib/unitLabel';

export default function ShopScreen() {
  const [draft, setDraft] = useState('');
  const [system, setSystem] = useState<UnitSystem>(() => getUnitSystem(db));
  const locale = currentLocale();

  useFocusEffect(
    useCallback(() => {
      setSystem(getUnitSystem(db));
    }, [])
  );

  const { data: activeItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'active'))
      .orderBy(asc(shoppingItems.createdAt))
  );
  const { data: purchasedItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(eq(shoppingItems.status, 'purchased'))
      .orderBy(desc(shoppingItems.purchasedAt))
  );

  const submitDraft = () => {
    if (addManualItem(db, draft)) setDraft('');
  };

  const purchase = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    purchaseItem(db, id);
  };

  const restore = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    restoreItem(db, id);
  };

  const quantityText = (quantity: number | null, unit: string | null) => {
    const display = displayQuantity(quantity, unit, { scaleFactor: 1, system, locale });
    return display ? `${display.amountText} ${unitLabel(display.unitCode)}`.trim() : '';
  };

  const isEmpty = (activeItems ?? []).length === 0 && (purchasedItems ?? []).length === 0;

  return (
    <View className="flex-1 bg-cream">
      <View className="px-4 pt-3">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          returnKeyType="done"
          blurOnSubmit={false}
          placeholder={t('shop.quickAddPlaceholder')}
          placeholderTextColor="#3A322B66"
          className="min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
        />
      </View>
      {isEmpty ? (
        <EmptyState title={t('shop.emptyTitle')} body={t('shop.emptyBody')} />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
          {(activeItems ?? []).map((item) => {
            const sources = parseSources(item.sources);
            const quantity = quantityText(item.quantity, item.unit);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => purchase(item.id)}
                className="active:opacity-80">
                <Card className="min-h-14 flex-row items-center gap-3">
                  {quantity ? (
                    <Text className="font-display text-base text-clay">{quantity}</Text>
                  ) : null}
                  <View className="flex-1">
                    <Text className="font-body-bold text-base text-ink">{item.name}</Text>
                    {sources.length > 0 ? (
                      <Text className="font-body text-xs text-ink opacity-60">
                        {sources.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          })}
          {(purchasedItems ?? []).length > 0 ? (
            <>
              <Text className="mt-4 font-display text-lg text-ink opacity-70">
                {t('shop.recentlyPurchased')}
              </Text>
              {(purchasedItems ?? []).map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => restore(item.id)}
                  className="min-h-14 justify-center rounded-card border-2 border-dashed border-linen px-4 active:opacity-80">
                  <Text className="font-body text-base text-ink opacity-60">{item.name}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
