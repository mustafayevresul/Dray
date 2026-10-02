import { createClient } from "@supabase/supabase-js";

// Single shared client for Auth (phone OTP) and Realtime (chat) — same
// pattern as driver-app/services/supabaseClient.ts. Browser localStorage
// is Supabase's default session storage on web, so no custom storage
// adapter is needed here the way React Native needs AsyncStorage.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
