// Demo landing — chat WhatsApp en vivo + grafo de nodos pensando en tiempo real.
// Inspiración: OrdyAgencIA "Un mesero digital, pensando en tiempo real".

"use client";

import { Brain, Database, MessageCircle, Send, SlidersHorizontal, User, Wine, Zap } from "lucide-react";
import * as React from "react";

type Msg = { from: "user" | "bot"; text: string };

const CONVERSATION: Msg[] = [
  { from: "user", text: "Buenas, ¿tienen algo sin gluten para compartir? Somos 2." },
  {
    from: "bot",
    text:
      "Buenas 👋 Claro que sí. Para compartir les recomiendo la burrata con tomate confitado o los tacos de cochinita (ambos sin gluten). ¿Les armo una tabla?",
  },
  { from: "user", text: "La burrata suena bien. Y una copa de blanco seco que maride." },
  { from: "bot", text: "Marido perfecto: un Albariño Rías Baixas 2022, copa 6,50€. ¿Lo añado y una botella de agua?" },
  { from: "user", text: "Sí, con gas. Y reserva la mesa 12 para las 21:15 a nombre de Clara." },
  {
    from: "bot",
    text: "Hecho, Clara ✓ Mesa 12 a las 21:15, 2 personas, alergia: gluten anotada. Les avisaré al camarero.",
  },
];

type NodeDef = {
  id: string;
  label: string;
  sub: string;
  icon: typeof Brain;
  x: number;
  y: number;
  tone: "cyan" | "amber" | "purple" | "green" | "pink" | "blue";
};

const NODES: NodeDef[] = [
  { id: "inbound", label: "WhatsApp", sub: "Inbound", icon: MessageCircle, x: 8, y: 55, tone: "cyan" },
  { id: "memory", label: "Memoria", sub: "Cliente", icon: User, x: 22, y: 82, tone: "blue" },
  { id: "intent", label: "Intent", sub: "Clasifica", icon: SlidersHorizontal, x: 38, y: 32, tone: "purple" },
  { id: "carta", label: "Carta", sub: "Vector DB", icon: Database, x: 62, y: 16, tone: "amber" },
  { id: "maridaje", label: "Maridaje", sub: "Tool", icon: Wine, x: 55, y: 60, tone: "amber" },
  { id: "claude", label: "Claude", sub: "Respuesta", icon: Brain, x: 78, y: 38, tone: "purple" },
  { id: "pos", label: "POS · Reservas", sub: "API", icon: Database, x: 55, y: 90, tone: "amber" },
  { id: "notify", label: "Notificar", sub: "Camarero", icon: Zap, x: 78, y: 78, tone: "pink" },
  { id: "respond", label: "Responder", sub: "Salida", icon: Send, x: 92, y: 55, tone: "green" },
];

const FLOW = [
  ["inbound"],
  ["inbound", "memory"],
  ["memory", "intent"],
  ["intent", "carta"],
  ["carta", "maridaje"],
  ["maridaje", "claude"],
  ["claude", "pos"],
  ["pos", "notify"],
  ["notify", "respond"],
];

const TONE_CLASS: Record<NodeDef["tone"], { bg: string; border: string; glow: string; text: string }> = {
  cyan: { bg: "bg-cyan-500/10", border: "ring-cyan-400/50", glow: "shadow-[0_0_30px_rgba(34,211,238,0.55)]", text: "text-cyan-300" },
  amber: { bg: "bg-amber-500/10", border: "ring-amber-400/50", glow: "shadow-[0_0_30px_rgba(251,191,36,0.5)]", text: "text-amber-300" },
  purple: { bg: "bg-brand-500/10", border: "ring-brand-500/50", glow: "shadow-[0_0_30px_rgba(167,139,250,0.55)]", text: "text-[#c4b5fd]" },
  green: { bg: "bg-emerald-500/10", border: "ring-emerald-400/50", glow: "shadow-[0_0_30px_rgba(74,222,128,0.5)]", text: "text-emerald-300" },
  pink: { bg: "bg-accent-pink/10", border: "ring-accent-pink/50", glow: "shadow-[0_0_30px_rgba(236,72,153,0.5)]", text: "text-accent-pink" },
  blue: { bg: "bg-blue-500/10", border: "ring-blue-400/50", glow: "shadow-[0_0_30px_rgba(96,165,250,0.5)]", text: "text-blue-300" },
};

function useRevealMessages() {
  const [visible, setVisible] = React.useState(1);
  React.useEffect(() => {
    const id = setInterval(() => setVisible((v) => (v >= CONVERSATION.length ? 1 : v + 1)), 2400);
    return () => clearInterval(id);
  }, []);
  return visible;
}

function useActiveNodes() {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % FLOW.length), 1100);
    return () => clearInterval(id);
  }, []);
  return new Set(FLOW[step]);
}

function useLiveMetric(base: number, jitter: number, suffix = "") {
  const [v, setV] = React.useState(base);
  React.useEffect(() => {
    const id = setInterval(() => {
      const next = Math.max(1, Math.round(base + (Math.random() - 0.5) * jitter));
      setV(next);
    }, 1400);
    return () => clearInterval(id);
  }, [base, jitter]);
  return `${v}${suffix}`;
}

export function DemoThinking() {
  const visible = useRevealMessages();
  const active = useActiveNodes();
  const latency = useLiveMetric(393, 80, "ms");
  const tokens = useLiveMetric(162, 40);

  return (
    <section className="relative overflow-hidden bg-black py-24">
      <div className="absolute inset-0 grid-backdrop-dark opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Demo · restaurante parábola
          </p>
          <h2 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Un mesero digital,{" "}
            <span className="italic text-white/80">pensando en tiempo real.</span>
          </h2>
          <p className="mt-4 text-lg text-white/60">
            Cada mensaje dispara un flujo de nodos: intención, memoria, carta, maridajes, POS.
            Míralo pensar.
          </p>
        </div>

        <div className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ChatPanel visible={visible} />
          <GraphPanel active={active} latency={latency} tokens={tokens} />
        </div>
      </div>
    </section>
  );
}

function ChatPanel({ visible }: { visible: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center gap-3 border-b border-white/5 pb-4">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
          P
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Parábola · Mesero</div>
          <div className="flex items-center gap-1.5 text-[11px] text-white/50">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            En línea · responde al instante
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-white/30">WhatsApp</div>
      </div>

      <div className="mt-4 space-y-3 overflow-hidden">
        {CONVERSATION.slice(0, visible).map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-full bg-white/[0.03] px-4 py-2.5 text-xs text-white/40 ring-1 ring-white/5">
        <span>Escribe un mensaje…</span>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.from === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] animate-[fadeSlide_.4s_ease] rounded-2xl rounded-br-md bg-accent-pink/20 px-3 py-2 text-[13px] leading-snug text-white ring-1 ring-accent-pink/25">
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] animate-[fadeSlide_.4s_ease] rounded-2xl rounded-bl-md bg-white/[0.04] px-3 py-2 text-[13px] leading-snug text-white/85 ring-1 ring-white/10">
        {msg.text}
      </div>
    </div>
  );
}

function GraphPanel({
  active,
  latency,
  tokens,
}: {
  active: Set<string>;
  latency: string;
  tokens: string;
}) {
  const edges: Array<[string, string]> = [
    ["inbound", "memory"],
    ["inbound", "intent"],
    ["memory", "intent"],
    ["intent", "carta"],
    ["intent", "maridaje"],
    ["carta", "claude"],
    ["maridaje", "claude"],
    ["claude", "respond"],
    ["maridaje", "pos"],
    ["pos", "notify"],
    ["notify", "respond"],
  ];

  const nodeMap = new Map(NODES.map((n) => [n.id, n]));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-mono text-white/60">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          flow · waiter-v1.2
        </div>
        <div className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-white/50 ring-1 ring-white/10">
          {active.size} / 9 nodos activos
        </div>
      </div>

      <div className="relative mt-6 h-[360px] w-full">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          {edges.map(([a, b]) => {
            const na = nodeMap.get(a)!;
            const nb = nodeMap.get(b)!;
            const isActive = active.has(a) && active.has(b);
            return (
              <line
                key={`${a}-${b}`}
                x1={na.x}
                y1={na.y}
                x2={nb.x}
                y2={nb.y}
                stroke={isActive ? "rgba(236,72,153,0.8)" : "rgba(255,255,255,0.08)"}
                strokeWidth={isActive ? 0.4 : 0.25}
                strokeDasharray={isActive ? "0" : "0.8 0.8"}
              />
            );
          })}
        </svg>

        {NODES.map((n) => (
          <GraphNode key={n.id} node={n} activeNow={active.has(n.id)} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <Metric label="Latencia" value={latency} tone="text-[#c4b5fd]" />
        <Metric label="Tokens/s" value={tokens} tone="text-amber-300" />
        <Metric label="Confianza" value="97%" tone="text-emerald-300" />
        <Metric label="Resueltos hoy" value="863" tone="text-cyan-300" />
      </div>
    </div>
  );
}

function GraphNode({ node, activeNow }: { node: NodeDef; activeNow: boolean }) {
  const t = TONE_CLASS[node.tone];
  const Icon = node.icon;
  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl px-2.5 py-1.5 ring-1 transition-all duration-500 ${t.bg} ${
        activeNow ? `${t.border} ${t.glow}` : "ring-white/10"
      }`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/30 ${activeNow ? t.text : "text-white/50"}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="pr-1 text-[11px] leading-tight">
        <div className={`font-semibold ${activeNow ? "text-white" : "text-white/70"}`}>{node.label}</div>
        <div className="text-[10px] text-white/40">{node.sub}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] px-3 py-2 ring-1 ring-white/5">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className={`mt-1 font-mono text-sm tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
