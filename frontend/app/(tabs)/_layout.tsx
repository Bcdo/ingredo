import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

import { t } from '../../lib/i18n';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#C96B45',
        tabBarInactiveTintColor: '#3A322B99',
        tabBarStyle: { backgroundColor: '#FBF7F1', borderTopColor: '#F3ECE1' },
        tabBarLabelStyle: { fontFamily: 'Karla_700Bold' },
        headerStyle: { backgroundColor: '#FBF7F1' },
        headerTitleStyle: { fontFamily: 'Fraunces_600SemiBold', color: '#3A322B' },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: '#FBF7F1' },
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
