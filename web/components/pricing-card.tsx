import { Check } from "lucide-react";
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

export function PricingCard() {
  return (
    <section id="pricing" className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
            Un precio. Sin trucos.
          </h2>
          <p className="mt-4 text-lg text-neutral-600">
            Empieza con 7 días gratis. Cancela cuando quieras desde el dashboard.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-md">
          <div className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-[0_20px_60px_-20px_rgba(139,92,246,0.2)]">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-sm font-medium uppercase tracking-wide text-brand-600">Pro</div>
                <div className="mt-1 text-sm text-neutral-500">Todo incluido</div>
              </div>
              <div className="text-right">
                <div className="text-5xl font-semibold tracking-tight text-neutral-900">€19.90</div>
                <div className="text-sm text-neutral-500">/mes</div>
              </div>
            </div>

            <ul className="mt-8 space-y-3">
              {INCLUYE.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-neutral-700">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Check className="h-3 w-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <Button asChild variant="brand" size="lg" className="mt-8 w-full">
              <Link href="/signin?from=/onboarding">Empezar los 7 días gratis</Link>
            </Button>
            <p className="mt-3 text-center text-xs text-neutral-500">
              No pedimos tarjeta durante la prueba.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
