import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

/**
 * Stripe Checkout Edge Function
 *
 * Creates a PaymentIntent for the Stripe Payment Sheet.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

interface CheckoutRequest {
  userId: string;
  priceId: string;
  customerId?: string;
  type: 'payment_sheet' | 'subscription';
}

const json = (request: Request, body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json(request, { error: 'method_not_allowed' }, 405);
  }

  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(request, { error: 'unauthorized', message: 'A bearer token is required.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase function environment is incomplete.');
    }

    if (!stripeSecretKey) {
      return json(request, { error: 'configuration_error', message: 'Stripe secret key not configured.' }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return json(request, { error: 'unauthorized', message: 'The session is invalid or expired.' }, 401);
    }

    let payload: CheckoutRequest;
    try {
      payload = await request.json() as CheckoutRequest;
    } catch {
      return json(request, { error: 'invalid_json' }, 400);
    }

    const { userId, priceId, customerId, type } = payload;

    if (!userId || !isUuid(userId) || userId !== userData.user.id) {
      return json(request, { error: 'invalid_user' }, 400);
    }

    if (!priceId || typeof priceId !== 'string') {
      return json(request, { error: 'invalid_price' }, 400);
    }

    if (type !== 'payment_sheet' && type !== 'subscription') {
      return json(request, { error: 'invalid_type' }, 400);
    }

    let stripeCustomerId = customerId;

    if (!stripeCustomerId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', userId)
        .maybeSingle();

      stripeCustomerId = profile?.stripe_customer_id;
    }

    if (!stripeCustomerId) {
      // In production, create a real Stripe customer here
      stripeCustomerId = `cus_demo_${userId.slice(0, 8)}`;
    }

    // In production, create a real PaymentIntent here
    const clientSecret = `pi_demo_${userId.slice(0, 8)}_secret_${Date.now()}`;
    const ephemeralKey = `ek_demo_${userId.slice(0, 8)}_${Date.now()}`;

    return json(request, {
      clientSecret,
      customer: stripeCustomerId,
      ephemeralKey,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return json(
      request,
      { error: 'checkout_failed', message: error instanceof Error ? error.message : 'An unexpected error occurred.' },
      500
    );
  }
});
