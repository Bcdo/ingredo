import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import { getHousehold, joinHousehold, leaveHousehold, signOut } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { getApiUrlOverride, setApiUrlOverride } from '../../lib/api/config';
import { useSession } from '../../lib/api/session';
import { db } from '../../lib/db/client';
import { t } from '../../lib/i18n';
import type { HouseholdDto } from '../../lib/api/types';
import { syncNow } from '../../lib/sync/engine';
import { useSyncStatus } from '../../lib/sync/status';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

function joinErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 404) return t('account.errors.joinNotFound');
  if (caught instanceof ApiError && caught.status === 409) return t('account.errors.joinConflict');
  if (caught instanceof NetworkError) return t('account.errors.network');
  return t('account.errors.generic');
}

function syncStatusLine(status: ReturnType<typeof useSyncStatus>): string {
  if (status.state === 'syncing') return t('sync.syncing');
  if (status.state === 'error') return t('sync.failed');
  if (status.lastSyncedAt === null) return t('sync.never');
  const time = new Date(status.lastSyncedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return t('sync.lastSynced', { time });
}

export function AccountSection() {
  const session = useSession();
  const syncStatus = useSyncStatus();
  const [household, setHousehold] = useState<HouseholdDto | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverOverride, setServerOverride] = useState(() => getApiUrlOverride(db) ?? '');
  const showServerField = __DEV__ || serverOverride !== '';

  const signedIn = session.status === 'signedIn';

  useEffect(() => {
    if (!signedIn) {
      setHousehold(null);
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
    } catch (caught) {
      setError(joinErrorMessage(caught));
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
          leaveHousehold().catch((caught) => setError(joinErrorMessage(caught)));
        },
      },
    ]);
  };

  const serverField = showServerField ? (
    <Input
      testID="server-override-input"
      label={t('account.server')}
      value={serverOverride}
      onChangeText={(next) => {
        setServerOverride(next);
        setApiUrlOverride(db, next);
      }}
      autoCapitalize="none"
      className="mt-4"
    />
  ) : null;

  if (!signedIn) {
    return (
      <View testID="account-section" className="px-4 pt-2">
        <Text className="mb-2 font-body-bold text-sm text-ink">{t('account.title')}</Text>
        <Text className="mb-3 font-body text-sm text-ink">{t('account.signedOutHint')}</Text>
        <Button label={t('account.signInCta')} onPress={() => router.push('/account/sign-in')} />
        {serverField}
      </View>
    );
  }

  return (
    <View testID="account-section" className="px-4 pt-2">
      <Text className="mb-2 font-body-bold text-sm text-ink">{t('account.title')}</Text>
      <Text className="font-body text-sm text-ink">{t('account.signedInAs')}</Text>
      <Text className="mb-3 font-body-bold text-base text-ink">{session.user?.email}</Text>

      <View className="mb-3 flex-row items-center gap-3">
        <Text testID="sync-status-line" className="font-body text-sm text-ink">
          {syncStatusLine(syncStatus)}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void syncNow()}>
          <Text className="font-body text-sm text-ink underline">{t('sync.now')}</Text>
        </Pressable>
      </View>

      <Text className="font-body text-sm text-ink">{t('account.household')}</Text>
      <Text className="font-body-bold text-base text-ink">
        {household?.name ?? session.householdName ?? t('account.loading')}
      </Text>
      {household ? (
        <View className="mb-3">
          <View className="flex-row items-center gap-3">
            <Text className="font-body-bold text-lg text-ink">{household.joinCode}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => Share.share({ message: household.joinCode })}>
              <Text className="font-body text-sm text-ink underline">
                {t('account.shareCode')}
              </Text>
            </Pressable>
          </View>
          <Text className="mt-2 font-body text-sm text-ink">{t('account.members')}</Text>
          {household.members.map((member) => (
            <Text key={member.userId} className="font-body text-base text-ink">
              {member.displayName}
            </Text>
          ))}
        </View>
      ) : null}

      <Text className="mt-2 font-body text-sm text-ink">{t('account.joinTitle')}</Text>
      <View className="mt-1 flex-row items-center gap-2">
        <View className="flex-1">
          <Input
            testID="join-code-input"
            value={joinCode}
            onChangeText={setJoinCode}
            placeholder={t('account.joinPlaceholder')}
            autoCapitalize="characters"
          />
        </View>
        <Button label={t('account.joinButton')} onPress={join} />
      </View>

      {error ? <Text className="mt-2 font-body text-sm text-clay">{error}</Text> : null}

      <View className="mt-4 gap-2">
        <Button label={t('account.leave')} onPress={confirmLeave} variant="ghost" />
        <Button
          label={t('account.signOut')}
          onPress={() => {
            void signOut();
          }}
          variant="ghost"
        />
      </View>
      {serverField}
    </View>
  );
}
