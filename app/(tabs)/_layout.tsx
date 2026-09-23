import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#0284c7', headerStyle: { backgroundColor: '#fff' } }}>
      <Tabs.Screen name="feed" options={{ title: 'Feed', tabBarIcon: ({ color }) => <Ionicons name="newspaper-outline" size={24} color={color} /> }} />
      <Tabs.Screen name="guide" options={{ title: 'Guide', tabBarIcon: ({ color }) => <Ionicons name="book-outline" size={24} color={color} /> }} />
      <Tabs.Screen name="fishtok" options={{ title: 'Fish-Tok', tabBarIcon: ({ color }) => <Ionicons name="play-circle-outline" size={24} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={24} color={color} /> }} />
      {/* Legacy/sub routes: hidden from the bottom bar (href: null) while keeping deep-link URL registration intact. */}
      <Tabs.Screen name="notifications" options={{ title: 'Alerts', href: null }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Leaderboard', href: null }} />
      <Tabs.Screen name="billing/index" options={{ title: 'Billing', href: null }} />
    </Tabs>
  );
}
