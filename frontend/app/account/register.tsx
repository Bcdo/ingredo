import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { register } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { useSession } from '../../lib/api/session';
import { t } from '../../lib/i18n';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const session = useSession();
  const [displayName, setDisplayName] = useState('');
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
      await register(email.trim(), password, displayName.trim(), t('account.defaultHouseholdName'));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(t('account.errors.emailTaken'));
      } else if (caught instanceof ApiError && caught.status === 400) {
        setError(t('account.errors.invalidRegistration'));
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
      <Text className="mb-6 font-display text-xl text-ink">{t('account.registerTitle')}</Text>
      <Input
        testID="register-name"
        label={t('account.displayName')}
        value={displayName}
        onChangeText={setDisplayName}
        className="mb-4"
      />
      <Input
        testID="register-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="register-password"
        label={t('account.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        className="mb-4"
      />
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.submitRegister')} onPress={submit} disabled={busy} />
    </View>
  );
}
