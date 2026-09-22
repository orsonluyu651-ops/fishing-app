import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Transmits native code faults or unexpected network errors straight to remote database log instances.
 */
export async function reportNativeCrash(message: string, stack: string | null = null): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('crash_logs').insert([{
      user_id: user?.id || null,
      error_message: message,
      error_stack: stack,
      device_platform: Platform.OS
    }]);
  } catch (err) {
    console.error("Critical failure inside the diagnostic telemetry loop:", err);
  }
}
