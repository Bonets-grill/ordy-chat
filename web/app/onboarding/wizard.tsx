"use client";

import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
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
  anthropicKey: string;
  provider: (typeof PROVIDERS)[number]["value"];
  providerCredentials: Record<string, string>;
};

const STEPS = 10;

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
    anthropicKey: "",
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
      case 7: return data.anthropicKey.trim().startsWith("sk-ant-");
      case 8: return !!data.provider;
      case 9:
        if (data.provider === "whapi") return !!data.providerCredentials.token;
        if (data.provider === "meta") return !!data.providerCredentials.access_token && !!data.providerCredentials.phone_number_id;
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
        <Step title="Pega información extra que quieras que sepa" hint="FAQ, menú, precios, políticas… (opcional)">
          <Textarea rows={10} value={data.knowledgeText} onChange={(e) => update("knowledgeText", e.target.value)} placeholder="Copia y pega aquí lo que quieras. El agente tendrá este contexto en cada respuesta." />
        </Step>
      )}

      {step === 7 && (
        <Step title="Tu API key de Anthropic" hint={<>Consíguela en <a className="underline" href="https://platform.anthropic.com/settings/api-keys" target="_blank" rel="noreferrer">platform.anthropic.com</a>. Empieza por sk-ant-.</>}>
          <Input value={data.anthropicKey} onChange={(e) => update("anthropicKey", e.target.value)} placeholder="sk-ant-..." />
          <p className="mt-2 text-xs text-neutral-500">Se guarda cifrada y solo tu agente la usa.</p>
        </Step>
      )}

      {step === 8 && (
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

      {step === 9 && (
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
