import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface SubscriptionGateProps {
  isPremium: boolean;
  onTriggerUpgrade: () => void;
  children: React.ReactNode;
}

export function SubscriptionGate({ isPremium, onTriggerUpgrade, children }: SubscriptionGateProps) {
  if (isPremium) return <>{children}</>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Unlock GilledIt Pro 👑</Text>
      <Text style={styles.subtitle}>
        Unrestricted off-grid topological mapping, automatic log reports, and premium network features require a Pro tier account.
      </Text>

      <TouchableOpacity
        onPress={onTriggerUpgrade}
        style={styles.button}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>Upgrade for $4.99/mo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 24,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
