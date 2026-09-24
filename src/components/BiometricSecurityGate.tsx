import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { authenticateWithBiometrics } from '../lib/biometricEngine';
import { COLORS } from '../components/AnimatedInput';

interface BiometricSecurityGateProps {
  children: React.ReactNode;
  gateMessage: string;
}

export function BiometricSecurityGate({ children, gateMessage }: BiometricSecurityGateProps) {
  const [unlocked, setUnlocked] = useState(false);
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Pulsing glow animation for the lock icon
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      { iterations: -1 },
    ).start();
  }, [glowAnim]);

  const handleUnlockTrigger = async () => {
    const passed = await authenticateWithBiometrics(gateMessage);
    if (passed) setUnlocked(true);
  };

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.4],
  });

  if (unlocked) return <>{children}</>;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.lockIconWrapper, { opacity: glowOpacity }]}>
        <Text style={styles.lockIcon}>🔒</Text>
      </Animated.View>
      <Text style={styles.title}>Secure Storage Area</Text>
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
    backgroundColor: COLORS.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  lockIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    marginBottom: 16,
  },
  lockIcon: {
    fontSize: 36,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  buttonText: {
    color: COLORS.bg,
    fontWeight: 'bold',
    fontSize: 15,
  },
});
