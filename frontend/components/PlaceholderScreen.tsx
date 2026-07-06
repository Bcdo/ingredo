import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

type PlaceholderScreenProps = { icon: keyof typeof Ionicons.glyphMap; message: string };

export function PlaceholderScreen({ icon, message }: PlaceholderScreenProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 bg-cream px-10">
      <Ionicons name={icon} size={48} color="#C96B45" />
      <Text className="text-center font-body text-lg text-ink opacity-70">{message}</Text>
    </View>
  );
}
