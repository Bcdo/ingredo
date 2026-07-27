import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../../lib/db/client';
import { addItems } from '../../lib/db/shoppingList';
import { useActiveHouseholdId } from '../../lib/household';
import { t } from '../../lib/i18n';
import { dismissStaple, getStapleDismissals } from '../../lib/suggestions/dismissals';
import { computeStaples, type StapleSuggestion } from '../../lib/suggestions/staples';

type StaplesSectionProps = {
  active: { normalizedName: string }[];
  purchased: { normalizedName: string; name: string; purchasedAt: number | null }[];
  now: number;
};

// Quiet by design: renders nothing at all when no staple is due, and never
// reads the database until there is a candidate to filter.
export function StaplesSection({ active, purchased, now }: StaplesSectionProps) {
  const householdId = useActiveHouseholdId();
  const [dismissalsVersion, setDismissalsVersion] = useState(0);

  const rows = purchased.filter(
    (item): item is { normalizedName: string; name: string; purchasedAt: number } =>
      item.purchasedAt !== null
  );
  const activeNames = new Set(active.map((item) => item.normalizedName));
  const candidates = computeStaples(rows, now).filter(
    (staple) => !activeNames.has(staple.normalizedName)
  );

  // Hook-order safety: useMemo runs every render; it only touches the
  // settings table when candidates exist.
  const dismissals = useMemo(
    () => (candidates.length > 0 ? getStapleDismissals(db) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dismissalsVersion, candidates.length]
  );

  if (candidates.length === 0) return null;

  const suggestions = candidates.filter((staple) => {
    const dismissedAt = dismissals[staple.normalizedName];
    return dismissedAt === undefined || staple.lastPurchasedAt > dismissedAt;
  });
  if (suggestions.length === 0) return null;

  const latestPurchases: Record<string, number> = {};
  for (const row of rows) {
    const existing = latestPurchases[row.normalizedName];
    if (existing === undefined || row.purchasedAt > existing) {
      latestPurchases[row.normalizedName] = row.purchasedAt;
    }
  }

  const add = (staple: StapleSuggestion) => {
    addItems(
      db,
      householdId,
      [
        {
          name: staple.name,
          normalizedName: staple.normalizedName,
          quantity: null,
          unit: null,
          sources: [],
        },
      ],
      'merge'
    );
  };

  const dismiss = (staple: StapleSuggestion) => {
    dismissStaple(db, staple.normalizedName, latestPurchases);
    setDismissalsVersion((version) => version + 1);
  };

  return (
    <View testID="staples-section">
      <Text className="mt-4 font-display text-lg text-ink opacity-70">
        {t('suggestions.staplesTitle')}
      </Text>
      <View className="mt-2 flex-row flex-wrap gap-2">
        {suggestions.map((staple) => (
          <View
            key={staple.normalizedName}
            className="flex-row items-center rounded-card border-2 border-dashed border-linen">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('suggestions.add', { name: staple.name })}
              onPress={() => add(staple)}
              className="min-h-14 justify-center py-2 pl-4 pr-2 active:opacity-80">
              <Text className="font-body text-base text-ink opacity-70">{staple.name}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('suggestions.dismiss', { name: staple.name })}
              onPress={() => dismiss(staple)}
              className="min-h-14 justify-center py-2 pl-1 pr-3 active:opacity-80">
              <Text className="font-body text-base text-ink opacity-40">×</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
