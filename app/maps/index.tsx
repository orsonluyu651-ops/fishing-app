/**
 * Waterway Map Screen — WEB fallback.
 *
 * Platform-extension sibling of `index.native.tsx`. Metro resolves the
 * `.native` file for iOS/Android (full react-native-maps engine) and this
 * file for web, keeping `codegenNativeComponent` out of the web graph.
 */
import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function WaterwayMapScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.fallback}>
        <Ionicons name="map-outline" size={48} color="#0284c7" />
        <Text style={styles.title}>Maps unavailable on web</Text>
        <Text style={styles.text}>
          Waterway charts render in the Fishlore iOS / Android app.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e0f2fe',
  },
  fallback: { alignItems: 'center', padding: 24, gap: 8 },
  title: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  text: { fontSize: 13, color: '#475569', textAlign: 'center' },
});
