// web/app/chat/[slug]/webchat-ui.tsx
// Client chat: visitante anónimo, sessionId en localStorage, historial
// mantenido client-side y enviado con cada request (stateless server v1).

"use client";

import { Send } from "lucide-react";
import * as React from "react";

type Turn = { id: string; role: "user" | "assistant"; content: string };

const HISTORY_KEY_PREFIX = "ordy_webchat_history_";
const SESSION_KEY_PREFIX = "ordy_webchat_session_";
const MAX_HISTORY_TURNS = 20;

function genSessionId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `wc_${Date.now().toString(36)}_${rnd}`;
}

export function WebchatUI({
  tenantSlug,
  businessName,
  agentName,
  paused,
  fallbackMessage,
}: {
  tenantSlug: string;
  businessName: string;
  agentName: string;
  paused: boolean;
  fallbackMessage: string;
}) {
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const sKey = SESSION_KEY_PREFIX + tenantSlug;
    let sid = localStorage.getItem(sKey);
    if (!sid) {
      sid = genSessionId();
      localStorage.setItem(sKey, sid);
    }
    setSessionId(sid);

    const hKey = HISTORY_KEY_PREFIX + tenantSlug;
    try {
      const raw = localStorage.getItem(hKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Turn[];
        if (Array.isArray(parsed)) setTurns(parsed.slice(-MAX_HISTORY_TURNS));
      }
    } catch {
      /* ignore bad JSON */
    }
  }, [tenantSlug]);

  React.useEffect(() => {
    if (!sessionId) return;
    const hKey = HISTORY_KEY_PREFIX + tenantSlug;
    try {
      localStorage.setItem(hKey, JSON.stringify(turns.slice(-MAX_HISTORY_TURNS)));
    } catch {
      /* quota/private mode — ignore */
    }
  }, [turns, tenantSlug, sessionId]);

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, sending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !sessionId || sending) return;

    const userTurn: Turn = {
      id: `u_${Date.now()}`,
      role: "user",
      content: text,
    };
    setTurns((prev) => [...prev, userTurn]);
    setInput("");
    setSending(true);

    try {
      const history = turns
        .slice(-MAX_HISTORY_TURNS)
        .map((t) => ({ role: t.role, content: t.content }));

      const res = await fetch(`/api/webchat/${tenantSlug}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, text, history }),
      });

      if (res.status === 429) {
        setTurns((prev) => [
          ...prev,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            content: "Vas demasiado rápido. Espera un minuto y reintenta.",
          },
        ]);
        return;
      }

      if (!res.ok) {
        setTurns((prev) => [
          ...prev,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            content: fallbackMessage || "Ahora no puedo responder. Reintenta en un minuto.",
          },
        ]);
        return;
      }

      const data = (await res.json()) as { reply?: string };
      if (data?.reply) {
        setTurns((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: "assistant", content: data.reply! },
        ]);
      }
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          content: "Sin conexión. Reintenta.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const initial = businessName.trim()[0]?.toUpperCase() ?? "•";

  return (
    <main className="flex h-[100dvh] flex-col bg-black text-white">
      <header
        className="flex items-center gap-3 border-b border-white/10 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
          {initial}
        </div>
        <div className="flex-1">
          <div className="font-semibold">{businessName}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/50">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-400" : "bg-emerald-400"}`}
            />
            {paused ? "Pausado" : `${agentName} · responde al instante`}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {turns.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/70">
            Hola 👋 Soy {agentName} de {businessName}. ¿En qué te ayudo?
            Pregúntame por la carta, horarios, reservas o alergias.
          </div>
        ) : null}

        {turns.map((t) => (
          <div
            key={t.id}
            className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                t.role === "user"
                  ? "rounded-br-md bg-emerald-500/20 text-white"
                  : "rounded-bl-md bg-white/[0.05] text-white/90 ring-1 ring-white/10"
              }`}
            >
              {t.content}
            </div>
          </div>
        ))}

        {sending ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
              <Dot delay={0} />
              <Dot delay={150} />
              <Dot delay={300} />
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={paused ? "Chat pausado" : "Escribe tu mensaje…"}
          disabled={paused || sending}
          className="flex-1 rounded-full bg-white/[0.05] px-4 py-2.5 text-base text-white placeholder:text-white/30 ring-1 ring-white/10 focus:outline-none focus:ring-emerald-400/40 disabled:opacity-50"
          aria-label="Escribe tu mensaje"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending || paused}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:opacity-90 disabled:opacity-40"
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </main>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white/50"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
