import { and, asc, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db/client';
import { FIELD_LIMITS } from '../../lib/fieldLimits';
import { notDeleted } from '../../lib/db/predicates';
import { shoppingItems } from '../../lib/db/schema';
import { getUnitSystem, type UnitSystem } from '../../lib/db/settings';
import {
  addManualItem,
  parseSources,
  purchaseItem,
  readdItem,
  restoreItem,
} from '../../lib/db/shoppingList';
import { currentLocale, t } from '../../lib/i18n';
import { displayQuantity } from '../../lib/measure';
import { usePalette } from '../../lib/usePalette';
import { groupShelfItems } from '../../lib/shelf';
import { itemKey } from '../../lib/shopping';
import { unitLabel } from '../../lib/unitLabel';

export default function ShopScreen() {
  const palette = usePalette();
  const [draft, setDraft] = useState('');
  const [system, setSystem] = useState<UnitSystem>(() => getUnitSystem(db));
  const [now, setNow] = useState(() => Date.now());
  const locale = currentLocale();

  useFocusEffect(
    useCallback(() => {
      setSystem(getUnitSystem(db));
      setNow(Date.now());
    }, [])
  );

  const { data: activeItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.status, 'active'), notDeleted(shoppingItems)))
      .orderBy(asc(shoppingItems.createdAt))
  );
  const { data: purchasedItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.status, 'purchased'), notDeleted(shoppingItems)))
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

  const readd = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    readdItem(db, id);
  };

  const quantityText = (quantity: number | null, unit: string | null) => {
    const display = displayQuantity(quantity, unit, { scaleFactor: 1, system, locale });
    return display ? `${display.amountText} ${unitLabel(display.unitCode)}`.trim() : '';
  };

  const shelf = groupShelfItems(
    purchasedItems ?? [],
    new Set((activeItems ?? []).map((item) => itemKey(item))),
    now
  );
  const shelfSections = [
    { key: 'trip', label: t('shop.groupTrip'), rows: shelf.trip, onTap: restore },
    { key: 'week', label: t('shop.groupWeek'), rows: shelf.week, onTap: readd },
    { key: 'older', label: t('shop.groupOlder'), rows: shelf.older, onTap: readd },
  ];
  const hasShelf = shelfSections.some((section) => section.rows.length > 0);

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
          maxLength={FIELD_LIMITS.shoppingItemName}
          placeholder={t('shop.quickAddPlaceholder')}
          placeholderTextColor={palette.inkFaint}
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
          {hasShelf ? (
            <>
              <Text className="mt-4 font-display text-lg text-ink opacity-70">
                {t('shop.recentlyPurchased')}
              </Text>
              {shelfSections.map((section) =>
                section.rows.length > 0 ? (
                  <React.Fragment key={section.key}>
                    <Text className="mt-2 font-body-bold text-sm text-ink opacity-60">
                      {section.label}
                    </Text>
                    {section.rows.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        onPress={() => section.onTap(item.id)}
                        className="min-h-14 justify-center rounded-card border-2 border-dashed border-linen px-4 active:opacity-80">
                        <Text className="font-body text-base text-ink opacity-60">{item.name}</Text>
                      </Pressable>
                    ))}
                  </React.Fragment>
                ) : null
              )}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
