import React from 'react';

import { formatCode } from '../../lib/codeFormat';
import { Input } from './Input';

type CodeInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  tone?: 'linen' | 'cream';
  testID?: string;
  className?: string;
};

export function CodeInput({ value, onChangeText, ...rest }: CodeInputProps) {
  return (
    <Input
      {...rest}
      value={value}
      onChangeText={(next) => onChangeText(formatCode(next, value))}
      autoCapitalize="characters"
      autoCorrect={false}
      maxLength={7}
    />
  );
}
