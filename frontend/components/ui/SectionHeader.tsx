import React from 'react';
import { Text } from 'react-native';

// The one header level for Settings sections: quiet, uppercase, clearly
// not body text.
type SectionHeaderProps = { title: string; className?: string };

export function SectionHeader({ title, className = '' }: SectionHeaderProps) {
  return (
    <Text
      className={`mb-2 font-body-bold text-xs uppercase tracking-wider text-ink opacity-60 ${className}`}>
      {title}
    </Text>
  );
}
