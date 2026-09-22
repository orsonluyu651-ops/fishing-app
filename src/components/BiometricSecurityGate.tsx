import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { authenticateWithBiometrics } from '../lib/biometricEngine';

interface BiometricSecurityGateProps {
  children: React.ReactNode;
  gateMessage: string;
}

export function BiometricSecurityGate({ children, gateMessage }: BiometricSecurityGateProps) {
  const [unlocked, setUnlocked] = useState(false);

  const handleUnlockTrigger = async () => {
    const passed = await authenticateWithBiometrics(gateMessage);
    if (passed) setUnlocked(true);
  };

  if (unlocked) return <>{children}</>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Secure Storage Area 🔒</Text>
      <Text style={styles.subtext}>
        Biometric verification is required to access your encrypted logs and shared secret catch coordinates.
      </Text>

      <TouchableOpacity onPress={handleUnlockTrigger} style={styles.button} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Authenticate to Unlock</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
