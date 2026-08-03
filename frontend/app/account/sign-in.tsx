import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { signIn } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { t } from '../../lib/i18n';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const params = useLocalSearchParams<{ reset?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signedIn') router.back();
  }, [session.status]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError(t('account.errors.wrongCredentials'));
      } else if (caught instanceof NetworkError) {
        setError(t('account.errors.network'));
      } else {
        setError(t('account.errors.generic'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-cream px-4" style={{ paddingTop: insets.top + 12 }}>
      <Text className="mb-6 font-display text-xl text-ink">{t('account.signInTitle')}</Text>
      <Input
        testID="sign-in-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="sign-in-password"
        label={t('account.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
      {params.reset === 'done' ? (
        <View className="mb-3 rounded-card bg-sage px-4 py-3">
          <Text className="font-body text-sm text-cream">{t('account.resetDone')}</Text>
        </View>
      ) : null}
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.submitSignIn')} onPress={submit} disabled={busy} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/account/register')}
        className="mt-6 items-center">
        <Text className="font-body text-base text-ink underline">{t('account.noAccount')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/account/reset')}
        className="mt-3 items-center">
        <Text className="font-body text-sm text-ink underline">{t('account.forgotPassword')}</Text>
      </Pressable>
    </View>
  );
}
