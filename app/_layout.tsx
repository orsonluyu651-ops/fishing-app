import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ErrorUtils, StyleSheet, View, Alert } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../src/lib/supabase';
import { attachNotificationRouting } from '../src/lib/notifications';
import { registerBackgroundCatchSync } from '../src/lib/backgroundSync';
import { parseAndVerifySpotLink } from '../src/lib/spotSharingEngine';
import { UpdateBoundary } from '../src/components/UpdateBoundary';
import { TelemetryBoundary } from '../src/components/TelemetryBoundary';
import { StripeRoot } from '../src/components/StripeRoot';
import { reportNativeCrash } from '../src/lib/telemetryEngine';

// Web polyfill: expo-router's notification routing calls
// `ExpoNotifications.getLastNotificationResponse`, which has no web
// implementation. Neutralise it before any provider mounts.
if (Platform.OS === 'web') {
  const globalAny = globalThis as unknown as Record<string, unknown> & {
    ExpoNotifications?: Record<string, unknown>;
  };
  if (!globalAny.ExpoNotifications) globalAny.ExpoNotifications = {};
  if (!globalAny.ExpoNotifications.getLastNotificationResponse) {
    globalAny.ExpoNotifications.getLastNotificationResponse = async () => null;
  }
}

// Intercept unhandled global native promise rejections safely
if (!__DEV__) {
  const globalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: any, isFatal: boolean | undefined) => {
    reportNativeCrash(`[Global Fatal: ${isFatal}] ${error?.message || 'Unknown Native Fault'}`, error?.stack);
    if (globalHandler) globalHandler(error, isFatal);
  });
}

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

  // Notification engine: route banner taps to their in-app deep links
  // (warm taps and cold-start responses both). Returns its own cleanup.
  // Web: expo-notifications exposes no getLastNotificationResponse — skip
  // routing entirely (polyfilled at module top as belt-and-braces).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    return attachNotificationRouting((href) => {
      void router.push(href);
    });
  }, [router]);

  // Background catch sync: register the OS background-fetch cycle (strict
  // 15-minute minimum interval) so the offline catch queue drains while the
  // app is minimized. Fire-and-forget — the registration is idempotent and
  // degrades to a quiet 'unavailable' under Expo Go / web.
  useEffect(() => {
    void registerBackgroundCatchSync();
  }, []);

  // Deep-link handler for inbound spot-share URLs: verify the cryptographic
  // token, surface the waterway coordinates to the user, and route them to the
  // map view in production.
  useEffect(() => {
    const handleIncomingUrl = (event: { url: string }) => {
      const verifiedSpot = parseAndVerifySpotLink(event.url);
      if (verifiedSpot) {
        Alert.alert(
          'Secret Waterway Shared!',
          `Coordinates package decoded for point: "${verifiedSpot.name}".\n\nTarget Position:\nLat: ${verifiedSpot.lat}\nLng: ${verifiedSpot.lng}`
        );
      }
    };

    const subscription = Linking.addEventListener('url', handleIncomingUrl);

    Linking.getInitialURL().then((url) => {
      if (url) handleIncomingUrl({ url });
    });

    return () => subscription.remove();
  }, []);

  return (
    <TelemetryBoundary>
      <UpdateBoundary>
        {/* Stripe root: mounts StripeProvider with EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
            on native; transparent pass-through on web (platform-extension resolved —
            this file must never import @stripe/stripe-react-native directly). */}
        <StripeRoot>
          <View style={styles.rootContainer}>
            <Slot />
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
              </View>
            )}
          </View>
        </StripeRoot>
      </UpdateBoundary>
    </TelemetryBoundary>
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
