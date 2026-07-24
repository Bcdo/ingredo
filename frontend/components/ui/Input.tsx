import React from 'react';
import { Text, TextInput, View } from 'react-native';

import { usePalette } from '../../lib/usePalette';

type InputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
  testID?: string;
  className?: string;
  maxLength?: number;
};

export function Input({
  value,
  onChangeText,
  placeholder,
  label,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  secureTextEntry = false,
  testID,
  className = '',
  maxLength,
}: InputProps) {
  const palette = usePalette();
  return (
    <View className={className}>
      {label ? <Text className="mb-1 font-body-bold text-sm text-ink">{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkFaint}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        testID={testID}
        maxLength={maxLength}
        className={`min-h-14 rounded-card bg-linen px-4 py-3 font-body text-base text-ink ${
          multiline ? 'min-h-24' : ''
        }`}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}
