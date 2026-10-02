"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { subscribeToTripChat, ChatMessage } from "@/lib/chat";
import { api } from "@/lib/api";
import { useTranslation } from "../i18n/LocaleProvider";

export default function ChatPanel({
  tripId,
  driverPhone,
}: {
  tripId: string;
  driverPhone: string | null;
}) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getTripMessages(tripId)
      .then(setMessages)
      .catch(() => setError("Couldn't load chat history."));

    const unsubscribe = subscribeToTripChat(tripId, (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    });
    return unsubscribe;
  }, [tripId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const sent = await api.sendTripMessage(tripId, body);
      setMessages((prev) => [...prev, sent]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [draft, sending, tripId]);

  return (
    <div className="mt-6 flex h-96 flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{t("chatScreen.title")}</h3>
        {driverPhone && (
          <a
            href={`tel:${driverPhone}`}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {t("chatScreen.callDriver")}
          </a>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-400">No messages yet.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
              m.senderRole === "LOAD_OWNER"
                ? "ml-auto bg-slate-900 text-white"
                : "mr-auto border border-slate-200 bg-slate-50 text-slate-800"
            }`}
          >
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <input
          className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm"
          placeholder={t("chatScreen.placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t("chatScreen.send")}
        </button>
      </div>
    </div>
  );
}
