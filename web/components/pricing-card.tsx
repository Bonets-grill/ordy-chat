import { Check, Globe, Monitor, ReceiptText, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";

const INCLUYE = [
  "IA de última generación incluida — sin API keys ni complicaciones",
  "1 agente de WhatsApp personalizado para tu negocio",
  "Conexión Whapi, Meta Cloud API o Twilio",
  "Historial ilimitado por cliente",
  "Edita el prompt cuando quieras",
  "Dashboard de conversaciones en vivo",
  "Soporte por email",
];

type AddOn = {
  icon: typeof ShoppingCart;
  title: string;
  price: string;
  cadence: string;
  copy: string;
  tone: "pink" | "cyan" | "amber" | "green";
  features: string[];
};

const TONE_RING: Record<AddOn["tone"], string> = {
  pink: "bg-accent-pink/10 text-accent-pink ring-accent-pink/20",
  cyan: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20",
  amber: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
  green: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
};

const ADD_ONS: AddOn[] = [
  {
    icon: ShoppingCart,
    tone: "pink",
    title: "Agente de Pedidos",
    price: "+€9.90",
    cadence: "/mes",
    copy: "Un segundo agente especializado en cerrar pedidos y reenviarlos al WhatsApp del dueño.",
    features: [
      "Toma el pedido completo por chat",
      "Envía resumen al WhatsApp del negocio",
      "Funciona junto al agente base",
    ],
  },
  {
    icon: Monitor,
    tone: "cyan",
    title: "KDS · Pantalla de cocina",
    price: "+€9.90",
    cadence: "/mes",
    copy: "Pantalla en tiempo real donde llegan pedidos y reservas. Sin apps extra.",
    features: [
      "Cola de pedidos en vivo",
      "Reservas con hora y comensales",
      "Marcado listo / servido",
    ],
  },
  {
    icon: ReceiptText,
    tone: "amber",
    title: "POS + reportes",
    price: "+€19.90",
    cadence: "/mes",
    copy: "Ventas, estadísticas diarias y por turno. Cierre de caja enviado por email o WhatsApp.",
    features: [
      "Reporte por turno y por día",
      "Envío automático a email / WhatsApp",
      "Exporta CSV cuando quieras",
    ],
  },
];

export function PricingCard() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-black py-24">
      <div className="absolute inset-0 grid-backdrop-dark opacity-25" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[700px] -translate-x-1/2 hero-glow-dark opacity-60" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Precio
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Un precio base. <span className="italic text-white/80">Crece con add-ons.</span>
          </h2>
          <p className="mt-4 text-lg text-white/60">
            Empieza con 7 días gratis. Cancela cuando quieras desde el dashboard.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-md">
          <div className="neon-wrap relative rounded-3xl">
            <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-8">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-pink">
                    Base
                  </div>
                  <div className="mt-1 text-sm text-white/50">Incluye todo lo esencial</div>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-semibold tracking-tight text-white">€19.90</div>
                  <div className="text-sm text-white/50">/mes</div>
                </div>
              </div>

              <ul className="mt-8 space-y-3">
                {INCLUYE.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-white/75">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-pink/15 text-accent-pink ring-1 ring-accent-pink/30">
                      <Check className="h-3 w-3" />
                    </span>
                    {item}
                  </li>
                ))}
                <li className="flex items-start gap-3 text-sm text-white/75">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
                    <Globe className="h-3 w-3" />
                  </span>
                  <span>
                    <span className="font-medium text-white">Gratis:</span> página web con webchat
                    conectado al mismo agente.
                  </span>
                </li>
              </ul>

              <Button asChild variant="brand" size="lg" className="mt-8 w-full">
                <Link href="/signin?from=/onboarding">Empezar los 7 días gratis</Link>
              </Button>
              <p className="mt-3 text-center text-xs text-white/40">
                No pedimos tarjeta durante la prueba.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-20">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
              Add-ons opcionales
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Amplía lo que hace tu agente,{" "}
              <span className="italic text-white/80">cuando lo necesites.</span>
            </h3>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADD_ONS.map(({ icon: Icon, title, price, cadence, copy, tone, features }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition hover:bg-white/[0.04]"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-white/5 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100" aria-hidden />
                <div className="flex items-start justify-between">
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${TONE_RING[tone]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold text-white">{price}</div>
                    <div className="text-xs text-white/40">{cadence}</div>
                  </div>
                </div>
                <h4 className="mt-4 text-lg font-semibold tracking-tight text-white">{title}</h4>
                <p className="mt-2 text-sm text-white/60">{copy}</p>
                <ul className="mt-5 space-y-2 text-sm text-white/60">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
