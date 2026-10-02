import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// Previously created its own separate Supabase client here — harmless for
// a read-only Realtime subscription, but meant two independent clients
// existed with no shared session. Now uses the single app-wide client
// from supabaseClient.ts, which is also where phone-OTP auth lives.

export type ChatMessage = {
  id: string;
  tripId: string;
  senderRole: "DRIVER" | "LOAD_OWNER";
  driverId: string | null;
  ownerId: string | null;
  body: string;
  sentAt: string;
  readAt: string | null;
};

/**
 * Subscribes to new ChatMessage rows for one trip. Requires Realtime to be
 * enabled on the table in Supabase — see README_PHASE3.md:
 *   alter publication supabase_realtime add table "ChatMessage";
 *
 * Returns an unsubscribe function; call it in a useEffect cleanup.
 */
export function subscribeToTripChat(tripId: string, onMessage: (msg: ChatMessage) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`trip-chat-${tripId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "ChatMessage", filter: `tripId=eq.${tripId}` },
      (payload) => onMessage(payload.new as ChatMessage)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
