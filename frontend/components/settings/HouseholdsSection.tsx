import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import {
  createHousehold,
  getHousehold,
  joinHousehold,
  leaveHousehold,
  listHouseholds,
  renameHousehold,
  switchHousehold,
} from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { t } from '../../lib/i18n';
import type { HouseholdDto, HouseholdSummaryDto } from '../../lib/api/types';
import { usePalette } from '../../lib/usePalette';
import { Button } from '../ui/Button';
import { CodeInput } from '../ui/CodeInput';
import { Input } from '../ui/Input';
import { SectionHeader } from '../ui/SectionHeader';

function joinErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 404) return t('account.errors.joinNotFound');
  if (caught instanceof ApiError && caught.status === 409) return t('account.errors.joinConflict');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function leaveErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 409)
    return t('account.errors.leaveLastHousehold');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function createErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 400) return t('account.errors.createInvalid');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function genericErrorMessage(caught: unknown): string {
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

export function HouseholdsSection() {
  const session = useSession();
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [households, setHouseholds] = useState<HouseholdSummaryDto[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [revealCreate, setRevealCreate] = useState(false);
  const [revealJoin, setRevealJoin] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const palette = usePalette();

  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    // Any session/household transition invalidates in-progress edits: a
    // rename left open across a switch would rename the WRONG household.
    setRenaming(false);
    setRenameValue('');
    setRevealCreate(false);
    setRevealJoin(false);
    setCreateName('');
    setJoinCode('');
    if (!signedIn) {
      setHousehold(null);
      setHouseholds([]);
      return;
    }
    let cancelled = false;
    getHousehold()
      .then((result) => {
        if (!cancelled) {
          setHousehold(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(joinErrorMessage(caught));
      });
    listHouseholds()
      .then((result) => {
        if (!cancelled) setHouseholds(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(genericErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
    // householdId changes on join/leave — refetch then.
  }, [signedIn, session.householdId]);

  const join = async () => {
    setError(null);
    try {
      await joinHousehold(joinCode);
      setJoinCode('');
      setRevealJoin(false);
    } catch (caught) {
      setError(joinErrorMessage(caught));
    }
  };

  const switchTo = (target: HouseholdSummaryDto) => {
    if (target.isActive) return;
    setError(null);
    switchHousehold(target.id).catch((caught) => setError(genericErrorMessage(caught)));
  };

  const create = async () => {
    const name = createName.trim();
    if (name === '') {
      setError(t('account.errors.createInvalid'));
      return;
    }
    setError(null);
    try {
      await createHousehold(name);
      setCreateName('');
      setRevealCreate(false);
    } catch (caught) {
      setError(createErrorMessage(caught));
    }
  };

  const startRename = (currentName: string) => {
    setError(null);
    setRenameValue(currentName);
    setRenaming(true);
  };

  const saveRename = async () => {
    const name = renameValue.trim();
    if (name === '') {
      setError(t('account.errors.createInvalid'));
      return;
    }
    setError(null);
    try {
      const renamed = await renameHousehold(name);
      setHousehold(renamed);
      setHouseholds((prev) =>
        prev.map((item) => (item.id === renamed.id ? { ...item, name: renamed.name } : item))
      );
      setRenaming(false);
    } catch (caught) {
      setError(createErrorMessage(caught));
    }
  };

  const confirmLeave = () => {
    Alert.alert(t('account.leaveConfirmTitle'), t('account.leaveConfirmBody'), [
      { text: t('account.cancel'), style: 'cancel' },
      {
        text: t('account.leave'),
        style: 'destructive',
        onPress: () => {
          setError(null);
          leaveHousehold().catch((caught) => setError(leaveErrorMessage(caught)));
        },
      },
    ]);
  };

  if (!signedIn) return null;

  return (
    <View testID="households-section" className="px-4 pt-8">
      <SectionHeader title={t('account.householdsTitle')} />
      <View className="mb-3 mt-1 gap-2">
        {households.map((item) =>
          item.isActive ? (
            <View
              key={item.id}
              testID={`household-row-${item.id}`}
              accessibilityState={{ selected: true }}
              className="rounded-card border border-clay bg-linen px-3 py-2">
              {renaming ? (
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Input
                      testID="rename-input"
                      value={renameValue}
                      onChangeText={setRenameValue}
                      autoFocus
                      tone="cream"
                    />
                  </View>
                  <Button label={t('account.renameSave')} onPress={() => void saveRename()} />
                  <Pressable accessibilityRole="button" onPress={() => setRenaming(false)}>
                    <Text className="font-body text-sm text-ink underline">
                      {t('account.cancel')}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="flex-row items-center justify-between">
                  <Text className="font-body-bold text-base text-ink">{item.name}</Text>
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('account.rename')}
                      onPress={() => startRename(item.name)}>
                      <Ionicons name="pencil" size={16} color={palette.ink} />
                    </Pressable>
                    <Text className="font-body-bold text-xs text-clay">
                      {t('account.activeBadge')}
                    </Text>
                  </View>
                </View>
              )}
              <View className="mt-1 flex-row items-center gap-3">
                <Text className="font-body text-sm text-ink">
                  {t('account.codeLine', { code: household?.joinCode ?? '…' })}
                </Text>
                {household ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => Share.share({ message: household.joinCode })}>
                    <Text className="font-body text-sm text-ink underline">
                      {t('account.shareCode')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {household ? (
                <Text className="mt-1 font-body text-sm text-ink">
                  {household.members.map((member) => member.displayName).join(', ')}
                </Text>
              ) : null}
              <View className="mt-2">
                <Button label={t('account.leave')} onPress={confirmLeave} variant="ghost" />
              </View>
            </View>
          ) : (
            // Same shell as the active row (minus the clay outline) so the two
            // read as states of one thing, with an explicit switch affordance:
            // switching repartitions every list, so it must not look like text.
            <Pressable
              key={item.id}
              testID={`household-row-${item.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: false }}
              onPress={() => switchTo(item)}
              className="min-h-14 flex-row items-center justify-between rounded-card bg-linen px-3 py-2 active:opacity-80">
              <View className="flex-1">
                <Text className="font-body-bold text-base text-ink">{item.name}</Text>
                <Text className="font-body text-xs text-ink opacity-70">
                  {t('account.memberCount', { count: item.memberCount })}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="font-body-bold text-sm text-clay">{t('account.switchTo')}</Text>
                <Ionicons name="chevron-forward" size={16} color={palette.clay} />
              </View>
            </Pressable>
          )
        )}
      </View>

      {revealCreate ? (
        <View className="mb-2 flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              testID="create-household-input"
              value={createName}
              onChangeText={setCreateName}
              placeholder={t('account.createPlaceholder')}
            />
          </View>
          <Button label={t('account.createButton')} onPress={create} />
        </View>
      ) : (
        <Button
          label={t('account.createReveal')}
          onPress={() => setRevealCreate(true)}
          variant="ghost"
        />
      )}
      <View className="mt-2">
        {revealJoin ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              <CodeInput
                testID="join-code-input"
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder={t('account.joinPlaceholder')}
              />
            </View>
            <Button label={t('account.joinButton')} onPress={join} />
          </View>
        ) : (
          <Button
            label={t('account.joinReveal')}
            onPress={() => setRevealJoin(true)}
            variant="ghost"
          />
        )}
      </View>

      {error ? <Text className="mt-2 font-body text-sm text-clay">{error}</Text> : null}
    </View>
  );
}
