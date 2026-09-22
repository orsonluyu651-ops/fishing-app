/**
 * Premium Access Controller
 *
 * Provides hooks and feature-gate guards for the Fishlore premium
 * subscription system. Uses Supabase to check the signed-in user's
 * profile table for an `is_pro` boolean flag.
 *
 * Features guarded by this module:
 *   - AI Assistant view access (requires is_pro = true)
 *   - Map tile caching beyond 3 tiles (requires is_pro = true)
 */

import { useState, useEffect } from 'react';
import { supabase, type Profile } from './supabase';

/**
 * Hook that checks the signed-in user's profile for premium status.
 *
 * @returns {object} Premium status state
 *   - isPro: boolean — whether the user has an active premium subscription
 *   - loading: boolean — whether the status is still being fetched
 *   - error: Error | null — any error that occurred during fetch
 */
export function usePremiumStatus(): {
  isPro: boolean;
  loading: boolean;
  error: Error | null;
} {
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchPremiumStatus() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session?.user) {
          setIsPro(false);
          setLoading(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('is_pro')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profileError) {
          throw profileError;
        }

        // Treat undefined as false (migration not applied yet)
        setIsPro(profile?.is_pro === true);
        setLoading(false);
      } catch (err) {
        console.error('Failed to fetch premium status:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch premium status'));
        setIsPro(false);
        setLoading(false);
      }
    }

    fetchPremiumStatus();
  }, []);

  return { isPro, loading, error };
}

/**
 * Feature-gate guard for AI Assistant access.
 * Returns true if the user has premium access, false otherwise.
 *
 * @param isPro - Current premium status
 * @returns boolean indicating if AI assistant is accessible
 */
export function canAccessAIAssistant(isPro: boolean): boolean {
  return isPro;
}

/**
 * Feature-gate guard for map tile caching.
 * Free users can cache up to 3 tiles; premium users have unlimited caching.
 *
 * @param isPro - Current premium status
 * @param currentTileCount - Number of tiles currently cached by the user
 * @param requestedTileCount - Number of tiles the user is trying to cache
 * @returns object with:
 *   - allowed: boolean — whether the operation is permitted
 *   - remainingFreeTiles: number — how many more tiles a free user can cache (max 0 if exceeded)
 */
export function canCacheMapTiles(
  isPro: boolean,
  currentTileCount: number,
  requestedTileCount: number
): { allowed: boolean; remainingFreeTiles: number } {
  // Premium users have unlimited tile caching
  if (isPro) {
    return { allowed: true, remainingFreeTiles: Infinity };
  }

  // Free users: max 3 tiles total
  const MAX_FREE_TILES = 3;
  const totalAfterCache = currentTileCount + requestedTileCount;

  if (totalAfterCache <= MAX_FREE_TILES) {
    return {
      allowed: true,
      remainingFreeTiles: MAX_FREE_TILES - totalAfterCache,
    };
  }

  // Exceeded free limit
  return {
    allowed: false,
    remainingFreeTiles: Math.max(0, MAX_FREE_TILES - currentTileCount),
  };
}

/**
 * Determines if the user should be shown the premium upsell paywall.
 * This is true when the user is not premium and has tried to access a
 * premium-only feature.
 *
 * @param isPro - Current premium status
 * @returns boolean indicating if paywall should be shown
 */
export function shouldShowPaywall(isPro: boolean): boolean {
  return !isPro;
}
