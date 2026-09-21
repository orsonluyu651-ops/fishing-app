//================]]]]]]]]]]]]]]]]]]]`0-98` Expo app config (replaces app.json).
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
    name: 'Tidewire',
    slug: 'tidewire',
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
      supportsTablet: true,
      bundleIdentifier: 'com.yourname.fishingapp',
      infoPlist: {
        NSLocationWhenInUseUsageDescription:
          'Tidewire uses your location to tag catches with GPS coordinates.',
        NSPhotoLibraryUsageDescription:
          'Tidewire needs photo library access so you can attach catch photos.',
        NSCameraUsageDescription:
          'Tidewire needs camera access so you can take catch photos.',
        // Background fetch — required for the native (dev-client / EAS) builds
        // so the BACKGROUND_CATCH_SYNC_TASK wakeup fires while the app is
        // minimized (src/lib/backgroundSync.ts).
        UIBackgroundModes: ['fetch'],
      },
    },
    android: {
      package: 'com.yourname.fishingapp',
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'READ_EXTERNAL_STORAGE',
        'READ_MEDIA_IMAGES',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      // react-native-maps Android base map credential — injected from the
      // EAS environment during remote cloud compilation. Never hardcoded.
      ...(googleMapsAndroidApiKey
        ? { config: { googleMaps: { apiKey: googleMapsAndroidApiKey } } }
        : {}),
    },
    scheme: 'tidewire',
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
            'Allow Tidewire to use your location to tag catches with GPS coordinates.',
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
    ],
    extra: {
      router: {},
      eas: {
        projectId: 'aa4a0e1c-109c-42e3-a5e6-4426f78f69f5',
      },
    },
    owner: 'wiretidetest01',
  },
};
