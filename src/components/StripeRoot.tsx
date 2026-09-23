/**
 * StripeRoot — WEB implementation.
 *
 * Platform-extension sibling of `StripeRoot.native.tsx`.
 *
 * WHY THIS INDIRECTION EXISTS
 * `@stripe/stripe-react-native`'s root `index.js` eagerly requires its entire
 * component tree (CardField, AuBECSDebitForm, ...), and 8+ of those modules
 * import `react-native/Libraries/Utilities/codegenNativeComponent`. Importing
 * ANYTHING from that package — even just `StripeProvider` — therefore drags a
 * native-only module into the web graph and 500s `platform=web` bundles.
 *
 * `app/_layout.tsx` is the root for every platform, so it must never import
 * the SDK directly. Metro resolves this file for web (a transparent
 * pass-through) and `StripeRoot.native.tsx` for iOS/Android.
 */

import React from 'react';

export function StripeRoot({ children }: { children: React.ReactElement }): React.JSX.Element {
  // Web renders no Stripe provider: there is no Payment Sheet on web
  // (see src/lib/stripePayment.ts, which returns STRIPE_WEB_UNAVAILABLE).
  return children;
}
