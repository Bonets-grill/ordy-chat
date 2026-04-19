import { Bot, Calendar, MessageSquare, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

type FeatureItem = {
  icon: typeof Bot;
  title: string;
  copy: string;
  tone: "pink" | "orange" | "purple" | "green" | "cyan" | "amber";
  example?: ReactNode;
};

const TONES: Record<FeatureItem["tone"], string> = {
  pink: "bg-accent-pink/10 text-accent-pink ring-accent-pink/20",
  orange: "bg-accent-orange/10 text-accent-orange ring-accent-orange/20",
  purple: "bg-brand-500/10 text-brand-500 ring-brand-500/20",
  green: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
  cyan: "bg-cyan-500/10 text-cyan-400 ring-cyan-500/20",
  amber: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
};

const FEATURES: FeatureItem[] = [
  {
    icon: Bot,
    tone: "purple",
    title: "Agente con IA real",
    copy: "Claude responde con contexto de tu negocio. Nada de árboles rígidos.",
    example: (
      <div className="rounded-lg bg-white/5 p-3 font-mono text-[11px] leading-relaxed text-white/60 ring-1 ring-white/5">
        <div>intent: <span className="text-accent-pink">reserva</span></div>
        <div>memoria: <span className="text-cyan-400">cliente habitual</span></div>
        <div>respuesta: <span className="text-emerald-400">373ms</span></div>
      </div>
    ),
  },
  {
    icon: MessageSquare,
    tone: "green",
    title: "WhatsApp listo",
    copy: "Conecta Whapi, Meta Cloud API o Twilio. Tu número, tu branding.",
    example: (
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md bg-white/5 px-2 py-1 text-white/70 ring-1 ring-white/10">whapi.cloud</span>
        <span className="rounded-md bg-white/5 px-2 py-1 text-white/70 ring-1 ring-white/10">Meta Cloud</span>
        <span className="rounded-md bg-white/5 px-2 py-1 text-white/70 ring-1 ring-white/10">Twilio</span>
      </div>
    ),
  },
  {
    icon: Calendar,
    tone: "cyan",
    title: "Agenda y vende 24/7",
    copy: "Responde preguntas, toma pedidos, reserva citas sin dormir.",
    example: (
      <div className="rounded-lg bg-white/5 p-3 text-[11px] text-white/60 ring-1 ring-white/5">
        <div className="text-white/80">Mesa 12 · 21:15 · Clara</div>
        <div>2 personas · sin gluten anotado</div>
      </div>
    ),
  },
  {
    icon: Sparkles,
    tone: "pink",
    title: "Setup en 5 minutos",
    copy: "Cuéntanos de tu negocio y generamos el prompt, la memoria y la lógica.",
    example: (
      <div className="flex items-center gap-2 text-[11px] text-white/60">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-pink/20 text-accent-pink">✓</span>
        pegas web → agente listo
      </div>
    ),
  },
  {
    icon: TrendingUp,
    tone: "amber",
    title: "Historial por cliente",
    copy: "Cada conversación queda guardada. Revisa, edita, audita.",
    example: (
      <div className="rounded-lg bg-white/5 p-3 font-mono text-[11px] text-white/60 ring-1 ring-white/5">
        <div>863 conversaciones hoy</div>
        <div className="text-emerald-400">97% resueltas sin humano</div>
      </div>
    ),
  },
  {
    icon: ShieldCheck,
    tone: "orange",
    title: "Tus datos, tu control",
    copy: "Aislamiento por tenant. Credenciales cifradas AES-256.",
    example: (
      <div className="space-y-1 font-mono text-[11px] text-white/60">
        <div>✓ <span className="text-emerald-400">tenant_id</span> aislado</div>
        <div>✓ <span className="text-emerald-400">AES-256-GCM</span></div>
        <div>✓ <span className="text-emerald-400">RLS</span> activa</div>
      </div>
    ),
  },
];

export function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-black py-24">
      <div className="absolute inset-0 grid-backdrop-dark opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Todo en uno
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Todo lo que tu negocio necesita,<br />
            <span className="italic text-white/80">en un solo agente.</span>
          </h2>
          <p className="mt-4 text-lg text-white/60">
            Responde, agenda, vende, escala. Sin contratar a nadie nuevo.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, copy, tone, example }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition hover:bg-white/[0.04]"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-white/5 to-transparent opacity-0 blur-2xl transition group-hover:opacity-100" aria-hidden />
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${TONES[tone]}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-2 text-sm text-white/60">{copy}</p>
              {example ? <div className="mt-5">{example}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
