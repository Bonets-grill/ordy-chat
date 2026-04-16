import { Bot, Calendar, MessageSquare, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

const FEATURES = [
  {
    icon: Bot,
    title: "Agente con IA real",
    copy: "Claude responde con contexto de tu negocio. Nada de árboles rígidos.",
  },
  {
    icon: MessageSquare,
    title: "WhatsApp listo",
    copy: "Conecta Whapi, Meta o Twilio. Tu número, tu branding.",
  },
  {
    icon: Calendar,
    title: "Agenda y vende 24/7",
    copy: "Responde preguntas, toma pedidos, reserva citas sin dormir.",
  },
  {
    icon: Sparkles,
    title: "Setup en 5 minutos",
    copy: "Cuéntanos de tu negocio y generamos el prompt, la memoria y la lógica.",
  },
  {
    icon: TrendingUp,
    title: "Historial por cliente",
    copy: "Cada conversación queda guardada. Revisa, edita, auditás.",
  },
  {
    icon: ShieldCheck,
    title: "Tus datos, tu control",
    copy: "Aislamiento por tenant. Credenciales cifradas AES-256.",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-surface-subtle py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
            Todo lo que tu negocio necesita,<br />
            en un solo agente
          </h2>
          <p className="mt-4 text-lg text-neutral-600">
            Responde, agenda, vende, escala. Sin contratar a nadie nuevo.
          </p>
        </div>
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, copy }) => (
            <div key={title} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-neutral-900">{title}</h3>
              <p className="mt-2 text-sm text-neutral-600">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
