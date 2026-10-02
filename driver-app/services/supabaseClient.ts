import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Single shared client for the whole app — Auth (phone OTP, session
// persistence) and Realtime (chat) both need to agree on the same
// session/storage, so this replaces the separate client that
// services/chat.ts used to create on its own.
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  {
    auth: {
      storage: AsyncStorage, // persists the session across app restarts
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // not a web redirect flow
    },
  }
);

/** Current session's access token, or null if not logged in. Attach this as `Authorization: Bearer <token>` on every backend call. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
