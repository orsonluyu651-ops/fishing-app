// Ambient declarations for the Deno-based Supabase Edge Functions in this folder.
//
// These functions are deployed to Deno and import dependencies straight from
// esm.sh at runtime. The editor has no Deno toolchain installed, so without these
// declarations its TypeScript service reports "Cannot find name 'Deno'" and
// "Cannot find module 'https://esm.sh/...'" for code that is perfectly valid when
// deployed.
//
// supabase/functions/tsconfig.json points the editor at this file, so the folder is
// type-checked as its own project, independent of the Expo app. These are types
// only - nothing here is bundled into the app or executed at runtime.

declare namespace Deno {
  /** Environment access used for SUPABASE_URL / SUPABASE_ANON_KEY lookups. */
  const env: {
    get(key: string): string | undefined;
    toObject(): Record<string, string>;
  };

  /** Registers the fetch handler that Deno runs for the function. */
  function serve(
    handler: (request: Request) => Response | Promise<Response>,
  ): {
    finished: Promise<void>;
    shutdown(): Promise<void>;
  };

  const version: { deno: string; v8: string; typescript: string };
}

/**
 * Typed stand-in for the esm.sh import in verify-catch/index.ts. Delegates to the
 * copy of @supabase/supabase-js already installed in the app so the edge function
 * gets real client types instead of an untyped import.
 */
declare module 'https://esm.sh/@supabase/supabase-js@2.45.0' {
  import type { SupabaseClient } from '@supabase/supabase-js';

  export function createClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: Record<string, unknown>,
  ): SupabaseClient;
}

declare module 'https://esm.sh/stripe@14.18.0' {
  import type Stripe from '@stripe/stripe-js';

  const StripeModule: typeof Stripe;
  export = StripeModule;
}

declare module 'https://deno.land/std@0.195.0/http/server.ts' {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
