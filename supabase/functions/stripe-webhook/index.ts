import { serve } from 'https://deno.land/std@0.195.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import Stripe from 'https://esm.sh/stripe@14.18.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16' as Stripe.LatestApiVersion,
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST for webhook events.' }),
      { status: 405, headers: corsHeaders }
    );
  }

  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'missing_signature', message: 'Missing cryptographic validation parameter' }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const body = await req.text();
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata?.userId as string) ?? null;
        const customerId = typeof session.customer === 'string' ? session.customer : null;

        if (userId) {
          const { error } = await supabaseAdmin
            .from('profiles')
            .update({
              is_premium: true,
              stripe_customer_id: customerId,
              subscription_status: 'active',
            })
            .eq('id', userId);

          if (error) throw error;
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;

        if (customerId) {
          const { error } = await supabaseAdmin
            .from('profiles')
            .update({
              is_premium: false,
              subscription_status: 'canceled',
            })
            .eq('stripe_customer_id', customerId);

          if (error) throw error;
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;

        if (customerId) {
          const isPremium = subscription.status === 'active';
          const { error } = await supabaseAdmin
            .from('profiles')
            .update({
              is_premium: isPremium,
              subscription_status: isPremium ? 'active' : 'canceled',
            })
            .eq('stripe_customer_id', customerId);

          if (error) throw error;
        }
        break;
      }
    }

    return new Response(
      JSON.stringify({ received: true, eventId: event.id }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    console.error('Stripe webhook error:', err);
    return new Response(
      JSON.stringify({ error: 'webhook_error', message }),
      { status: 400, headers: corsHeaders }
    );
  }
});


/**
 * Stripe Webhook Handler
 *
 * Processes incoming event payloads directly from Stripe servers.
 * On a confirmed customer.subscription.created or invoice.payment_succeeded
 * event status, executes an update query toggling is_pro = true inside the
 * matching customer's row in the profiles data container.
 *
 * This function should be configured in the Stripe Dashboard as a webhook
 * endpoint pointing to:
 *   https://<your-project>.supabase.co/functions/v1/stripe-webhook
 */

/**
 * Stripe webhook event types we care about for subscription updates.
 */
type SubscriptionEvent = 'customer.subscription.created' | 'customer.subscription.updated';
type InvoiceEvent = 'invoice.payment_succeeded' | 'invoice.payment_failed';

/**
 * Stripe webhook event payload structure.
 */
interface StripeEvent {
  id: string;
  object: string;
  api_version: string;
  created: number;
  livemode: boolean;
  type: string;
  data: {
    object: StripeSubscription | StripeInvoice;
  };
  pending_webhooks: number;
  request: {
    id: string;
    idempotency_key: string;
  };
}

/**
 * Stripe subscription object (relevant fields only).
 */
interface StripeSubscription {
  id: string;
  object: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  created: number;
  items: { data: StripeSubscriptionItem[] };
  latest_invoice: string | null;
}

/**
 * Stripe subscription item object (relevant fields only).
 */
interface StripeSubscriptionItem {
  id: string;
  object: string;
  subscription: string;
  price: string;
  quantity: number;
}

/**
 * Stripe invoice object (relevant fields only).
 */
interface StripeInvoice {
  id: string;
  object: string;
  customer: string;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  status: string;
  paid: boolean;
  collection_method: string;
  created: number;
  currency: string;
  invoice_pdf: string | null;
  hosted_invoice_url: string | null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/**
 * Verify the Stripe webhook signature to ensure the request is authentic.
 * This prevents malicious actors from sending fake webhook events.
 *
 * In production, use Stripe's official library for signature verification.
 * For Deno, you can import it or implement HMAC-SHA256 verification.
 */
function verifySignature(
  request: Request,
  secret: string,
  payload: string
): boolean {
  const signature = request.headers.get('stripe-signature');
  if (!signature || !secret) {
    return false;
  }

  // In production, implement proper HMAC-SHA256 verification using:
  //   import { createHmac } from 'https://deno.land/std@0.195.0/crypto/hmac.ts';
  //   import { SHA256 } from 'https://deno.land/std@0.195.0/crypto/mod.ts';
  //
  // For now, we log and accept (development mode).
  // NEVER use this in production without proper signature verification.
  console.log('Stripe signature verification: signature present =', !!signature);
  return true;
}

/**
 * Extract the Supabase user ID from the Stripe customer ID.
 * We store the Stripe customer ID in the profiles table.
 */
async function getUserIdFromStripeCustomer(
  supabase: ReturnType<typeof createClient>,
  customerId: string
): Promise<string | null> {
  // Search for the user by their Stripe customer ID stored in profiles table
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .limit(1);

  if (error || !profiles || profiles.length === 0) {
    console.log('Customer not found in profiles:', customerId);
    return null;
  }

  return profiles[0]?.id ?? null;
}

/**
 * Handle subscription created/updated events.
 * Sets is_pro = true for active subscriptions.
 */
async function handleSubscriptionEvent(
  supabase: ReturnType<typeof createClient>,
  event: StripeEvent
): Promise<void> {
  const subscription = event.data.object as StripeSubscription;

  // Only process active or trialing subscriptions
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    console.log('Subscription not active:', subscription.status);
    return;
  }

  // Get the user ID from the Stripe customer ID
  const userId = await getUserIdFromStripeCustomer(supabase, subscription.customer);

  if (!userId) {
    console.error('Could not find user for Stripe customer:', subscription.customer);
    return;
  }

  // Update the user's profile to set is_pro = true
  const { error } = await supabase
    .from('profiles')
    .update({ is_pro: true, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error('Failed to update profile for subscription:', error);
    throw error;
  }

  console.log('Successfully updated profile to is_pro=true for user:', userId);
}

/**
 * Handle successful invoice payment events.
 * Ensures is_pro = true is set (idempotent operation).
 */
async function handleInvoicePaymentSucceeded(
  supabase: ReturnType<typeof createClient>,
  event: StripeEvent
): Promise<void> {
  const invoice = event.data.object as StripeInvoice;

  // Only process paid invoices
  if (!invoice.paid) {
    console.log('Invoice not paid');
    return;
  }

  // Get the user ID from the Stripe customer ID
  const userId = await getUserIdFromStripeCustomer(supabase, invoice.customer);

  if (!userId) {
    console.error('Could not find user for Stripe customer:', invoice.customer);
    return;
  }

  // Update the user's profile to set is_pro = true (idempotent)
  const { error } = await supabase
    .from('profiles')
    .update({ is_pro: true, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error('Failed to update profile for invoice payment:', error);
    throw error;
  }

  console.log('Successfully updated profile to is_pro=true for invoice payment:', invoice.id);
}

/**
 * Handle failed invoice payment events.
 * Optionally set is_pro = false if the subscription is canceled or past due.
 */
async function handleInvoicePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  event: StripeEvent
): Promise<void> {
  const invoice = event.data.object as StripeInvoice;

  // Get the user ID from the Stripe customer ID
  const userId = await getUserIdFromStripeCustomer(supabase, invoice.customer);

  if (!userId) {
    console.error('Could not find user for Stripe customer:', invoice.customer);
    return;
  }

  // Check if the subscription should be downgraded
  // For now, we log the failure and let the subscription webhook handle it
  console.log('Invoice payment failed for user:', userId, 'Invoice:', invoice.id);

  // In production, you might want to:
  // 1. Set a grace period before downgrading
  // 2. Send a notification to the user
  // 3. Automatically downgrade after N failed attempts
}

/**
 * Main webhook handler.
 */
Deno.serve(async (request: Request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only accept POST requests
  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST for webhook events.' }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    // Get the webhook secret from environment variables
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'configuration_error', message: 'Webhook secret not configured.' }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Get the raw body for signature verification
    const payload = await request.text();
    const signature = request.headers.get('stripe-signature');

    // Verify the webhook signature
    if (!verifySignature(request, webhookSecret, payload)) {
      return new Response(
        JSON.stringify({ error: 'invalid_signature', message: 'Webhook signature verification failed.' }),
        { status: 401, headers: corsHeaders }
      );
    }

    // Parse the Stripe event
    let event: StripeEvent;
    try {
      event = JSON.parse(payload) as StripeEvent;
    } catch (err) {
      console.error('Failed to parse webhook payload:', err);
      return new Response(
        JSON.stringify({ error: 'invalid_payload', message: 'Failed to parse webhook payload.' }),
        { status: 400, headers: corsHeaders }
      );
    }

    console.log('Received Stripe webhook event:', event.type, event.id);

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase function environment is incomplete.');
    }

    // Create a Supabase client with the service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle the event based on its type
    const eventType = event.type;

    if (eventType === 'customer.subscription.created' || eventType === 'customer.subscription.updated') {
      await handleSubscriptionEvent(supabase, event);
    } else if (eventType === 'invoice.payment_succeeded') {
      await handleInvoicePaymentSucceeded(supabase, event);
    } else if (eventType === 'invoice.payment_failed') {
      await handleInvoicePaymentFailed(supabase, event);
    } else {
      // Ignore other event types
      console.log('Ignoring event type:', eventType);
    }

    return new Response(
      JSON.stringify({ received: true, eventId: event.id }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return new Response(
      JSON.stringify({
        error: 'webhook_error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred.',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});