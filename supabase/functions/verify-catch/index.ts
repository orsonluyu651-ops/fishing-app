import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = (request: Request): HeadersInit => {
  const origin = request.headers.get('origin');
  const allowedOrigins = (Deno.env.get('VERIFY_CATCH_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowOrigin = origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))
    ? origin
    : allowedOrigins.length === 0
      ? '*'
      : 'null';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
};

type VerificationStatus = 'pending' | 'verified' | 'flagged';

type VerifyCatchPayload = {
  userId: string;
  species: string;
  length?: number;
  weight?: number;
  lengthCm?: number;
  weightKg?: number;
  mediaPath: string;
};

type VerificationMetrics = {
  species_confidence: number;
  measurement_confidence: number;
  image_manipulation_score: number;
  duplicate_score: number;
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isOwnedMediaPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`)
    && path.length > userId.length + 1
    && !path.includes('..')
    && !path.includes('\\');
}

function plausibleMeasurement(length: number, weight: number): number {
  const lengthPlausible = length >= 5 && length <= 300;
  const weightPlausible = weight >= 0.01 && weight <= 200;
  const ratioPlausible = weight <= 0 || length <= 0 || weight / length <= 0.75;
  if (lengthPlausible && weightPlausible && ratioPlausible) return 0.92;
  if (lengthPlausible && weightPlausible) return 0.68;
  return 0.2;
}

function aggregate(metrics: VerificationMetrics): number {
  return Number(clamp01(
    metrics.species_confidence * 0.35
      + metrics.measurement_confidence * 0.3
      + (1 - metrics.image_manipulation_score) * 0.2
      + (1 - metrics.duplicate_score) * 0.15,
  ).toFixed(4));
}

function evaluate(metrics: VerificationMetrics, flags: string[]) {
  const hardFailure = metrics.duplicate_score >= 0.5 || metrics.image_manipulation_score >= 0.5;
  const verified = metrics.species_confidence >= 0.8
    && metrics.measurement_confidence >= 0.8
    && metrics.image_manipulation_score < 0.3
    && metrics.duplicate_score < 0.3
    && flags.length === 0;

  const verification_status: VerificationStatus = hardFailure
    ? 'flagged'
    : verified
      ? 'verified'
      : 'pending';

  return {
    verification_status,
    leaderboard_eligibility: verification_status === 'verified',
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return json(request, { error: 'method_not_allowed', message: 'Use POST for catch verification.' }, 405);
  }

  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json(request, { error: 'unauthorized', message: 'A bearer token is required.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase function environment is incomplete.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return json(request, { error: 'unauthorized', message: 'The session is invalid or expired.' }, 401);
    }

    let payload: Partial<VerifyCatchPayload>;
    try {
      payload = await request.json() as Partial<VerifyCatchPayload>;
    } catch {
      return json(request, { error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
    }
    const userId = payload.userId;
    const species = typeof payload.species === 'string' ? payload.species.trim() : '';
    const length = payload.length ?? payload.lengthCm;
    const weight = payload.weight ?? payload.weightKg;
    const mediaPath = typeof payload.mediaPath === 'string' ? payload.mediaPath.trim() : '';

    if (!userId || !isUuid(userId) || userId !== userData.user.id) {
      return json(request, { error: 'invalid_user', message: 'userId must match the authenticated user.' }, 400);
    }
    if (!species || species.length > 120) {
      return json(request, { error: 'invalid_species', message: 'species is required and must be 120 characters or fewer.' }, 400);
    }
    if (typeof length !== 'number' || !Number.isFinite(length) || typeof weight !== 'number' || !Number.isFinite(weight)) {
      return json(request, { error: 'invalid_measurements', message: 'length and weight must be finite numbers.' }, 400);
    }
    if (!isOwnedMediaPath(mediaPath, userId)) {
      return json(request, { error: 'invalid_media_path', message: 'mediaPath must point to the authenticated user folder.' }, 400);
    }

    // Structural placeholders until a vision/forensics provider is configured.
    const flags: string[] = [];
    const metrics: VerificationMetrics = {
      species_confidence: /\.(jpe?g|png|webp)$/i.test(mediaPath) ? 0.9 : 0.35,
      measurement_confidence: plausibleMeasurement(length, weight),
      image_manipulation_score: 0.05,
      duplicate_score: 0,
    };

    // Duplicate lookup becomes active once migration 0009 is applied. A
    // schema-cache miss is reported as pending rather than approving a claim.
    const duplicateLookup = await supabase
      .from('catches')
      .select('id')
      .eq('media_path', mediaPath)
      .neq('user_id', userId)
      .limit(1);
    if (duplicateLookup.error) {
      if (/media_path|column .* does not exist|schema cache/i.test(duplicateLookup.error.message)) {
        flags.push('duplicate_check_unavailable');
      } else {
        throw duplicateLookup.error;
      }
    } else if ((duplicateLookup.data ?? []).length > 0) {
      metrics.duplicate_score = 1;
      flags.push('duplicate_media_path');
    }

    const decision = evaluate(metrics, flags);
    return json(request, {
      ...metrics,
      verification_score: aggregate(metrics),
      ...decision,
      flags,
      model_version: 'structural-pipeline-0.1.0',
    });
  } catch (error) {
    console.error('verify-catch failed', error);
    return json(request, {
      error: 'verification_failed',
      message: 'Catch verification could not be completed. Please try again.',
    }, 500);
  }
});
