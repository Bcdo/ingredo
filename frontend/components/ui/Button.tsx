import React from 'react';
import { Pressable, Text } from 'react-native';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled = false }: ButtonProps) {
  const base = 'min-h-14 items-center justify-center rounded-card px-6 py-4';
  const look = variant === 'primary' ? 'bg-clay' : 'bg-linen';
  const text = variant === 'primary' ? 'text-cream' : 'text-ink';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`${base} ${look} ${disabled ? 'opacity-40' : 'active:opacity-80'}`}>
      <Text className={`font-body-bold text-lg ${text}`}>{label}</Text>
    </Pressable>
  );
}
