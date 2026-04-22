"use client";

// Chat UI del playground: chips + input libre + 👍/👎 tras cada respuesta.
// Llama /api/tenant/playground para obtener la respuesta del agente real
// (vía runtime → brain.generar_respuesta) y /api/tenant/feedback para guardar
// el veredicto. Si 👎 el backend manda email al super admin.

import { useEffect, useRef, useState } from "react";
import { MessageContent } from "@/components/message-content";
import type { Chip } from "./chips";

type Msg = { role: "user" | "assistant"; content: string; feedback?: "up" | "down" | null };

export function PlaygroundChat({
  tenantName,
  chips,
}: {
  tenantName: string;
  chips: Chip[];
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string, source: string = "free") {
    if (!text.trim() || pending) return;
    setErr(null);
    const next: Msg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/tenant/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
        setMessages((m) => m.slice(0, -1));
        return;
      }
      const data = (await res.json()) as { response: string };
      setMessages((m) => [...m, { role: "assistant", content: data.response, feedback: null }]);
      // Guarda source para el futuro feedback.
      lastSource.current = source;
      lastUser.current = text.trim();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  const lastSource = useRef<string>("free");
  const lastUser = useRef<string>("");

  async function sendFeedback(idx: number, verdict: "up" | "down") {
    const msg = messages[idx];
    if (!msg || msg.role !== "assistant") return;
    const userMsg = idx > 0 ? messages[idx - 1]?.content ?? "" : "";

    let reason: string | undefined;
    if (verdict === "down") {
      const r = prompt("¿Qué debería haber dicho el bot? (opcional)") ?? "";
      reason = r.trim() || undefined;
    }

    // Optimistic
    setMessages((m) =>
      m.map((mm, i) => (i === idx ? { ...mm, feedback: verdict } : mm)),
    );

    try {
      await fetch("/api/tenant/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: userMsg,
          bot_response: msg.content,
          verdict,
          reason,
          source: lastSource.current,
        }),
      });
    } catch {
      // best-effort; no revertimos para no molestar
    }
  }

  return (
    <div className="space-y-4">
      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => send(c.text, `chip:${c.id}`)}
            disabled={pending}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
            title={c.text}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Chat */}
      <div
        ref={scrollRef}
        className="flex h-[calc(100vh-380px)] flex-col space-y-3 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4"
      >
        {messages.length === 0 && (
          <div className="m-auto max-w-md text-center text-sm text-neutral-500">
            <p className="font-medium text-neutral-700">Probando a {tenantName}</p>
            <p className="mt-1">
              Pulsa un chip de arriba o escribe abajo. El bot responde con su
              configuración real — igual que cuando responde a un cliente.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                "max-w-[80%] space-y-2 rounded-2xl px-4 py-2.5 text-sm " +
                (m.role === "user"
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-900")
              }
            >
              <MessageContent text={m.content} />
              {m.role === "assistant" && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => sendFeedback(i, "up")}
                    disabled={m.feedback != null}
                    className={`rounded-md px-2 py-0.5 text-xs transition-colors disabled:cursor-default ${
                      m.feedback === "up"
                        ? "bg-emerald-100 text-emerald-700"
                        : "text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => sendFeedback(i, "down")}
                    disabled={m.feedback != null}
                    className={`rounded-md px-2 py-0.5 text-xs transition-colors disabled:cursor-default ${
                      m.feedback === "down"
                        ? "bg-red-100 text-red-700"
                        : "text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    👎
                  </button>
                  {m.feedback === "down" && (
                    <span className="text-[11px] text-neutral-500">
                      Enviado al equipo Ordy
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-500">
              …escribiendo
            </div>
          </div>
        )}
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={pending}
          placeholder="Escribe tu prueba…"
          className="flex-1 resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
        />
        <button
          onClick={() => send(input)}
          disabled={pending || !input.trim()}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
