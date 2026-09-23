// Expo app config (replaces app.json).
//
// Everything dynamic is read from the environment at config-evaluation time:
//   * local dev — Expo CLI auto-loads .env before evaluating this file;
//   * EAS cloud builds — the same variable names are injected from the
//     EAS-managed environment sets (eas env:push --environment <name>),
//     selected per profile via eas.json's "environment" field.
//
// Naming rules:
//   * Client bundle values MUST keep the EXPO_PUBLIC_ prefix — that is what
//     Expo inlines into the JS bundle (src/lib/supabase.ts reads them).
//   * SUPABASE_URL / SUPABASE_ANON_KEY are Edge Function runtime secrets
//     injected by Supabase itself — they are never needed on the client.
//   * GOOGLE_MAPS_ANDROID_API_KEY feeds react-native-maps' Android base map
//     via the native gradle config. Omitted when unset so local evaluation
//     still validates cleanly.
//
// No secrets live in this file or in eas.json — ever.

const googleMapsAndroidApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

module.exports = {
  expo: {
    name: 'Fishlore',
    slug: 'fishlore-app',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    // Hermes release engine: AOT-compiled bytecode, smaller heap, faster
    // startup — the optimization baseline for every EAS build profile.
    jsEngine: 'hermes',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'com.fishlore.app',
      // Hermes per-platform enforcement (mirrors top-level jsEngine):
      // AOT bytecode, smaller heap, faster cold start on iOS.
      jsEngine: 'hermes',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Fishlore requires background and local geographic metrics to map exact catch strike coordinates, log ambient lunar trends, and sync telemetry arrays while offline.',
        NSPhotoLibraryUsageDescription:
          'Fishlore requires local storage media access to append structural catch log visuals, retrieve existing fish snapshots, and optimize offline memory tile caches.',
        NSCameraUsageDescription:
          'Fishlore requires camera array interactions to capture telemetry logs, catalog species data snapshots, and store high-resolution catch records inside the local device vault.',
        ITSAppUsesNonExemptEncryption: false,
        // Background fetch — required for the native (dev-client / EAS) builds
        // so the BACKGROUND_CATCH_SYNC_TASK wakeup fires while the app is
        // minimized (src/lib/backgroundSync.ts).
        UIBackgroundModes: ['fetch'],
      },
    },
    android: {
      package: 'com.fishlore.app',
      // Secure local-data state: opts OUT of Android Auto Backup (adb/cloud
      // restore) so queued catches, auth sessions and offline tiles are never
      // silently resurrected onto another device.
      allowBackup: false,
      // Hermes per-platform enforcement (mirrors top-level jsEngine):
      // AOT bytecode, smaller heap, faster cold start on Android.
      jsEngine: 'hermes',
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'CAMERA',
        'READ_EXTERNAL_STORAGE',
        'WRITE_EXTERNAL_STORAGE',
        'READ_MEDIA_IMAGES',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon-safe.png',
        backgroundColor: '#ffffff',
      },
      // react-native-maps Android base map credential — injected from the
      // EAS environment during remote cloud compilation. Never hardcoded.
      ...(googleMapsAndroidApiKey
        ? { config: { googleMaps: { apiKey: googleMapsAndroidApiKey } } }
        : {}),
    },
    scheme: 'fishlore',
    web: {
      bundler: 'metro',
      output: 'single',
    },
    plugins: [
      'expo-router',
      'expo-image-picker',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow Fishlore to use your location to tag catches with GPS coordinates.',
        },
      ],
      // Android release optimization: R8/ProGuard minification + resource
      // shrinking (expo-build-properties 57.0.21). Applies to release builds
      // only — the development dev-client (debug) profile is untouched.
      [
        'expo-build-properties',
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
          },
        },
      ],
      // Notification engine: default Android channel + icon/color and sound
      // wiring for remote push on both platforms.
      'expo-notifications',
      'expo-updates',
    ],
    extra: {
      router: {},
      eas: {
        projectId: 'c580288a-1474-4959-a15f-ca365b3b4228',
      },
    },
    owner: 'wiretidetest01',
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://expo.dev',
      enabled: true,
      checkAutomatically: 'ON_APP_START',
      fallbackToCacheTimeout: 30000,
    },
  },
};
