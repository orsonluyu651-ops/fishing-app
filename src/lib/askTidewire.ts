import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────
// Ask TideWire — remote client (docs/ai-assistant-spec.md §6).
//
// Thin wrapper around supabase.functions.invoke('ask-tidewire'). The LLM
// provider key lives only in the Edge Function runtime; this module never
// touches it. Error mapping mirrors the offline catch queue taxonomy:
// 4xx (401/400/422) are permanent → surfaced, no auto-retry; 408/429/5xx and
// network failures are transient → the UI invites a retry.
// ─────────────────────────────────────────────────────────────

export interface AskTidewireTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskTidewireResult {
  text: string;
  provider: string | null;
  modelVersion: string | null;
  latencyMs: number | null;
}

export interface AskTidewireOptions {
  history?: AskTidewireTurn[];
  /** Report-only regional context; rounded server-side, never echoed back. */
  coordinates?: { latitude: number; longitude: number } | null;
}

interface AskTidewireEnvelope {
  answer?: { text?: string };
  provider?: string;
  model_version?: string;
  latency_ms?: number;
}

/** Human-readable copy for the error envelope documented in the spec (§5.5). */
export async function describeAskTidewireError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = (await error.context.json()) as { error?: string; message?: string };
      if (payload.message) return payload.message;
      const fallback: Record<string, string> = {
        unauthorized: 'Your session expired — sign in and try again.',
        rate_limited: 'Daily guide limit reached — come back tomorrow.',
        provider_timeout: 'The guide took too long to respond. Try again in a moment.',
        provider_error: 'The guide service is having trouble right now.',
        provider_not_configured: 'The guide is not switched on for this project yet.',
      };
      return (payload.error && fallback[payload.error]) || 'The guide could not answer just now.';
    } catch {
      return 'The guide could not answer just now.';
    }
  }
  const message = String((error as { message?: string } | null)?.message ?? error ?? '');
  if (/network|fetch|timeout|offline/i.test(message)) {
    return 'You look offline — check your connection and try again.';
  }
  return 'The guide could not answer just now.';
}

export async function askTidewireRemote(
  message: string,
  options: AskTidewireOptions = {},
): Promise<AskTidewireResult> {
  const { data, error } = await supabase.functions.invoke<AskTidewireEnvelope>('ask-tidewire', {
    body: {
      message,
      history: options.history ?? [],
      coordinates: options.coordinates ?? null,
    },
  });
  if (error) throw error;
  const text = data?.answer?.text?.trim() ?? '';
  if (!text) throw new Error('The guide returned an empty response.');
  return {
    text,
    provider: data?.provider ?? null,
    modelVersion: data?.model_version ?? null,
    latencyMs: typeof data?.latency_ms === 'number' ? data.latency_ms : null,
  };
}
