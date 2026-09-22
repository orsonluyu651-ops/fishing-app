import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';

interface UpdateBoundaryProps {
  children: React.ReactNode;
}

export function UpdateBoundary({ children }: UpdateBoundaryProps) {
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    async function inspectForUpdates() {
      if (__DEV__) {
        setChecking(false);
        return;
      }

      try {
        const updateCheck = await Updates.checkForUpdateAsync();
        if (updateCheck.isAvailable) {
          setDownloading(true);
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (err) {
        console.warn("OTA Update optimization layer skipped:", err);
      } finally {
        setChecking(false);
      }
    }

    inspectForUpdates();
  }, []);

  if (downloading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={{ marginTop: 16, fontSize: 16, color: '#333', fontWeight: '600' }}>
          Applying continuous security updates...
        </Text>
      </View>
    );
  }

  return <>{children}</>;
}
