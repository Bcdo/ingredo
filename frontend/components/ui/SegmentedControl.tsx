import React from 'react';
import { Pressable, Text, View } from 'react-native';

export type Segment<K extends string> = { key: K; label: string };

type SegmentedControlProps<K extends string> = {
  segments: Segment<K>[];
  selected: K;
  onSelect: (key: K) => void;
};

export function SegmentedControl<K extends string>({
  segments,
  selected,
  onSelect,
}: SegmentedControlProps<K>) {
  return (
    <View className="flex-row gap-2">
      {segments.map((segment) => {
        const isSelected = segment.key === selected;
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="button"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(segment.key)}
            className={`min-h-14 flex-1 items-center justify-center rounded-full px-4 ${
              isSelected ? 'bg-clay' : 'bg-linen'
            } active:opacity-80`}>
            <Text className={`font-body-bold text-sm ${isSelected ? 'text-cream' : 'text-ink'}`}>
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
