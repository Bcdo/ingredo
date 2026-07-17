import { Ionicons } from '@expo/vector-icons';
import { router, Tabs } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';

import { t } from '../../lib/i18n';
import { fontFamilies } from '../../lib/theme';
import { usePalette } from '../../lib/usePalette';

export default function TabLayout() {
  const palette = usePalette();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.clay,
        tabBarInactiveTintColor: palette.inkMuted,
        tabBarStyle: { backgroundColor: palette.cream, borderTopColor: palette.linen },
        tabBarLabelStyle: { fontFamily: fontFamilies.bodyBold },
        headerStyle: { backgroundColor: palette.cream },
        headerTitleStyle: { fontFamily: fontFamilies.display, color: palette.ink },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: palette.cream },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.today'),
          tabBarIcon: ({ color }) => <Ionicons name="sunny-outline" size={24} color={color} />,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.open')}
              onPress={() => router.push('/settings')}
              className="min-h-14 justify-center px-4">
              <Ionicons name="settings-outline" size={24} color={palette.ink} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('tabs.plan'),
          tabBarIcon: ({ color }) => <Ionicons name="calendar-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: t('tabs.recipes'),
          tabBarIcon: ({ color }) => <Ionicons name="book-outline" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shop"
        options={{
          title: t('tabs.shop'),
          tabBarIcon: ({ color }) => <Ionicons name="basket-outline" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
