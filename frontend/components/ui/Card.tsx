import React from 'react';
import { View } from 'react-native';

type CardProps = { children: React.ReactNode; className?: string };

export function Card({ children, className = '' }: CardProps) {
  return <View className={`rounded-card bg-linen p-4 ${className}`}>{children}</View>;
}
