/**
 * Stripe Payment Sheet Bridge — NATIVE implementation.
 *
 * Platform-extension sibling of `stripePayment.ts`. Metro resolves
 * `stripePayment.native` for iOS/Android and `stripePayment` (web stub)
 * for web, so the native SDK never enters the web module graph.
 */

import { useState, useCallback } from 'react';
import {
  initPaymentSheet,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export interface StripeConfig {
  publishableKey: string;
  testMode?: boolean;
  merchantCountry?: string;
}

export interface PaymentSheetResult {
  success: boolean;
  error?: string;
  customerId?: string;
}

export const STRIPE_WEB_UNAVAILABLE = 'Payments unavailable on web';

export async function initializeStripePaymentSheet(
  userId: string,
  priceId: string,
  customerId?: string
): Promise<PaymentSheetResult> {
  try {
    const { data, error } = await supabase.functions.invoke('stripe-checkout', {
      body: { userId, priceId, customerId, type: 'payment_sheet' },
    });

    if (error) {
      console.error('Stripe checkout function error:', error);
      return { success: false, error: error.message || 'Failed to initialize payment sheet' };
    }

    const { clientSecret, customer, ephemeralKey } = data as {
      clientSecret: string;
      customer: string;
      ephemeralKey: string;
    };

    if (!clientSecret || !customer || !ephemeralKey) {
      return { success: false, error: 'Invalid response from Stripe checkout' };
    }

    const initResult = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      customerId: customer,
      merchantDisplayName: 'Fishing App',
    });

    if (initResult.error) {
      console.error('Payment sheet init error:', initResult.error);
      return { success: false, error: initResult.error.message || 'Payment sheet initialization failed' };
    }

    const presentResult = await presentPaymentSheet();

    if (presentResult.error) {
      console.error('Payment sheet present error:', presentResult.error);
      return { success: false, error: presentResult.error.message || 'Payment sheet presentation failed' };
    }

    if (presentResult.didCancel) {
      return { success: false, error: 'Payment cancelled by user' };
    }

    return { success: true, customerId: customer };
  } catch (err) {
    console.error('initializeStripePaymentSheet failed:', err);
    return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' };
  }
}

export function useStripePayment(): {
  isLoading: boolean;
  error: string | null;
  presentPaymentSheet: (userId: string, priceId: string, customerId?: string) => Promise<PaymentSheetResult>;
} {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presentPaymentSheetCb = useCallback(
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

  return { isLoading, error, presentPaymentSheet: presentPaymentSheetCb };
}

export function isStripeSupported(): boolean {
  const platform = Platform.OS;
  return platform === 'ios' || platform === 'android';
}
