import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutLeft,
  LinearTransition,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { usePalette } from '../../lib/usePalette';

// How long the sage "checked" moment shows before the purchase is written and
// the row leaves. Long enough to register, short enough not to feel laggy.
export const CHECK_OFF_MS = 260;

type ShoppingRowProps = {
  id: string;
  name: string;
  quantity: string;
  sources: string[];
  onPurchase: (id: string) => void;
  onLongPress: () => void;
};

// One active list row. A tap tints the card sage with a checkmark, then hands
// the purchase up; the live query drops the row and the exiting animation
// slides it away while siblings close the gap via the layout transition.
export function ShoppingRow({
  id,
  name,
  quantity,
  sources,
  onPurchase,
  onLongPress,
}: ShoppingRowProps) {
  const palette = usePalette();
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progress = useSharedValue(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const check = () => {
    if (checking) return;
    setChecking(true);
    progress.value = withTiming(1, { duration: 160 });
    timer.current = setTimeout(() => onPurchase(id), CHECK_OFF_MS);
  };

  const surface = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.linen, palette.sage]),
  }));

  const ink = checking ? 'text-cream' : 'text-ink';
  const accent = checking ? 'text-cream' : 'text-clay';

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutLeft.duration(220)}
      layout={LinearTransition.duration(220)}>
      <Pressable
        testID={`shop-row-${id}`}
        accessibilityRole="button"
        accessibilityState={{ checked: checking }}
        onPress={check}
        onLongPress={onLongPress}
        className="active:opacity-80">
        <Animated.View
          style={[{ minHeight: 56, borderRadius: 20, padding: 16 }, surface]}
          className="flex-row items-center gap-3">
          {quantity ? <Text className={`font-display text-base ${accent}`}>{quantity}</Text> : null}
          <View className="flex-1">
            <Text className={`font-body-bold text-base ${ink}`}>{name}</Text>
            {sources.length > 0 ? (
              <Text className={`font-body text-xs ${ink} opacity-60`}>{sources.join(' · ')}</Text>
            ) : null}
          </View>
          {checking ? <Ionicons name="checkmark-circle" size={22} color={palette.cream} /> : null}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
