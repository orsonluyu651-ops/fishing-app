import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { synchronizeCatchQueue } from '../lib/catchSyncEngine';

export function SyncStatusHeader() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
      if (state.isConnected) {
        setSyncing(true);
        synchronizeCatchQueue().then(() => setSyncing(false));
      }
    });
    return () => unsubscribe();
  }, []);

  if (isConnected && !syncing) return null;

  return (
    <View style={[styles.container, isConnected ? styles.online : styles.offline]}>
      <Text style={styles.text}>
        {syncing ? 'Syncing off-grid catches...' : 'Offline Mode — Catches are safely queued locally'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  online: {
    backgroundColor: '#10b981',
  },
  offline: {
    backgroundColor: '#f59e0b',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
});
