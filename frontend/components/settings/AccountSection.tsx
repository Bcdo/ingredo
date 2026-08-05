import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { signOut } from '../../lib/api/auth';
import { getApiUrlOverride, setApiUrlOverride } from '../../lib/api/config';
import { useSession } from '../../lib/api/session';
import { db } from '../../lib/db/client';
import { t } from '../../lib/i18n';
import { syncNow } from '../../lib/sync/engine';
import { useSyncStatus } from '../../lib/sync/status';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { SectionHeader } from '../ui/SectionHeader';

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
  const [serverOverride, setServerOverride] = useState(() => getApiUrlOverride(db) ?? '');
  const showServerField = __DEV__ || serverOverride !== '';
  const signedIn = session.status === 'signedIn';

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
        <SectionHeader title={t('account.title')} />
        <Text className="mb-3 font-body text-sm text-ink">{t('account.signedOutHint')}</Text>
        <Button label={t('account.signInCta')} onPress={() => router.push('/account/sign-in')} />
        {serverField}
      </View>
    );
  }

  return (
    <View testID="account-section" className="px-4 pt-2">
      <SectionHeader title={t('account.title')} />
      <View className="flex-row items-center justify-between">
        <Text className="font-body-bold text-base text-ink">{session.user?.email}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void signOut();
          }}>
          <Text className="font-body text-sm text-ink underline">{t('account.signOut')}</Text>
        </Pressable>
      </View>

      <View className="mb-3 mt-1 flex-row items-center gap-3">
        <Text testID="sync-status-line" className="font-body text-sm text-ink">
          {syncStatusLine(syncStatus)}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void syncNow()}>
          <Text className="font-body text-sm text-ink underline">{t('sync.now')}</Text>
        </Pressable>
      </View>

      {serverField}
    </View>
  );
}
