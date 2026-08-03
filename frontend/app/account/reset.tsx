import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { resetPassword } from '../../lib/api/auth';
import { ApiError, NetworkError } from '../../lib/api/client';
import { t } from '../../lib/i18n';

export default function ResetScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password !== confirm) {
      setError(t('account.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      router.replace({ pathname: '/account/sign-in', params: { reset: 'done' } });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setError(t('account.errors.resetInvalid'));
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
      <Text className="mb-2 font-display text-xl text-ink">{t('account.resetTitle')}</Text>
      <Text className="mb-6 font-body text-sm text-ink opacity-80">{t('account.resetHint')}</Text>
      <Input
        testID="reset-email"
        label={t('account.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="reset-code"
        label={t('account.resetCode')}
        value={code}
        onChangeText={setCode}
        placeholder="ABC-DEF"
        autoCapitalize="characters"
        className="mb-4"
      />
      <Input
        testID="reset-password"
        label={t('account.newPassword')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
      <Input
        testID="reset-confirm"
        label={t('account.confirmPassword')}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        secureToggle
        autoCapitalize="none"
        className="mb-4"
      />
      {error ? <Text className="mb-3 font-body text-sm text-clay">{error}</Text> : null}
      <Button label={t('account.resetSubmit')} onPress={submit} disabled={busy} />
    </View>
  );
}
