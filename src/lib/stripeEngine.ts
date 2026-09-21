import { supabase } from './supabase';

export interface SubscriptionStatus {
  isPremium: boolean;
  status: string;
  customerId: string | null;
}

/**
 * Queries real-time subscription access matrices for the authenticated caller.
 */
export async function fetchUserSubscriptionDetails(userId: string): Promise<SubscriptionStatus> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_premium, subscription_status, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !data) throw error;

    return {
      isPremium: data.is_premium || false,
      status: data.subscription_status || 'inactive',
      customerId: data.stripe_customer_id,
    };
  } catch (err: any) {
    console.error('Subscription validation query fault:', err?.message || err);
    return { isPremium: false, status: 'error', customerId: null };
  }
}

/**
 * Simulated client checkout navigation channel mapping to a secure Stripe portal hook.
 */
export async function launchPremiumCheckoutSession(userId: string): Promise<string | null> {
  try {
    // Under deployment conditions, this module triggers an Edge Function communicating with stripe.checkout.sessions.create
    const { data, error } = await supabase.functions.invoke('create-stripe-checkout', {
      body: { userId },
    });

    if (error) throw error;
    return (data as { checkoutUrl?: string } | null)?.checkoutUrl ?? null;
  } catch (err: any) {
    console.error('Stripe session initialization error:', err?.message || err);
    return null;
  }
}
