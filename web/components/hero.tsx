// Landing hero al estilo Softr — input grande "describe tu negocio" + chips de nichos.

"use client";

import { Sparkles, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const NICHOS = [
  "Restaurante",
  "Clínica dental",
  "Estética",
  "Inmobiliaria",
  "Tienda online",
  "Academia",
  "Gimnasio",
  "Abogados",
  "Consultoría",
  "Barbería",
];

const PLACEHOLDERS = [
  "Mi restaurante vende pizza artesanal en Madrid…",
  "Clínica dental en Valencia, quiero que agende citas…",
  "Tengo una barbería y quiero tomar reservas por WhatsApp…",
  "Vendo cursos online y necesito atender leads 24/7…",
];

export function Hero() {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [placeholderIdx, setPlaceholderIdx] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length), 3500);
    return () => clearInterval(id);
  }, []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    const qs = text ? `?seed=${encodeURIComponent(text)}` : "";
    router.push(`/signin${qs ? `?from=/onboarding${qs}` : "?from=/onboarding"}`);
  }

  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 grid-backdrop opacity-60" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 hero-glow" aria-hidden />

      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pt-14 pb-24 sm:pt-20 md:pt-28">
        <Link
          href="/pricing"
          className="mb-8 inline-flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-neutral-800"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Nuevo · La primera plataforma de agentes de WhatsApp para cualquier nicho
        </Link>

        <h1 className="max-w-3xl text-center text-5xl font-semibold tracking-tight text-neutral-900 sm:text-6xl md:text-7xl">
          Tu agente de WhatsApp con IA — <br className="hidden sm:inline" />
          <span className="bg-gradient-to-r from-brand-600 via-accent-pink to-accent-orange bg-clip-text text-transparent">
            que de verdad vende
          </span>
        </h1>

        <p className="mt-6 max-w-2xl text-center text-lg text-neutral-600">
          Configura tu asistente en 5 minutos. Atiende, agenda, vende y responde 24/7.
          Funciona para cualquier negocio — desde una cafetería hasta una clínica.
        </p>

        <p className="mt-5 text-sm font-medium text-neutral-500">Creado por negocios que usan:</p>
        <div className="mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
          {NICHOS.map((n) => (
            <Badge key={n} tone="muted" className="bg-white/80 px-3 py-1 text-neutral-700 shadow-sm">
              {n}
            </Badge>
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          className="relative mt-10 w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white p-1 shadow-[0_8px_40px_-8px_rgba(139,92,246,0.25)] ring-1 ring-brand-500/10"
        >
          <div className="absolute -inset-px -z-10 rounded-2xl bg-gradient-to-r from-accent-pink/40 via-brand-500/30 to-accent-orange/40 opacity-70 blur-sm" aria-hidden />

          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            placeholder={PLACEHOLDERS[placeholderIdx]}
            className="w-full resize-none rounded-xl bg-white px-5 py-4 text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
          />

          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-xs text-neutral-500">
                Cuéntame de tu negocio y creo el agente
              </span>
            </div>
            <Button type="submit" variant="brand" size="md" className="gap-2">
              Crear agente
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>

        <p className="mt-6 text-sm text-neutral-500">
          7 días gratis — luego <span className="font-semibold text-neutral-900">€19.90/mes</span>.
          Cancela cuando quieras.
        </p>
      </div>
    </section>
  );
}
