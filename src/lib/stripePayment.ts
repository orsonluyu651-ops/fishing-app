/**
 * Stripe Payment Sheet Bridge
 *
 * Integrates @stripe/stripe-react-native inside the billing layout.
 * Provides an asynchronous handler to initialize and present the Stripe
 * payment sheet via a Supabase Edge Function.
 */

import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Web-safe lazy binding for the native Stripe SDK.
//
// Metro statically follows every `require('...')` string, so even a
// `Platform.OS === 'web'`-guarded require of '@stripe/stripe-react-native'
// pulls `codegenNativeCommands` / `codegenNativeComponent` into the web
// graph and 500s `platform=web` bundles. Only the `.native` module may
// touch the SDK; the `.ts` entry stays dependency-free and returns the
// deterministic web-unavailable result.

export const STRIPE_WEB_UNAVAILABLE = 'Payments unavailable on web';

/**
 * Stripe configuration options.
 */
export interface StripeConfig {
  publishableKey: string;
  testMode?: boolean;
  merchantCountry?: string;
}

/**
 * Result of initializing the payment sheet.
 */
export interface PaymentSheetResult {
  success: boolean;
  error?: string;
  customerId?: string;
}

/**
 * Initialize the Stripe Payment Sheet for a given user and price.
 */
export async function initializeStripePaymentSheet(
  _userId: string,
  _priceId: string,
  _customerId?: string
): Promise<PaymentSheetResult> {
  // Web entry: native SDK lives in `stripePayment.native.ts` (platform
  // extension resolution). Never require it here.
  void _userId; void _priceId; void _customerId;
  void Platform.OS;
  return { success: false, error: STRIPE_WEB_UNAVAILABLE };
}

/**
 * Hook for managing Stripe payment sheet state.
 */
export function useStripePayment(): {
  isLoading: boolean;
  error: string | null;
  presentPaymentSheet: (userId: string, priceId: string, customerId?: string) => Promise<PaymentSheetResult>;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presentPaymentSheet = useCallback(
    async (userId: string, priceId: string, customerId?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await initializeStripePaymentSheet(userId, priceId, customerId);
        if (!result.success) {
          setError(result.error || 'Payment sheet failed');
        }
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { isLoading, error, presentPaymentSheet };
}

/**
 * Check if the current platform supports Stripe.
 */
export function isStripeSupported(): boolean {
  const platform = Platform.OS;
  return platform === 'ios' || platform === 'android';
}
