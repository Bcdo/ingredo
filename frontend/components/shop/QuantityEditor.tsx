import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { t } from '../../lib/i18n';
import { unitLabel } from '../../lib/unitLabel';
import { UNITS } from '../../lib/units';
import { usePalette } from '../../lib/usePalette';
import { Button } from '../ui/Button';

export type QuantityEditorItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
};

type QuantityEditorProps = {
  item: QuantityEditorItem;
  onSave: (quantity: number | null, unit: string | null) => void;
  onCancel: () => void;
};

// Amount-and-unit only: renaming is delete-and-retype territory, and the
// editor is reachable only from ACTIVE rows (purchased history stays
// immutable). Mounted fresh per item, so plain useState initializers hold
// the current values.
export function QuantityEditor({ item, onSave, onCancel }: QuantityEditorProps) {
  const palette = usePalette();
  const [amountText, setAmountText] = useState(item.quantity === null ? '' : String(item.quantity));
  const [unit, setUnit] = useState<string | null>(item.unit);

  const save = () => {
    const parsed = Number(amountText.trim().replace(',', '.'));
    const quantity =
      amountText.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    onSave(quantity, quantity === null ? null : unit);
  };

  const chips: { key: string; label: string; value: string | null; testID?: string }[] = [
    { key: 'none', label: t('form.unitNone'), value: null, testID: 'unit-none' },
    ...UNITS.map((code) => ({ key: code, label: unitLabel(code), value: code as string })),
  ];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('form.cancel')}
        onPress={onCancel}
        className="flex-1 justify-end bg-black/40">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable onPress={() => {}} className="rounded-t-card bg-cream p-4 pb-8">
            <Text className="font-display text-lg text-ink" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="mt-3 font-body-bold text-sm text-ink">{t('shop.editAmount')}</Text>
            <TextInput
              testID="quantity-input"
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={palette.inkFaint}
              className="mt-1 min-h-14 rounded-card bg-linen px-4 font-body text-base text-ink"
            />
            <View className="mt-3 flex-row flex-wrap gap-2">
              {chips.map((chip) => (
                <Pressable
                  key={chip.key}
                  testID={chip.testID}
                  accessibilityRole="button"
                  onPress={() => setUnit(chip.value)}
                  className={`min-h-14 items-center justify-center rounded-card px-4 ${
                    unit === chip.value ? 'bg-clay' : 'bg-linen'
                  }`}>
                  <Text
                    className={`font-body-bold text-base ${
                      unit === chip.value ? 'text-cream' : 'text-ink'
                    }`}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View className="mt-4 gap-2">
              <Button label={t('form.save')} onPress={save} />
              <Button label={t('form.cancel')} onPress={onCancel} variant="ghost" />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
