"use client";

import { ChevronLeft, ChevronRight, Globe, PencilLine, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TONES = [
  { value: "professional", label: "Profesional", desc: "Formal, tratamiento de usted." },
  { value: "friendly", label: "Amigable", desc: "Casual, tuteo, cercano." },
  { value: "sales", label: "Vendedor", desc: "Persuasivo, enfocado a cerrar." },
  { value: "empathetic", label: "Empático", desc: "Valida emociones antes de resolver." },
] as const;

const USE_CASES = [
  "Responder preguntas frecuentes",
  "Agendar citas o reservaciones",
  "Calificar leads y ventas",
  "Tomar pedidos",
  "Soporte post-venta",
];

const PROVIDERS = [
  { value: "whapi", label: "Whapi.cloud", tag: "Recomendado", desc: "El más fácil, sandbox gratis." },
  { value: "meta", label: "Meta Cloud API", tag: "Oficial", desc: "Requiere cuenta Business verificada." },
  { value: "twilio", label: "Twilio", tag: "Robusto", desc: "Confiable pero más caro." },
] as const;

type FormData = {
  businessName: string;
  businessDescription: string;
  useCases: string[];
  agentName: string;
  tone: (typeof TONES)[number]["value"];
  schedule: string;
  knowledgeText: string;
  provider: (typeof PROVIDERS)[number]["value"];
  providerCredentials: Record<string, string>;
};

const STEPS = 9;

export function OnboardingWizard({ seed }: { seed: string }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<FormData>({
    businessName: "",
    businessDescription: seed || "",
    useCases: [],
    agentName: "",
    tone: "friendly",
    schedule: "Lunes a Viernes 9:00 - 18:00",
    knowledgeText: "",
    provider: "whapi",
    providerCredentials: {},
  });

  function update<K extends keyof FormData>(k: K, v: FormData[K]) {
    setData((d) => ({ ...d, [k]: v }));
  }

  function toggleUseCase(v: string) {
    setData((d) =>
      d.useCases.includes(v)
        ? { ...d, useCases: d.useCases.filter((x) => x !== v) }
        : { ...d, useCases: [...d.useCases, v] },
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      setError((await r.json().catch(() => ({ error: "Error inesperado" }))).error ?? "Error");
      setSubmitting(false);
      return;
    }
    router.push("/dashboard");
  }

  const canNext = (() => {
    switch (step) {
      case 0: return data.businessName.trim().length >= 2;
      case 1: return data.businessDescription.trim().length >= 10;
      case 2: return data.useCases.length > 0;
      case 3: return data.agentName.trim().length >= 2;
      case 4: return !!data.tone;
      case 5: return data.schedule.trim().length >= 3;
      case 6: return true;
      case 7: return !!data.provider;
      case 8:
        if (data.provider === "whapi") return !!data.providerCredentials.token;
        if (data.provider === "meta") return !!data.providerCredentials.access_token && !!data.providerCredentials.phone_number_id && !!data.providerCredentials.app_secret;
        if (data.provider === "twilio") return !!data.providerCredentials.account_sid && !!data.providerCredentials.auth_token && !!data.providerCredentials.phone_number;
        return false;
      default: return false;
    }
  })();

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <Badge tone="muted">Paso {step + 1} de {STEPS}</Badge>
        <div className="flex items-center gap-2">
          {Array.from({ length: STEPS }).map((_, i) => (
            <span key={i} className={`h-1.5 w-6 rounded-full ${i <= step ? "bg-brand-600" : "bg-neutral-200"}`} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <Step title="¿Cómo se llama tu negocio?" hint="Ej: Cafetería El Buen Sabor">
          <Input autoFocus value={data.businessName} onChange={(e) => update("businessName", e.target.value)} placeholder="Nombre del negocio" />
        </Step>
      )}

      {step === 1 && (
        <Step title="Cuéntanos a qué se dedica" hint="Cuanto más detalle, mejor será el agente.">
          <Textarea rows={6} value={data.businessDescription} onChange={(e) => update("businessDescription", e.target.value)} placeholder="Qué vendes, qué servicios ofreces, quiénes son tus clientes…" />
        </Step>
      )}

      {step === 2 && (
        <Step title="¿Para qué vas a usar el agente?" hint="Selecciona los que apliquen.">
          <div className="grid gap-2 sm:grid-cols-2">
            {USE_CASES.map((uc) => (
              <button
                key={uc}
                type="button"
                onClick={() => toggleUseCase(uc)}
                className={`rounded-lg border px-4 py-3 text-left text-sm ${data.useCases.includes(uc) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}
              >
                {uc}
              </button>
            ))}
          </div>
        </Step>
      )}

      {step === 3 && (
        <Step title="¿Cómo se llama tu agente?" hint="Es el nombre que verán tus clientes. Ej: Sofía, Ana, Soporte Acme.">
          <Input autoFocus value={data.agentName} onChange={(e) => update("agentName", e.target.value)} placeholder="Nombre del agente" />
        </Step>
      )}

      {step === 4 && (
        <Step title="¿Qué tono debe usar?" hint="Se aplicará a cada respuesta.">
          <div className="grid gap-2">
            {TONES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => update("tone", t.value)}
                className={`rounded-lg border p-4 text-left ${data.tone === t.value ? "border-brand-600 bg-brand-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
              >
                <div className="font-medium text-neutral-900">{t.label}</div>
                <div className="text-sm text-neutral-500">{t.desc}</div>
              </button>
            ))}
          </div>
        </Step>
      )}

      {step === 5 && (
        <Step title="¿Cuál es tu horario de atención?" hint="El agente avisa fuera de horario.">
          <Input value={data.schedule} onChange={(e) => update("schedule", e.target.value)} placeholder="Lunes a Viernes 9:00 - 18:00" />
        </Step>
      )}

      {step === 6 && (
        <KnowledgeStep
          value={data.knowledgeText}
          onChange={(v) => update("knowledgeText", v)}
        />
      )}

      {step === 7 && (
        <Step title="¿Qué proveedor de WhatsApp vas a conectar?" hint="Cualquiera sirve. Whapi es el más rápido para empezar.">
          <div className="grid gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => update("provider", p.value)}
                className={`rounded-lg border p-4 text-left ${data.provider === p.value ? "border-brand-600 bg-brand-50" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-neutral-900">{p.label}</span>
                  <Badge tone="new">{p.tag}</Badge>
                </div>
                <div className="mt-1 text-sm text-neutral-500">{p.desc}</div>
              </button>
            ))}
          </div>
        </Step>
      )}

      {step === 8 && (
        <Step title="Pega las credenciales del proveedor" hint="Se cifran antes de guardarse.">
          {data.provider === "whapi" && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-700">Whapi Token</label>
              <Input
                value={data.providerCredentials.token ?? ""}
                onChange={(e) => update("providerCredentials", { ...data.providerCredentials, token: e.target.value })}
                placeholder="eyJ..."
              />
            </div>
          )}
          {data.provider === "meta" && (
            <div className="space-y-3">
              <Field label="Meta Access Token" value={data.providerCredentials.access_token ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, access_token: v })} />
              <Field label="Phone Number ID" value={data.providerCredentials.phone_number_id ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, phone_number_id: v })} />
              <Field label="Verify Token (inventa uno)" value={data.providerCredentials.verify_token ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, verify_token: v })} />
              <Field label="App Secret (de tu app Meta Developer)" value={data.providerCredentials.app_secret ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, app_secret: v })} />
              <p className="text-xs text-neutral-500">El App Secret lo encuentras en Meta Developers → tu app → Settings → Basic. Se usa para validar que los webhooks son legítimos.</p>
            </div>
          )}
          {data.provider === "twilio" && (
            <div className="space-y-3">
              <Field label="Account SID" value={data.providerCredentials.account_sid ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, account_sid: v })} />
              <Field label="Auth Token" value={data.providerCredentials.auth_token ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, auth_token: v })} />
              <Field label="Número WhatsApp Twilio" value={data.providerCredentials.phone_number ?? ""} onChange={(v) => update("providerCredentials", { ...data.providerCredentials, phone_number: v })} />
            </div>
          )}
        </Step>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submitting}>
          <ChevronLeft className="h-4 w-4" /> Atrás
        </Button>

        {step < STEPS - 1 ? (
          <Button variant="brand" onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext}>
            Siguiente <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="brand" onClick={submit} disabled={!canNext || submitting}>
            {submitting ? "Creando tu agente…" : <><Sparkles className="h-4 w-4" /> Crear agente</>}
          </Button>
        )}
      </div>
    </div>
  );
}

function Step({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">{title}</h2>
        {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Paso 7 — Knowledge: dos modos (scrape por URL o manual)
// ─────────────────────────────────────────────────────────────

type ScrapeState =
  | { phase: "idle" }
  | { phase: "running"; url: string }
  | { phase: "done"; url: string; pages: number; ms: number }
  | { phase: "error"; url: string; message: string };

function KnowledgeStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = React.useState<"web" | "manual">(value ? "manual" : "web");
  const [url, setUrl] = React.useState("");
  const [state, setState] = React.useState<ScrapeState>({ phase: "idle" });

  async function onScrape() {
    if (!url.trim()) return;
    setState({ phase: "running", url });
    const r = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      setState({ phase: "error", url, message: data.error ?? "Error desconocido" });
      return;
    }
    onChange(data.text as string);
    setState({ phase: "done", url, pages: data.pages as number, ms: data.durationMs as number });
  }

  if (mode === "web") {
    return (
      <Step
        title="Conecta tu web y lo extraemos todo"
        hint="Productos, precios, horarios, contacto, alérgenos… en 10–30 segundos."
      >
        <div className="space-y-5">
          <div className="neon-wrap relative rounded-2xl bg-white p-1.5 shadow-[0_16px_50px_-20px_rgba(139,92,246,0.35)]">
            <div className="flex items-center gap-2 rounded-xl bg-white p-1">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Globe className="h-4 w-4" />
              </span>
              <input
                type="url"
                autoFocus
                placeholder="https://mirestaurante.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={state.phase === "running"}
                className="flex-1 border-0 bg-transparent text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-0"
              />
              <Button
                variant="brand"
                onClick={onScrape}
                disabled={state.phase === "running" || !url.trim()}
                className="gap-2"
              >
                {state.phase === "running" ? (
                  <><Spinner /> Escaneando…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Escanear</>
                )}
              </Button>
            </div>
          </div>

          {state.phase === "running" && <ProgressCard url={state.url} />}

          {state.phase === "error" && (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <span className="font-semibold">✗</span>
              <div>
                <div className="font-medium">No pude escanear la web</div>
                <div className="mt-0.5 font-mono text-xs opacity-80">{state.message}</div>
              </div>
            </div>
          )}

          {state.phase === "done" && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 font-semibold">✓</span>
              <div>
                <div className="font-medium">{state.pages} páginas escaneadas en {(state.ms / 1000).toFixed(1)}s</div>
                <div className="text-xs text-emerald-600">Revisa abajo y edita lo que quieras antes de continuar.</div>
              </div>
            </div>
          )}

          {(state.phase === "done" || value) && (
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700">
                Contenido del agente
                <span className="ml-2 text-xs font-normal text-neutral-400">editable</span>
              </label>
              <Textarea
                rows={12}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={() => setMode("manual")} className="text-sm text-neutral-500 hover:text-neutral-900">
              <PencilLine className="mr-1.5 inline h-3.5 w-3.5" />
              Prefiero escribirlo manualmente
            </button>
            <button type="button" onClick={() => onChange("")} className="text-xs text-neutral-400 hover:text-neutral-600">
              omitir este paso
            </button>
          </div>
        </div>
      </Step>
    );
  }

  return (
    <Step
      title="Pega la información del negocio"
      hint="FAQs, menú, precios, políticas, horario… lo que quieras que el agente sepa."
    >
      <div className="space-y-3">
        <Textarea
          rows={14}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Copia y pega textos, menús, precios… El agente tendrá este contexto en cada respuesta."
          className="font-mono text-xs"
          autoFocus
        />
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setMode("web")} className="text-sm text-brand-600 hover:text-brand-700">
            <Globe className="mr-1.5 inline h-3.5 w-3.5" />
            ¿Prefieres escanear tu web?
          </button>
          <button type="button" onClick={() => onChange("")} className="text-xs text-neutral-400 hover:text-neutral-600">
            omitir este paso
          </button>
        </div>
      </div>
    </Step>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" opacity="0.3" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function ProgressCard({ url }: { url: string }) {
  const steps = React.useMemo(() => [
    "Cargando la página principal",
    "Descubriendo productos y categorías",
    "Leyendo precios y alérgenos",
    "Consolidando la información",
  ], []);
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % steps.length), 2500);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5">
      <div className="flex items-center gap-3 text-sm text-brand-700">
        <Spinner />
        <div className="min-w-0">
          <div className="font-medium">{steps[i]}…</div>
          <div className="mt-0.5 truncate text-xs text-brand-600/80">{url}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-100">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-brand-500 to-accent-pink" />
      </div>
    </div>
  );
}
