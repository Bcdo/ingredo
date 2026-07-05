import React from 'react';
import { Pressable, Text, View } from 'react-native';

type StepperProps = { value: number; onChange: (value: number) => void; min?: number };

export function Stepper({ value, onChange, min = 1 }: StepperProps) {
  const canDecrement = value > min;
  return (
    <View className="flex-row items-center gap-4">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="decrement"
        onPress={() => canDecrement && onChange(value - 1)}
        className={`h-14 w-14 items-center justify-center rounded-card bg-linen ${
          canDecrement ? 'active:opacity-80' : 'opacity-40'
        }`}>
        <Text className="font-display text-2xl text-ink">−</Text>
      </Pressable>
      <Text className="min-w-10 text-center font-display text-2xl text-clay">{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="increment"
        onPress={() => onChange(value + 1)}
        className="h-14 w-14 items-center justify-center rounded-card bg-linen active:opacity-80">
        <Text className="font-display text-2xl text-ink">+</Text>
      </Pressable>
    </View>
  );
}
