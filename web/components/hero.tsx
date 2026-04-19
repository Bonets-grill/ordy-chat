// Landing hero dark + neon animado + typewriter character-by-character dentro del textarea.

"use client";

import { Loader2, Sparkles, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "./ui/button";

const NICHOS: { label: string; seed: string }[] = [
  { label: "Restaurante", seed: "Tengo un restaurante y quiero que el agente tome reservas y responda el menú por WhatsApp." },
  { label: "Clínica dental", seed: "Soy una clínica dental. Necesito que agende citas y confirme visitas por WhatsApp." },
  { label: "Estética", seed: "Centro de estética — quiero que el agente informe de tratamientos, precios y agende citas." },
  { label: "Inmobiliaria", seed: "Inmobiliaria: quiero calificar leads y agendar visitas de pisos automáticamente." },
  { label: "Tienda online", seed: "Tienda online — necesito responder preguntas de stock, envíos y tomar pedidos por WhatsApp." },
  { label: "Academia", seed: "Academia de formación. Quiero atender a alumnos, dar horarios y vender cursos." },
  { label: "Gimnasio", seed: "Gimnasio — atiende socios, horarios de clases y gestiona altas de membresía." },
  { label: "Abogados", seed: "Despacho de abogados. Quiero calificar casos, agendar consultas y contestar FAQ legales básicas." },
  { label: "Consultoría", seed: "Consultora: califica leads, agenda discovery calls y envía propuestas." },
  { label: "Barbería", seed: "Barbería — quiero que tome reservas de cortes y confirme citas por WhatsApp." },
];

const DEMO_MESSAGES = [
  "Mi restaurante vende pizza artesanal en Madrid, quiero tomar reservas por WhatsApp…",
  "Clínica dental en Valencia. Necesito agendar citas y confirmar por WhatsApp…",
  "Barbería con 3 sillas — quiero que tome reservas y mande recordatorios…",
  "Tienda online de moda. Responder tallas, stock y envíos 24/7…",
  "Academia de inglés: calificar leads y apuntar a pruebas de nivel…",
];

function useTypewriter(active: boolean) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let msgIdx = 0;
    let charIdx = 0;
    let mode: "typing" | "holding" | "deleting" = "typing";

    function tick() {
      if (cancelled) return;
      const msg = DEMO_MESSAGES[msgIdx];
      if (mode === "typing") {
        charIdx += 1;
        setText(msg.slice(0, charIdx));
        if (charIdx >= msg.length) {
          mode = "holding";
          setTimeout(tick, 2000);
          return;
        }
        setTimeout(tick, 28 + Math.random() * 45);
      } else if (mode === "holding") {
        mode = "deleting";
        setTimeout(tick, 50);
      } else {
        charIdx -= 2;
        if (charIdx <= 0) {
          charIdx = 0;
          msgIdx = (msgIdx + 1) % DEMO_MESSAGES.length;
          mode = "typing";
        }
        setText(msg.slice(0, Math.max(0, charIdx)));
        setTimeout(tick, 12);
      }
    }
    const t = setTimeout(tick, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active]);
  return text;
}

export function Hero() {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [improving, setImproving] = React.useState(false);
  const [improveError, setImproveError] = React.useState<string | null>(null);
  const demo = useTypewriter(value === "" && !focused);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    const nextPath = text ? `/onboarding?seed=${encodeURIComponent(text)}` : "/onboarding";
    router.push(`/signin?from=${encodeURIComponent(nextPath)}`);
  }

  async function onImprove() {
    const text = value.trim();
    if (!text || improving) return;
    setImproving(true);
    setImproveError(null);
    try {
      const res = await fetch("/api/landing/improve-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.status === 429) {
        setImproveError("Demasiados intentos. Prueba en unos minutos.");
        return;
      }
      if (!res.ok) {
        setImproveError("No se pudo mejorar ahora. Reintenta.");
        return;
      }
      const data = (await res.json()) as { improved?: string };
      if (data?.improved && typeof data.improved === "string") {
        setValue(data.improved);
      } else {
        setImproveError("Respuesta vacía. Reintenta.");
      }
    } catch {
      setImproveError("Error de red. Reintenta.");
    } finally {
      setImproving(false);
    }
  }

  return (
    <section className="relative overflow-hidden bg-black">
      <div className="absolute inset-0 grid-backdrop-dark opacity-60" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-2/3 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 hero-glow-dark" aria-hidden />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pt-14 pb-24 sm:pt-20 md:pt-28">
        <Link
          href="/pricing"
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur hover:bg-white/10"
        >
          <Sparkles className="h-3.5 w-3.5 text-accent-pink" />
          Nuevo · La primera plataforma de agentes de WhatsApp para cualquier nicho
        </Link>

        <h1 className="max-w-3xl text-center text-5xl font-semibold tracking-tight text-white sm:text-6xl md:text-7xl">
          Tu agente de WhatsApp con IA — <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-brand-500 via-accent-pink to-accent-orange bg-clip-text text-transparent">
            que de verdad vende
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-center text-lg text-white/60">
          Configura tu asistente en 5 minutos. Atiende, agenda, vende y responde 24/7.
          Funciona para cualquier negocio — desde una cafetería hasta una clínica.
        </p>

        <p className="mt-5 text-sm font-medium text-white/50">Elige tu nicho para empezar:</p>
        <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
          {NICHOS.map((n) => (
            <button
              key={n.label}
              type="button"
              onClick={() => setValue((v) => (v.trim() ? v : n.seed))}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur transition hover:border-accent-pink/60 hover:bg-white/10 hover:text-white"
            >
              {n.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          className="neon-wrap relative mt-10 w-full max-w-3xl rounded-2xl bg-black p-1 shadow-[0_30px_80px_-20px_rgba(34,211,238,0.3)]"
        >
          <div className="relative rounded-xl bg-[#0a0a0a]">
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={3}
              aria-label="Describe tu negocio"
              className="w-full resize-none rounded-xl bg-transparent px-5 py-4 text-base text-white placeholder:text-white/30 focus:outline-none"
            />
            {value === "" && !focused ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 px-5 py-4 text-base text-white/50"
              >
                {demo}
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent-pink align-middle" />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-1">
            <button
              type="button"
              onClick={onImprove}
              disabled={!value.trim() || improving}
              aria-label="Mejorar prompt con IA"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/5 px-3 text-xs font-medium text-cyan-200 transition hover:border-cyan-400/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-400/5 disabled:hover:text-cyan-200"
            >
              {improving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {improving ? "Mejorando…" : "Mejorar prompt"}
            </button>
            <Button type="submit" variant="brand" size="md" className="gap-2">
              Crear agente
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-white/40">
          {improveError ? (
            <span className="text-rose-300">{improveError}</span>
          ) : (
            <>Escribe tu idea y pulsa <span className="text-cyan-300">Mejorar prompt</span> — la IA la convierte en un brief útil antes de crear el agente.</>
          )}
        </p>

        <p className="mt-6 text-sm text-white/50">
          7 días gratis — luego <span className="font-semibold text-white">€19.90/mes</span>.
          Cancela cuando quieras.
        </p>
      </div>
    </section>
  );
}
