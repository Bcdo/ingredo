import React from 'react';
import { Text, View } from 'react-native';

import { Button } from './Button';

type EmptyStateProps = { title: string; body: string; actionLabel?: string; onAction?: () => void };

export function EmptyState({ title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text className="text-center font-display text-2xl text-ink">{title}</Text>
      <Text className="text-center font-body text-base text-ink opacity-70">{body}</Text>
      {actionLabel && onAction ? (
        <View className="mt-4 self-stretch">
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
