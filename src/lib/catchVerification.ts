import { supabase } from './supabase';

export type VerificationStatus = 'pending' | 'verified' | 'flagged';

export interface VerifyCatchInput {
  catchId?: string;
  userId: string;
  mediaPath: string | null;
  species: string;
  lengthCm: number;
  weightKg: number;
  metadata: {
    mimeType: string | null;
    capturedAt: string;
  };
}

export interface VerificationMetrics {
  species_confidence: number;
  measurement_confidence: number;
  image_manipulation_score: number;
  duplicate_score: number;
}

export interface VerificationResult {
  verification_status: VerificationStatus;
  verification_score: number;
  leaderboard_eligibility: boolean;
  metrics: VerificationMetrics;
  flags: string[];
  model_version: string;
}

interface VerifyCatchResponse {
  metrics?: Partial<VerificationMetrics>;
  verification_status?: VerificationStatus;
  verification_score?: number;
  leaderboard_eligibility?: boolean;
  flags?: string[];
  model_version?: string;
}

const VERIFIED_THRESHOLD = 0.8;
const REVIEW_THRESHOLD = 0.55;

function boundedScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function averageMetrics(metrics: VerificationMetrics): number {
  return Number((
    metrics.species_confidence * 0.35 +
    metrics.measurement_confidence * 0.30 +
    (1 - metrics.image_manipulation_score) * 0.20 +
    (1 - metrics.duplicate_score) * 0.15
  ).toFixed(4));
}

function normalizeMetrics(raw: Partial<VerificationMetrics> | undefined): VerificationMetrics {
  return {
    species_confidence: boundedScore(raw?.species_confidence),
    measurement_confidence: boundedScore(raw?.measurement_confidence),
    image_manipulation_score: boundedScore(raw?.image_manipulation_score),
    duplicate_score: boundedScore(raw?.duplicate_score),
  };
}

export function computeVerificationResult(
  metrics: VerificationMetrics,
  serverFlags: string[] = [],
  modelVersion = 'server-verification-unknown',
): VerificationResult {
  const verificationScore = averageMetrics(metrics);
  const flags = [...new Set(serverFlags)];
  const hasHardFailure =
    metrics.species_confidence < REVIEW_THRESHOLD ||
    metrics.measurement_confidence < REVIEW_THRESHOLD ||
    metrics.image_manipulation_score >= 0.45 ||
    metrics.duplicate_score >= 0.45;
  const canVerify =
    metrics.species_confidence >= VERIFIED_THRESHOLD &&
    metrics.measurement_confidence >= VERIFIED_THRESHOLD &&
    metrics.image_manipulation_score < 0.2 &&
    metrics.duplicate_score < 0.2 &&
    flags.length === 0;

  return {
    verification_status: hasHardFailure ? 'flagged' : canVerify ? 'verified' : 'pending',
    verification_score: verificationScore,
    leaderboard_eligibility: canVerify,
    metrics,
    flags,
    model_version: modelVersion,
  };
}

export async function verifyCatchPayload(
  input: VerifyCatchInput,
  onStage?: (stage: string) => void,
): Promise<VerificationResult> {
  if (!input.mediaPath) {
    return computeVerificationResult(
      {
        species_confidence: 0,
        measurement_confidence: 0,
        image_manipulation_score: 0,
        duplicate_score: 0,
      },
      ['no_photo_attached'],
      'server-verification-not-run',
    );
  }

  onStage?.('Analyzing image forensic data...');
  const { data, error } = await supabase.functions.invoke<VerifyCatchResponse>('verify-catch', {
    body: input,
  });
  if (error) throw new Error(`Catch verification failed: ${error.message}`);
  if (!data?.metrics) throw new Error('Catch verification returned no metrics.');

  onStage?.('Checking species plausibility...');
  const metrics = normalizeMetrics(data.metrics);
  onStage?.('Validating catch sizing...');
  return computeVerificationResult(metrics, data.flags, data.model_version);
}
