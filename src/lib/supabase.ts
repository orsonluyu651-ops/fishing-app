import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.example to .env and fill in the Supabase project values.',
  );
}

// This is the ONLY Supabase client in the app. Every screen imports this,
// nobody creates their own client. That's what keeps auth state and Row
// Level Security behaving consistently everywhere.
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Shape of the one table this milestone actually reads/writes.
// Extend this as later phases add fishing_spots, catches, etc.
export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  region_id: string | null;
  reputation_score: number;
  account_status: string;
  created_at: string;
  updated_at: string;
  // Migration 0008 (content moderation). Optional so the app still compiles
  // and behaves sanely if that migration hasn't been applied yet — treat
  // `undefined` as "not an admin".
  is_admin?: boolean;
};
