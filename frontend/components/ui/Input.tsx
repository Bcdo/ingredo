import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { t } from '../../lib/i18n';
import { usePalette } from '../../lib/usePalette';

type InputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  secureTextEntry?: boolean;
  // Eye button inside the field that reveals/hides a secure entry.
  secureToggle?: boolean;
  autoFocus?: boolean;
  // 'cream' stands out on linen surfaces (cream field, clay border).
  tone?: 'linen' | 'cream';
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
  autoCorrect = true,
  secureTextEntry = false,
  secureToggle = false,
  autoFocus = false,
  tone = 'linen',
  testID,
  className = '',
  maxLength,
}: InputProps) {
  const palette = usePalette();
  const [revealed, setRevealed] = useState(false);
  const toneClasses = tone === 'cream' ? 'border border-clay bg-cream' : 'bg-linen';
  return (
    <View className={className}>
      {label ? <Text className="mb-1 font-body-bold text-sm text-ink">{label}</Text> : null}
      <View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.inkFaint}
          multiline={multiline}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          secureTextEntry={secureTextEntry && !revealed}
          autoFocus={autoFocus}
          testID={testID}
          maxLength={maxLength}
          className={`min-h-14 rounded-card px-4 py-3 font-body text-base text-ink ${toneClasses} ${
            multiline ? 'min-h-24' : ''
          } ${secureToggle ? 'pr-12' : ''}`}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('account.hidePassword') : t('account.showPassword')}
            onPress={() => setRevealed((prev) => !prev)}
            className="absolute bottom-0 right-0 top-0 justify-center px-3">
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={palette.inkMuted}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
