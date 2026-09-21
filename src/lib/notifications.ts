import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────
// Native push notification engine.
//
// Workflow: OS permission check → capability request → ExpoPushToken
// extraction → binding onto the signed-in profile row (expo_push_token,
// migration 0016). The tide-alerts Edge Function reads that column with the
// service role and fans alerts out through the Expo Push API.
//
// Deep links ride in the notification `data` payload as `deepLink: '/route'`
// and are routed through expo-router when a banner is tapped (warm or
// cold-start) — see attachNotificationRouting.
// ─────────────────────────────────────────────────────────────

export interface PushRegistrationResult {
  /** Expo push token (ExponentPushToken[...]) — null when registration failed. */
  token: string | null;
  status: 'granted' | 'denied' | 'unavailable' | 'unauthenticated' | 'error';
  message?: string;
}

// Foreground presentation: banners + list entries while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android 13+ requires an existing channel before notifications can post. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('alerts', {
    name: 'Tidewire alerts',
    description: 'Weather swings, tide movements and social activity.',
    // AndroidImportance.HIGH (6) — the enum is not re-exported from the
    // expo-notifications package root in SDK 57, so the member value is used.
    importance: 6,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0284c7',
  });
}

/**
 * Full registration sequence:
 *   1. verify a physical device (simulators cannot receive remote pushes);
 *   2. check the current OS permission state;
 *   3. request the missing notification capabilities;
 *   4. extract the ExpoPushToken (projectId read from the EAS app config);
 *   5. bind the token onto the signed-in profile row.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  try {
    if (!Device.isDevice) {
      return {
        token: null,
        status: 'unavailable',
        message:
          'Push registration needs a physical device — simulators cannot receive remote pushes.',
      };
    }

    await ensureAndroidChannel();

    // 1) What has the OS already granted?
    const existing = await Notifications.getPermissionsAsync();

    // 2) Request the missing capabilities (alert + badge + sound on iOS).
    let status = existing.status;
    if (status !== 'granted') {
      if (!existing.canAskAgain) {
        return {
          token: null,
          status: 'denied',
          message: 'Notifications were permanently declined — enable them in system settings.',
        };
      }
      const requested = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = requested.status;
    }
    if (status !== 'granted') {
      return { token: null, status: 'denied', message: 'Notification permission was not granted.' };
    }

    // 3) Extract the ExpoPushToken (projectId comes from the EAS app config).
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse?.data;
    if (!token) {
      return { token: null, status: 'error', message: 'The push provider returned no token.' };
    }

    // 4) Bind onto the signed-in profile.
    const bound = await bindPushTokenToProfile(token);
    if (!bound) {
      return {
        token,
        status: 'unauthenticated',
        message: 'Token acquired but no signed-in profile to bind it to — it will bind after sign-in.',
      };
    }
    return { token, status: 'granted' };
  } catch (error) {
    console.warn('[notifications] push registration failed:', error);
    return {
      token: null,
      status: 'error',
      message: 'Push registration failed — retry once the device is back online.',
    };
  }
}

/**
 * Binds an ExpoPushToken onto the signed-in user's profile row
 * (profiles.expo_push_token — migration 0016). Returns false when nobody is
 * signed in or the write fails; the caller keeps the token either way so the
 * binding can be retried after sign-in.
 */
export async function bindPushTokenToProfile(token: string): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ expo_push_token: token, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    console.warn('[notifications] could not bind push token to profile:', error.message);
    return false;
  }
  return true;
}

/** Structural view of an Expo notification response — survives SDK drift. */
interface NotificationResponseLike {
  notification: {
    request: {
      content: {
        data?: Record<string, unknown> | null;
      };
    };
  };
}

/** Pulls the in-app route out of a notification's data payload, safely. */
export function extractDeepLink(response: NotificationResponseLike): string | null {
  const data = (response.notification.request.content.data ?? {}) as {
    deepLink?: unknown;
    url?: unknown;
  };
  const target = data.deepLink ?? data.url;
  return typeof target === 'string' && target.startsWith('/') ? target : null;
}

/**
 * Attaches the background notification response hooks.
 *
 *   * cold start — a banner tapped while the app was closed is recovered via
 *     getLastNotificationResponseAsync and routed once on mount;
 *   * warm start — addNotificationResponseReceivedListener routes taps that
 *     arrive while the app is foregrounded or backgrounded;
 *   * quiet receipts — addNotificationReceivedListener acknowledges data-only
 *     deliveries without UI work (routing is deliberately tap-driven).
 *
 * `navigate` receives in-app route strings like '/(tabs)/guide' — wire it to
 * expo-router's push. Returns a cleanup function for the owning effect.
 */
export function attachNotificationRouting(navigate: (href: string) => void): () => void {
  let disposed = false;
  const subscriptions: Array<ReturnType<typeof Notifications.addNotificationReceivedListener>> = [];

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (disposed || !response) return;
    const href = extractDeepLink(response);
    if (href) navigate(href);
  });

  subscriptions.push(
    Notifications.addNotificationResponseReceivedListener((response) => {
      const href = extractDeepLink(response);
      if (href) navigate(href);
    }),
    Notifications.addNotificationReceivedListener(() => undefined),
  );

  return () => {
    disposed = true;
    for (const subscription of subscriptions) subscription.remove();
  };
}
