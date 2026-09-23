/**
 * StripeRoot — NATIVE implementation (iOS / Android).
 *
 * Platform-extension sibling of `StripeRoot.tsx`. Metro resolves this file
 * for native platforms and the web pass-through for `platform=web`, so
 * `app/_layout.tsx` can import `StripeRoot` without ever pulling the
 * `@stripe/stripe-react-native` package (whose index eagerly requires
 * codegen-native modules) into the web module graph.
 *
 * WIRING CONTRACT
 * `stripePayment.native.ts` calls `initPaymentSheet` / `presentPaymentSheet`,
 * which require an initialised Stripe session. Without a provider mounted at
 * the root, those SDK calls throw at runtime on every upgrade attempt — this
 * component is that missing root initialisation.
 *
 * publishableKey resolution order:
 *   1. process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY (injected by Expo at
 *      bundle time from .env locally, from the EAS `production` env remotely).
 *   2. If absent/empty: children render unwrapped. Payment Sheet will still
 *      fail at call time — but a missing key must not crash the whole app
 *      tree on launch. Dev warning surfaces the misconfiguration early.
 */

import React from 'react';
import { Platform } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';

export function StripeRoot({ children }: { children: React.ReactElement }): React.JSX.Element {
  const publishableKey = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '').trim();

  if (!publishableKey) {
    if (__DEV__ && Platform.OS !== 'web') {
      console.warn(
        '[StripeRoot] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set — ' +
          'StripeProvider is NOT mounted; Payment Sheet calls will fail until ' +
          'the key is provided via .env (local) or EAS env (production).'
      );
    }
    return children;
  }

  return <StripeProvider publishableKey={publishableKey}>{children}</StripeProvider>;
}