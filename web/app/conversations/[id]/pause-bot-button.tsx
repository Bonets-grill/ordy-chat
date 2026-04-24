"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  conversationId: string;
  initialPaused: boolean;
  initialPauseUntil: string | null; // ISO
};

function formatRestante(until: Date): string {
  const ms = until.getTime() - Date.now();
  if (ms <= 0) return "expirando";
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (horas < 24) return min ? `${horas}h ${min}m` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes ? `${dias}d ${horasRestantes}h` : `${dias}d`;
}

export function PauseBotButton({ conversationId, initialPaused, initialPauseUntil }: Props) {
  const router = useRouter();
  const [paused, setPaused] = React.useState(initialPaused);
  const [pauseUntil, setPauseUntil] = React.useState<string | null>(initialPauseUntil);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function pausar() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause", minutes: 1440 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error ?? "Error al pausar");
      } else {
        setPaused(true);
        setPauseUntil(j.pauseUntil ?? null);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function reanudar() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/conversations/${conversationId}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unpause" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setError(j.error ?? "Error al reanudar");
      } else {
        setPaused(false);
        setPauseUntil(null);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (paused) {
    const restante = pauseUntil ? formatRestante(new Date(pauseUntil)) : "pausa indefinida";
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
          🔕 Bot pausado · {restante}
        </span>
        <Button size="sm" variant="secondary" onClick={reanudar} disabled={loading}>
          {loading ? "Reanudando…" : "▶️ Reanudar bot"}
        </Button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={pausar} disabled={loading}>
        {loading ? "Pausando…" : "🔕 Pausar bot 24h"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
