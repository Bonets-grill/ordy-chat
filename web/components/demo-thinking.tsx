// Demo interactivo — chat WhatsApp con input real + grafo de nodos que se activa
// en sincronía con el mensaje que se está procesando.
//
// Modos:
//   · auto-play: si el user no ha escrito, cycla 6 mensajes canned con sus flows.
//   · manual: user escribe → se añade mensaje, se infiere el flow por keywords,
//             nodos se iluminan en secuencia, agente responde con un script que
//             matchea la intención detectada.

"use client";

import { Brain, Database, MessageCircle, Send, SlidersHorizontal, User, Wine, Zap } from "lucide-react";
import * as React from "react";

type NodeId =
  | "inbound"
  | "memory"
  | "intent"
  | "carta"
  | "maridaje"
  | "claude"
  | "pos"
  | "notify"
  | "respond";

type Msg = {
  id: string;
  from: "user" | "bot";
  text: string;
  flow: NodeId[];
};

// ─── Flow inference ─────────────────────────────────────────────

function inferFlow(text: string, from: "user" | "bot"): NodeId[] {
  const t = text.toLowerCase();
  if (from === "user") {
    const f: NodeId[] = ["inbound", "memory", "intent"];
    if (/(glut|celi|alerg|lactos|vegan|vegetari|sin\s+(glu|lact|azuc))/.test(t)) f.push("carta");
    if (/(vin|copa|marid|cerveza|blanc|tint|rosad|champ|cava|champagn|bebid)/.test(t)) f.push("maridaje");
    if (/(pido|carta|men[uú]|recomien|entrante|plato|postre|tac|pizza|burra|hamburg)/.test(t)) f.push("carta");
    if (/(reserv|mesa|hora|\d+\s*:\s*\d+|esta\s+noche|mañana|hoy|domin|lunes|martes|sabad|vier)/.test(t)) {
      f.push("pos", "notify");
    }
    f.push("claude", "respond");
    return f;
  }
  // bot messages: Claude + lo que hubiera tocado
  const f: NodeId[] = [];
  if (/(burra|tac|carta|men[uú]|pizza)/.test(t)) f.push("carta");
  if (/(albari|vin|copa|marid|blanco|tint)/.test(t)) f.push("maridaje");
  if (/(reserv|mesa|hecho|anotad|camarero)/.test(t)) f.push("pos", "notify");
  f.push("claude", "respond");
  return f;
}

// ─── Reply generator (scripted, keyword-based) ─────────────────

function generateReply(text: string): string {
  const t = text.toLowerCase();
  if (/(glut|celi|alerg)/.test(t)) {
    return "Sin gluten tenemos: burrata con tomate confitado, tacos de cochinita y tataki de atún. ¿Te preparo una tabla para compartir?";
  }
  if (/(vegan|vegetari)/.test(t)) {
    return "Opciones veganas: tartar de remolacha, hummus de edamame, tacos de jackfruit. Todo sin trazas animales.";
  }
  if (/(vin|copa|marid|blanc|tint)/.test(t)) {
    return "Marido perfecto: Albariño Rías Baixas 2022 para pescados y entrantes (6,50€ copa), Ribera Crianza 2021 para carnes (7€). ¿Cuál te sirvo?";
  }
  if (/(reserv|mesa|hora)/.test(t)) {
    const m = t.match(/(\d{1,2}[:\.]?\d{0,2})/);
    const hora = m ? m[1].replace(".", ":") : "21:15";
    return `Hecho ✓ Mesa para ti confirmada a las ${hora}. Te mando recordatorio 1h antes y aviso al camarero de guardia.`;
  }
  if (/(carta|men[uú]|recomien|plato)/.test(t)) {
    return "Esta noche te recomiendo: entrante → burrata o tataki · principal → solomillo ibérico o merluza · postre → coulant. ¿Te mando la carta completa en PDF?";
  }
  if (/(hola|buenas|buen dia|qué tal)/.test(t)) {
    return "¡Buenas! 👋 Soy el mesero de Parábola. Dime qué buscas: recomendaciones, reservas, menú. Respondo al instante.";
  }
  if (/(precio|cuesta|cu[aá]nto)/.test(t)) {
    return "Menú degustación 48€ · carta individual desde 14€ plato · copas desde 4,50€. ¿Te reservo mesa y te enseño opciones concretas?";
  }
  if (/(horari|abier|cerrad|cuando)/.test(t)) {
    return "Mar-Sáb 13:30-16:30 y 19:30-23:00. Domingos y lunes cerramos. ¿Te agendo mesa para hoy?";
  }
  // fallback
  return "Perfecto, me lo apunto. ¿Quieres que te confirme mesa, te mande la carta o te recomiende algo concreto?";
}

// ─── Canned conversation for auto-play ─────────────────────────

const CANNED: Omit<Msg, "id">[] = [
  {
    from: "user",
    text: "Buenas, ¿tienen algo sin gluten para compartir? Somos 2.",
    flow: ["inbound", "memory", "intent", "carta", "claude", "respond"],
  },
  {
    from: "bot",
    text: "Buenas 👋 Claro que sí. Para compartir les recomiendo la burrata con tomate confitado o los tacos de cochinita (ambos sin gluten). ¿Les armo una tabla?",
    flow: ["carta", "claude", "respond"],
  },
  {
    from: "user",
    text: "La burrata suena bien. Y una copa de blanco seco que maride.",
    flow: ["inbound", "intent", "maridaje", "claude", "respond"],
  },
  {
    from: "bot",
    text: "Marido perfecto: un Albariño Rías Baixas 2022, copa 6,50€. ¿Lo añado y una botella de agua?",
    flow: ["maridaje", "claude", "respond"],
  },
  {
    from: "user",
    text: "Sí, con gas. Y reserva la mesa 12 para las 21:15 a nombre de Clara.",
    flow: ["inbound", "intent", "pos", "notify", "claude", "respond"],
  },
  {
    from: "bot",
    text: "Hecho, Clara ✓ Mesa 12 a las 21:15, 2 personas, alergia: gluten anotada. Les avisaré al camarero.",
    flow: ["pos", "notify", "claude", "respond"],
  },
];

// ─── Node definitions ──────────────────────────────────────────

type NodeDef = {
  id: NodeId;
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

const TONE_CLASS: Record<NodeDef["tone"], { bg: string; border: string; glow: string; text: string }> = {
  cyan: { bg: "bg-cyan-500/10", border: "ring-cyan-400/50", glow: "shadow-[0_0_30px_rgba(34,211,238,0.55)]", text: "text-cyan-300" },
  amber: { bg: "bg-amber-500/10", border: "ring-amber-400/50", glow: "shadow-[0_0_30px_rgba(251,191,36,0.5)]", text: "text-amber-300" },
  purple: { bg: "bg-brand-500/10", border: "ring-brand-500/50", glow: "shadow-[0_0_30px_rgba(167,139,250,0.55)]", text: "text-[#c4b5fd]" },
  green: { bg: "bg-emerald-500/10", border: "ring-emerald-400/50", glow: "shadow-[0_0_30px_rgba(74,222,128,0.5)]", text: "text-emerald-300" },
  pink: { bg: "bg-accent-pink/10", border: "ring-accent-pink/50", glow: "shadow-[0_0_30px_rgba(236,72,153,0.5)]", text: "text-accent-pink" },
  blue: { bg: "bg-blue-500/10", border: "ring-blue-400/50", glow: "shadow-[0_0_30px_rgba(96,165,250,0.5)]", text: "text-blue-300" },
};

// ─── Main component ────────────────────────────────────────────

const STEP_MS = 320; // ms between node activations
const REPLY_DELAY_MS = 1400; // delay before bot responds
const AUTO_NEXT_MS = 2400; // time between canned messages

let msgId = 0;
const nextId = () => String(++msgId);

export function DemoThinking() {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [processing, setProcessing] = React.useState<{ flow: NodeId[]; step: number } | null>(null);
  const [userInteracted, setUserInteracted] = React.useState(false);
  const [input, setInput] = React.useState("");
  const chatRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll chat a última burbuja
  React.useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages.length]);

  // Añadir mensaje + animar su flow
  const pushMessage = React.useCallback((raw: Omit<Msg, "id">) => {
    const m: Msg = { ...raw, id: nextId() };
    setMessages((prev) => [...prev, m]);
    setProcessing({ flow: m.flow, step: 0 });

    // Avanzar pasos del flow
    m.flow.forEach((_, i) => {
      setTimeout(() => {
        setProcessing((cur) => (cur && cur.flow === m.flow ? { flow: m.flow, step: i + 1 } : cur));
      }, STEP_MS * (i + 1));
    });
    // Dim al terminar
    setTimeout(() => {
      setProcessing((cur) => (cur && cur.flow === m.flow ? null : cur));
    }, STEP_MS * (m.flow.length + 1));
  }, []);

  // Auto-play de la conversación canned
  React.useEffect(() => {
    if (userInteracted) return;
    if (messages.length >= CANNED.length) return;
    const delay = messages.length === 0 ? 600 : AUTO_NEXT_MS;
    const id = setTimeout(() => {
      if (!userInteracted) pushMessage(CANNED[messages.length]);
    }, delay);
    return () => clearTimeout(id);
  }, [messages.length, userInteracted, pushMessage]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setUserInteracted(true);
    setInput("");
    const userMsg: Omit<Msg, "id"> = {
      from: "user",
      text,
      flow: inferFlow(text, "user"),
    };
    pushMessage(userMsg);

    // Respuesta del bot tras delay
    setTimeout(() => {
      const replyText = generateReply(text);
      pushMessage({
        from: "bot",
        text: replyText,
        flow: inferFlow(replyText, "bot"),
      });
    }, REPLY_DELAY_MS + STEP_MS * userMsg.flow.length);
  }

  const active = React.useMemo(() => {
    if (!processing) return new Set<NodeId>();
    return new Set(processing.flow.slice(0, processing.step));
  }, [processing]);

  return (
    <section className="relative overflow-hidden bg-black py-16 sm:py-24">
      <div className="absolute inset-0 grid-backdrop-dark opacity-30" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            Demo · restaurante parábola
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            Un mesero digital,{" "}
            <span className="italic text-white/80">pensando en tiempo real.</span>
          </h2>
          <p className="mt-4 text-base text-white/60 sm:text-lg">
            Escribe como un cliente. El agente responde y los nodos se iluminan con lo
            que está pensando en cada mensaje.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:mt-14 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <ChatPanel
            messages={messages}
            input={input}
            setInput={setInput}
            onSubmit={onSubmit}
            chatRef={chatRef}
            thinking={processing !== null && messages.length > 0 && messages[messages.length - 1].from === "user"}
          />
          <GraphPanel active={active} />
        </div>
      </div>
    </section>
  );
}

// ─── Chat panel ────────────────────────────────────────────────

function ChatPanel({
  messages,
  input,
  setInput,
  onSubmit,
  chatRef,
  thinking,
}: {
  messages: Msg[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  chatRef: React.RefObject<HTMLDivElement | null>;
  thinking: boolean;
}) {
  return (
    <div className="flex h-[480px] flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:h-[560px] sm:p-5">
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

      <div ref={chatRef} className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
        {thinking ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
              <TypingDot delay={0} />
              <TypingDot delay={150} />
              <TypingDot delay={300} />
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe como si fueras cliente…"
          className="flex-1 rounded-full bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/30 ring-1 ring-white/10 focus:outline-none focus:ring-accent-pink/40"
          aria-label="Escribe un mensaje"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-accent-pink text-white transition hover:opacity-90 disabled:opacity-40"
          aria-label="Enviar"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      <p className="mt-2 text-center text-[10px] text-white/30">
        Demo en vivo · sin backend, respuestas scripted por keywords
      </p>
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

function TypingDot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

// ─── Graph panel ───────────────────────────────────────────────

function GraphPanel({ active }: { active: Set<NodeId> }) {
  const edges: Array<[NodeId, NodeId]> = [
    ["inbound", "memory"],
    ["inbound", "intent"],
    ["memory", "intent"],
    ["intent", "carta"],
    ["intent", "maridaje"],
    ["intent", "pos"],
    ["carta", "claude"],
    ["maridaje", "claude"],
    ["claude", "respond"],
    ["maridaje", "pos"],
    ["pos", "notify"],
    ["notify", "respond"],
    ["claude", "pos"],
  ];

  const nodeMap = new Map(NODES.map((n) => [n.id, n]));
  const latency = useLiveMetric(393, 80, "ms", active.size);
  const tokens = useLiveMetric(162, 40, "", active.size);

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:h-[560px] sm:p-5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-mono text-white/60">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          flow · waiter-v1.2
        </div>
        <div className="rounded-md bg-white/[0.04] px-2 py-1 font-mono text-white/50 ring-1 ring-white/10">
          {active.size} / 9 nodos activos
        </div>
      </div>

      {/* Móvil: lista vertical de nodos — el grafo absoluto no cabe y se amontona. */}
      <div className="mt-4 flex flex-col gap-1.5 sm:hidden">
        {NODES.map((n) => (
          <MobileNodeRow key={n.id} node={n} activeNow={active.has(n.id)} />
        ))}
      </div>

      {/* Desktop: grafo SVG con nodos absolutos sobre viewBox 100x100. */}
      <div className="relative mt-6 hidden flex-1 sm:block">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
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
                stroke={isActive ? "rgba(34,211,238,0.8)" : "rgba(255,255,255,0.08)"}
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

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Latencia" value={latency} tone="text-cyan-300" />
        <Metric label="Tokens/s" value={tokens} tone="text-amber-300" />
        <Metric label="Confianza" value="97%" tone="text-emerald-300" />
        <Metric label="Resueltos hoy" value="863" tone="text-cyan-300" />
      </div>
    </div>
  );
}

function MobileNodeRow({ node, activeNow }: { node: NodeDef; activeNow: boolean }) {
  const t = TONE_CLASS[node.tone];
  const Icon = node.icon;
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-3 py-1.5 ring-1 transition-all duration-300 ${t.bg} ${
        activeNow ? `${t.border} ${t.glow}` : "ring-white/10"
      }`}
    >
      <span
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/30 ${activeNow ? t.text : "text-white/50"}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-[11px]">
        <span className={`truncate font-semibold ${activeNow ? "text-white" : "text-white/70"}`}>{node.label}</span>
        <span className="shrink-0 text-[10px] text-white/40">{node.sub}</span>
      </div>
    </div>
  );
}

function GraphNode({ node, activeNow }: { node: NodeDef; activeNow: boolean }) {
  const t = TONE_CLASS[node.tone];
  const Icon = node.icon;
  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-xl px-1.5 py-1 ring-1 transition-all duration-300 sm:gap-2 sm:px-2.5 sm:py-1.5 ${t.bg} ${
        activeNow ? `${t.border} ${t.glow} scale-105` : "ring-white/10"
      }`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/30 sm:h-6 sm:w-6 ${activeNow ? t.text : "text-white/50"}`}
      >
        <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
      </span>
      <div className="pr-1 text-[10px] leading-tight sm:text-[11px]">
        <div className={`font-semibold ${activeNow ? "text-white" : "text-white/70"}`}>{node.label}</div>
        <div className="hidden text-[10px] text-white/40 sm:block">{node.sub}</div>
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

// Las métricas responden a la actividad del grafo: más nodos activos = más tokens/s.
function useLiveMetric(base: number, jitter: number, suffix: string, activeCount: number) {
  const [v, setV] = React.useState(base);
  React.useEffect(() => {
    const id = setInterval(() => {
      const boost = activeCount > 0 ? activeCount * (jitter / 4) : 0;
      const next = Math.max(1, Math.round(base + boost + (Math.random() - 0.5) * jitter));
      setV(next);
    }, 900);
    return () => clearInterval(id);
  }, [base, jitter, activeCount]);
  return `${v}${suffix}`;
}
