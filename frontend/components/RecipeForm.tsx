import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Sortable from 'react-native-sortables';

import { Input } from './ui/Input';
import { Stepper } from './ui/Stepper';
import { FIELD_LIMITS } from '../lib/fieldLimits';
import {
  draftKey,
  formStateFromImport,
  type IngredientDraft,
  type RecipeFormState,
} from '../lib/form';
import { t } from '../lib/i18n';
import { fetchRecipeFromUrl } from '../lib/import/fetchRecipe';
import { usePalette } from '../lib/usePalette';
import { UNITS } from '../lib/units';

type RecipeFormProps = {
  heading: string;
  initialState: RecipeFormState;
  onSave: (state: RecipeFormState) => void;
  allowImport?: boolean;
};

function UnitPicker({
  ingredient,
  onChange,
}: {
  ingredient: IngredientDraft;
  onChange: (unit: string | null) => void;
}) {
  const isCanonical =
    ingredient.unit === null || (UNITS as readonly string[]).includes(ingredient.unit);
  const [otherMode, setOtherMode] = useState(!isCanonical);

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row">
        <View className="flex-row gap-2">
          <UnitChip
            label={t('form.unitNone')}
            selected={!otherMode && ingredient.unit === null}
            onPress={() => {
              setOtherMode(false);
              onChange(null);
            }}
          />
          {UNITS.map((code) => (
            <UnitChip
              key={code}
              label={t(`units.${code}`)}
              selected={!otherMode && ingredient.unit === code}
              onPress={() => {
                setOtherMode(false);
                onChange(code);
              }}
            />
          ))}
          <UnitChip
            label={t('form.unitOther')}
            selected={otherMode}
            onPress={() => {
              setOtherMode(true);
              onChange(
                ingredient.unit && !(UNITS as readonly string[]).includes(ingredient.unit)
                  ? ingredient.unit
                  : ''
              );
            }}
          />
        </View>
      </ScrollView>
      {otherMode ? (
        <Input
          value={ingredient.unit ?? ''}
          onChangeText={(text) => onChange(text)}
          placeholder={t('form.unitOtherPlaceholder')}
          className="mt-2"
        />
      ) : null}
    </View>
  );
}

function UnitChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`min-h-10 items-center justify-center rounded-full px-4 py-2 ${
        selected ? 'bg-clay' : 'bg-linen'
      } active:opacity-80`}>
      <Text className={`font-body-bold text-sm ${selected ? 'text-cream' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RecipeForm({
  heading,
  initialState,
  onSave,
  allowImport = false,
}: RecipeFormProps) {
  const insets = useSafeAreaInsets();
  const palette = usePalette();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const [state, setState] = useState<RecipeFormState>(initialState);
  const [initial] = useState<RecipeFormState>(initialState);
  const [saveFailed, setSaveFailed] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState(false);
  const canImport = importUrl.trim() !== '' && !importing;

  const runImport = async () => {
    setImporting(true);
    setImportFailed(false);
    try {
      const imported = await fetchRecipeFromUrl(importUrl);
      if (imported) {
        setState(formStateFromImport(imported));
      } else {
        setImportFailed(true);
      }
    } finally {
      setImporting(false);
    }
  };

  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  const canSave = state.title.trim() !== '';

  const patch = (partial: Partial<RecipeFormState>) => setState((s) => ({ ...s, ...partial }));

  const patchIngredient = (key: string, partial: Partial<IngredientDraft>) =>
    patch({
      ingredients: state.ingredients.map((ing) => (ing.key === key ? { ...ing, ...partial } : ing)),
    });

  const handleCancel = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(t('form.discardTitle'), t('form.discardMessage'), [
      { text: t('form.discardCancel'), style: 'cancel' },
      { text: t('form.discardConfirm'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const handleSave = () => {
    try {
      onSave(state);
      router.back();
    } catch {
      setSaveFailed(true);
    }
  };

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }}>
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            accessibilityRole="button"
            onPress={handleCancel}
            className="min-h-14 justify-center pr-4">
            <Text className="font-body-bold text-base text-ink">{t('form.cancel')}</Text>
          </Pressable>
          <Text className="font-display text-xl text-ink">{heading}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={handleSave}
            className={`min-h-14 justify-center pl-4 ${canSave ? '' : 'opacity-40'}`}>
            <Text className="font-body-bold text-base text-clay">{t('form.save')}</Text>
          </Pressable>
        </View>

        {saveFailed ? (
          <View className="mx-4 mb-2 rounded-card bg-butter px-4 py-3">
            <Text className="font-body text-sm text-ink">{t('form.saveError')}</Text>
          </View>
        ) : null}

        <Animated.ScrollView
          ref={scrollRef}
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: insets.bottom + 32, gap: 16 }}
          keyboardShouldPersistTaps="handled">
          {allowImport ? (
            <View className="gap-2">
              <View className="flex-row gap-2">
                <Input
                  value={importUrl}
                  onChangeText={(next) => {
                    setImportUrl(next);
                    setImportFailed(false);
                  }}
                  placeholder={t('import.placeholder')}
                  className="flex-1"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canImport }}
                  disabled={!canImport}
                  onPress={runImport}
                  className={`min-h-14 items-center justify-center rounded-card bg-clay px-4 ${
                    canImport ? '' : 'opacity-40'
                  } active:opacity-80`}>
                  <Text className="font-body-bold text-base text-cream">
                    {importing ? t('import.importing') : t('import.button')}
                  </Text>
                </Pressable>
              </View>
              {importFailed ? (
                <View className="rounded-card bg-butter px-4 py-3">
                  <Text className="font-body text-sm text-ink">{t('import.failed')}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <View>
            <Input
              label={t('form.titleLabel')}
              value={state.title}
              onChangeText={(title) => patch({ title })}
              placeholder={t('form.titlePlaceholder')}
              maxLength={FIELD_LIMITS.recipeTitle}
            />
            {!canSave ? (
              <Text className="mt-1 font-body text-xs text-ink opacity-60">
                {t('form.titleHint')}
              </Text>
            ) : null}
          </View>

          <Input
            label={t('form.descriptionLabel')}
            value={state.description}
            onChangeText={(description) => patch({ description })}
            multiline
          />

          <View>
            <Text className="mb-1 font-body-bold text-sm text-ink">{t('form.servingsLabel')}</Text>
            <Stepper value={state.servings} onChange={(servings) => patch({ servings })} />
          </View>

          <View className="gap-3">
            <Text className="font-body-bold text-sm text-ink">{t('form.ingredientsLabel')}</Text>
            {state.ingredients.map((ing) => (
              <View key={ing.key} className="gap-2 rounded-card bg-linen p-3">
                <View className="flex-row gap-2">
                  <Input
                    value={ing.quantity}
                    onChangeText={(quantity) => patchIngredient(ing.key, { quantity })}
                    placeholder={t('form.quantityPlaceholder')}
                    keyboardType="numeric"
                    className="w-24"
                  />
                  <Input
                    value={ing.name}
                    onChangeText={(name) => patchIngredient(ing.key, { name })}
                    placeholder={t('form.namePlaceholder')}
                    className="flex-1"
                    maxLength={FIELD_LIMITS.ingredientName}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('form.removeRow')}
                    onPress={() =>
                      patch({ ingredients: state.ingredients.filter((i) => i.key !== ing.key) })
                    }
                    className="h-14 w-10 items-center justify-center">
                    <Ionicons name="close" size={20} color={palette.ink} />
                  </Pressable>
                </View>
                <UnitPicker
                  ingredient={ing}
                  onChange={(unit) => patchIngredient(ing.key, { unit: unit === '' ? null : unit })}
                />
                <View className="flex-row gap-2">
                  <UnitChip
                    label={t('form.scalingLinear')}
                    selected={ing.scaling === 'linear'}
                    onPress={() => patchIngredient(ing.key, { scaling: 'linear' })}
                  />
                  <UnitChip
                    label={t('form.scalingFixed')}
                    selected={ing.scaling === 'fixed'}
                    onPress={() => patchIngredient(ing.key, { scaling: 'fixed' })}
                  />
                </View>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                patch({
                  ingredients: [
                    ...state.ingredients,
                    { key: draftKey(), quantity: '', unit: null, name: '', scaling: 'linear' },
                  ],
                })
              }
              className="min-h-14 items-center justify-center rounded-card bg-linen active:opacity-80">
              <Text className="font-body-bold text-base text-clay">
                + {t('form.addIngredient')}
              </Text>
            </Pressable>
          </View>

          <View className="gap-3">
            <Text className="font-body-bold text-sm text-ink">{t('form.instructionsLabel')}</Text>
            <Sortable.Grid
              data={state.instructions}
              customHandle
              scrollableRef={scrollRef}
              rowGap={12}
              onDragEnd={({ data }) => patch({ instructions: [...data] })}
              renderItem={({ item }) => {
                const index = state.instructions.findIndex((s) => s.key === item.key);
                return (
                  <View className="flex-row items-start gap-3">
                    <Sortable.Handle>
                      <View className="min-h-14 w-8 items-center pt-3">
                        <Text className="font-display text-xl text-clay">{index + 1}</Text>
                      </View>
                    </Sortable.Handle>
                    <Input
                      value={item.text}
                      onChangeText={(text) =>
                        patch({
                          instructions: state.instructions.map((s) =>
                            s.key === item.key ? { ...s, text } : s
                          ),
                        })
                      }
                      placeholder={t('form.stepPlaceholder')}
                      multiline
                      className="flex-1"
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('form.removeRow')}
                      onPress={() =>
                        patch({
                          instructions: state.instructions.filter((s) => s.key !== item.key),
                        })
                      }
                      className="h-14 w-10 items-center justify-center">
                      <Ionicons name="close" size={20} color={palette.ink} />
                    </Pressable>
                  </View>
                );
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                patch({ instructions: [...state.instructions, { key: draftKey(), text: '' }] })
              }
              className="min-h-14 items-center justify-center rounded-card bg-linen active:opacity-80">
              <Text className="font-body-bold text-base text-clay">+ {t('form.addStep')}</Text>
            </Pressable>
          </View>

          <Input
            label={t('form.notesLabel')}
            value={state.notes}
            onChangeText={(notes) => patch({ notes })}
            multiline
          />
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
