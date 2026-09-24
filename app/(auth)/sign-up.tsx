import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import { AnimatedInput, COLORS } from '../../src/components/AnimatedInput';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const formOpacity = useRef(new Animated.Value(0)).current;
  const formTranslateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(formOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(formTranslateY, {
        toValue: 0,
        duration: 600,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [formOpacity, formTranslateY]);

  const handleSignUp = useCallback(async () => {
    if (!email || !password || !username) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username: username },
      },
    });

    if (error) {
      Alert.alert('SignUp Error', error.message);
    } else {
      Alert.alert('Success', 'Check your email for the confirmation link!');
      router.replace('/(auth)/sign-in');
    }
    setLoading(false);
  }, [email, password, username, router]);

  const handleNavigateToSignIn = useCallback(() => {
    router.replace('/(auth)/sign-in');
  }, [router]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.formContainer,
          { opacity: formOpacity, transform: [{ translateY: formTranslateY }] },
        ]}
      >
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Start your fishing journey</Text>

        <AnimatedInput
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          placeholder="Your angler name"
        />
        <AnimatedInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@anglers.app"
        />
        <AnimatedInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.bg} />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleNavigateToSignIn} activeOpacity={0.7}>
          <Text style={styles.linkText}>Already have an account? Sign In</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: COLORS.bg,
  },
  formContainer: { gap: 4 },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 6,
    color: COLORS.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: COLORS.bg, fontSize: 16, fontWeight: '700' },
  linkText: {
    textAlign: 'center',
    marginTop: 20,
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
