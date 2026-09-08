import { and, asc, desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { QuantityEditor, type QuantityEditorItem } from '../../components/shop/QuantityEditor';
import { ShoppingRow } from '../../components/shop/ShoppingRow';
import { StaplesSection } from '../../components/shop/StaplesSection';
import { EmptyState } from '../../components/ui/EmptyState';
import { db } from '../../lib/db/client';
import { FIELD_LIMITS } from '../../lib/fieldLimits';
import { inHousehold, notDeleted } from '../../lib/db/predicates';
import { useActiveHouseholdId } from '../../lib/household';
import { shoppingItems } from '../../lib/db/schema';
import { getUnitSystem, type UnitSystem } from '../../lib/db/settings';
import {
  addManualItem,
  parseSources,
  purchaseItem,
  readdItem,
  restoreItem,
  setItemQuantity,
} from '../../lib/db/shoppingList';
import { currentLocale, t } from '../../lib/i18n';
import { displayQuantity } from '../../lib/measure';
import { usePalette } from '../../lib/usePalette';
import { groupShelfItems } from '../../lib/shelf';
import { itemKey } from '../../lib/shopping';
import { unitLabel } from '../../lib/unitLabel';

export default function ShopScreen() {
  const palette = usePalette();
  const householdId = useActiveHouseholdId();
  const [draft, setDraft] = useState('');
  const [system, setSystem] = useState<UnitSystem>(() => getUnitSystem(db));
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<QuantityEditorItem | null>(null);
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
  const { data: purchasedItems } = useLiveQuery(
    db
      .select()
      .from(shoppingItems)
      .where(
        and(
          eq(shoppingItems.status, 'purchased'),
          notDeleted(shoppingItems),
          inHousehold(shoppingItems, householdId)
        )
      )
      .orderBy(desc(shoppingItems.purchasedAt)),
    [householdId]
  );

  const submitDraft = () => {
    if (addManualItem(db, householdId, draft)) setDraft('');
  };

  // Row movement is animated by Reanimated entering/exiting/layout props on
  // the rows themselves, so the writes need no animation scheduling here.
  const purchase = (id: string) => purchaseItem(db, householdId, id);
  const restore = (id: string) => restoreItem(db, householdId, id);
  const readd = (id: string) => readdItem(db, householdId, id);

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
          {(activeItems ?? []).map((item) => (
            <ShoppingRow
              key={item.id}
              id={item.id}
              name={item.name}
              quantity={quantityText(item.quantity, item.unit)}
              sources={parseSources(item.sources)}
              onPurchase={purchase}
              onLongPress={() =>
                setEditing({
                  id: item.id,
                  name: item.name,
                  quantity: item.quantity,
                  unit: item.unit,
                })
              }
            />
          ))}
          <StaplesSection active={activeItems ?? []} purchased={purchasedItems ?? []} now={now} />
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
                      <Animated.View
                        key={item.id}
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(160)}
                        layout={LinearTransition.duration(220)}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => section.onTap(item.id)}
                          className="min-h-14 justify-center rounded-card border-2 border-dashed border-linen px-4 active:opacity-80">
                          <Text className="font-body text-base text-ink opacity-60">
                            {item.name}
                          </Text>
                        </Pressable>
                      </Animated.View>
                    ))}
                  </React.Fragment>
                ) : null
              )}
            </>
          ) : null}
        </ScrollView>
      )}
      {editing ? (
        <QuantityEditor
          item={editing}
          onCancel={() => setEditing(null)}
          onSave={(quantity, unit) => {
            setItemQuantity(db, householdId, editing.id, quantity, unit);
            setEditing(null);
          }}
        />
      ) : null}
    </View>
  );
}
