import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// Previously created its own separate client here; now shares the one
// client that also holds the Auth session (supabaseClient.ts).

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

/** Mirrors driver-app/services/chat.ts — same table, same Realtime channel pattern. */
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
