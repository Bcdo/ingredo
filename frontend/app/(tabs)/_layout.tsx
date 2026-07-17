import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { t } from '../../lib/i18n';
import { fontFamilies, inkMuted, palette } from '../../lib/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.clay,
        tabBarInactiveTintColor: inkMuted,
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
