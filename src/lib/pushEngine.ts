import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

/**
 * Validates local operating layout access permissions and binds the active target device push token back to Supabase.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<string | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') return null;
    
    // Request unique native push container endpoint string coordinates
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    
    // Save target device link coordinates directly to the user profile table records
    const { error } = await supabase
      .from('profiles')
      .update({ push_token: token })
      .eq('id', userId);
      
    if (error) throw error;
    return token;
  } catch (err) {
    console.error("Telemetry token registry error:", err);
    return null;
  }
}
