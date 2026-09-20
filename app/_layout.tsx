import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { supabase } from '../src/lib/supabase';

export default function RootLayout() {
  const segments = useSegments();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const inAuthGroup = segments[0] === '(auth)';

      const isRootRoute = (segments as string[]).length === 0;

      if (!session && !inAuthGroup) {
        // Redirect to sign-in if not authenticated and not already in auth group
        router.replace('/(auth)/sign-in');
      } else if (session && inAuthGroup) {
        // Redirect to tabs if authenticated but trying to access auth group
        router.replace('/(tabs)/profile');
      } else if (session && isRootRoute) {
        router.replace('/(tabs)/profile');
      }

      setLoading(false);
    });

    // Listen for auth state changes (sign in, sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const inAuthGroup = segments[0] === '(auth)';

      const isRootRoute = (segments as string[]).length === 0;

      if (!session && !inAuthGroup) {
        router.replace('/(auth)/sign-in');
      } else if (session && inAuthGroup) {
        router.replace('/(tabs)/profile');
      } else if (session && isRootRoute) {
        router.replace('/(tabs)/profile');
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [segments]);

  return (
    <View style={styles.rootContainer}>
      <Slot />
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFill,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
