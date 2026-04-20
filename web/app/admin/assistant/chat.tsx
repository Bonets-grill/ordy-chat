"use client";

// Client chat UI para /admin/assistant. Maneja:
//  - Estado messages[] (role + content)
//  - Streaming lectura desde /api/admin/assistant (Response body ReadableStream)
//  - UI con scroll auto, botón envío, loading indicator
//  - Manejo de 429 (rate limit) y 5xx con mensaje claro

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setError(null);
    const newMessages: Msg[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    // Placeholder assistant message que se va rellenando con el stream.
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          errMsg = j.error ?? j.message ?? errMsg;
          if (res.status === 429 && j.retry_after_seconds) {
            errMsg = `Rate limit. Reintenta en ${j.retry_after_seconds}s.`;
          }
        } catch {}
        setError(errMsg);
        setMessages((m) => m.slice(0, -1)); // quita el placeholder
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("sin body en respuesta");
        return;
      }
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "error_desconocido");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-[calc(100vh-220px)] flex-col rounded-xl border border-neutral-200 bg-white">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500 space-y-2">
            <p>Pregunta algo sobre el sistema o un tenant.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>"¿Qué tenants están fallando el validador?"</li>
              <li>"Bonets Grill Icod no responde audios, ayúdame a diagnosticar."</li>
              <li>"¿Cómo deshabilito temporalmente el validador para X?"</li>
              <li>"Dame SQL para ver las reservas de hoy en todos los tenants."</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed " +
                (m.role === "user"
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-900")
              }
            >
              {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
      <div className="border-t border-neutral-200 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Pregunta algo…"
            rows={2}
            disabled={streaming}
            className="flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:bg-white disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {streaming ? "…" : "Enviar"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          Claude Opus 4.7 · 20 msgs/hora · cada turno queda en audit_log
        </p>
      </div>
    </div>
  );
}
