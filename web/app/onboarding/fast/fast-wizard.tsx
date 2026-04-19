"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

type Conflicto = {
  campo: string;
  valores: Array<{ origen: string; valor: unknown }>;
};

type JobResultJson = {
  canonicos?: Record<string, unknown>;
  conflictos?: Conflicto[];
};

type JobStatus =
  | "pending"
  | "scraping"
  | "sources_ready"
  | "ready"
  | "confirming"
  | "done"
  | "failed";

type StatusResponse = {
  status: JobStatus;
  result_json: JobResultJson | null;
  error: string | null;
};

type WizardState =
  | { phase: "consent" }
  | { phase: "input" }
  | { phase: "scraping"; jobId: string; startedAt: number }
  | { phase: "resolving"; jobId: string; result: JobResultJson }
  | {
      phase: "provider";
      jobId: string;
      canonicos: Record<string, unknown>;
      resoluciones: Record<string, unknown>;
    }
  | { phase: "qr"; slug: string }
  | { phase: "failed"; error: string; jobId?: string };

const TONES = [
  { value: "friendly", label: "Amigable", desc: "Casual, tuteo." },
  { value: "professional", label: "Profesional", desc: "Formal, tratamiento de usted." },
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

const POLL_INTERVAL_MS = 2000;
const SCRAPE_TIMEOUT_MS = 45_000;

// ─────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────

export function FastWizard({ resumeJobId }: { resumeJobId?: string } = {}) {
  const router = useRouter();
  const [state, setState] = React.useState<WizardState>(
    resumeJobId
      ? { phase: "scraping", jobId: resumeJobId, startedAt: Date.now() }
      : { phase: "consent" },
  );
  const [error, setError] = React.useState<string | null>(null);

  // El subtítulo promete que el sistema "scrapea y pregunta solo si hay dudas".
  // Solo es cierto en las fases previas al scrape (consent + input). Una vez
  // que estamos scrapeando, resolviendo o cayó al fallback manual, el promise
  // es engañoso — cada fase ya tiene su propio copy dentro de la card.
  const showPromise = state.phase === "consent" || state.phase === "input";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Configurar tu asistente</h1>
        {showPromise ? (
          <p className="mt-2 text-sm text-neutral-600">
            Pega 1-3 URLs y el sistema scrapea, fusiona y pregunta solo si hay dudas.
          </p>
        ) : null}
      </header>

      {error ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {state.phase === "consent" ? (
        <ConsentGate onAccept={() => setState({ phase: "input" })} />
      ) : null}
      {state.phase === "input" ? (
        <InputStep onStart={(jobId) => setState({ phase: "scraping", jobId, startedAt: Date.now() })} onError={setError} />
      ) : null}
      {state.phase === "scraping" ? (
        <ScrapingStep
          jobId={state.jobId}
          startedAt={state.startedAt}
          onReady={(result) => setState({ phase: "resolving", jobId: state.jobId, result })}
          onFailed={(err) => setState({ phase: "failed", error: err, jobId: state.jobId })}
        />
      ) : null}
      {state.phase === "resolving" ? (
        <ResolvingStep
          result={state.result}
          onResolve={(resoluciones) =>
            setState({
              phase: "provider",
              jobId: state.jobId,
              canonicos: state.result.canonicos ?? {},
              resoluciones,
            })
          }
        />
      ) : null}
      {state.phase === "provider" ? (
        <ProviderStep
          jobId={state.jobId}
          canonicos={state.canonicos}
          resoluciones={state.resoluciones}
          onConfirmed={(slug) => setState({ phase: "qr", slug })}
          onError={setError}
        />
      ) : null}
      {state.phase === "qr" ? <QRStep slug={state.slug} onDone={() => router.push("/dashboard")} /> : null}
      {state.phase === "failed" ? (
        <FailedStep
          error={state.error}
          onRetry={() => setState({ phase: "input" })}
          onLegacy={() => router.push("/onboarding?legacy=1")}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase CONSENT — checkbox legal obligatorio
// ─────────────────────────────────────────────────────────────

function ConsentGate({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = React.useState(false);
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Antes de empezar</h2>
      <p className="mt-2 text-sm text-neutral-700">
        Para acelerar la configuración, el sistema consulta las URLs públicas que indicas
        (tu web, Google Business o TripAdvisor) y extrae datos del negocio.
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-neutral-900"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>
          Confirmo que soy el propietario del negocio o tengo autorización expresa para
          configurarlo, y autorizo a Ordy Chat a consultar las URLs que proporcione para
          el onboarding.
          <span className="mt-1 block text-xs text-neutral-500">
            Este consentimiento queda registrado con fecha e IP como evidencia.
          </span>
        </span>
      </label>
      <div className="mt-6 flex justify-end">
        <Button disabled={!checked} onClick={onAccept} variant="brand" size="lg">
          Continuar
        </Button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase INPUT — URLs
// ─────────────────────────────────────────────────────────────

function InputStep({
  onStart,
  onError,
}: {
  onStart: (jobId: string) => void;
  onError: (msg: string) => void;
}) {
  const [website, setWebsite] = React.useState("");
  const [google, setGoogle] = React.useState("");
  const [tripadvisor, setTripadvisor] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const hasAtLeastOne = website.trim() || google.trim() || tripadvisor.trim();

  async function submit() {
    setSubmitting(true);
    onError("");
    try {
      const urls: Record<string, string> = {};
      if (website.trim()) urls.website = website.trim();
      if (google.trim()) urls.google = google.trim();
      if (tripadvisor.trim()) urls.tripadvisor = tripadvisor.trim();

      const r = await fetch("/api/onboarding/fast/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, consent_accepted: true }),
      });
      const data = await r.json();
      if (!r.ok) {
        onError(data?.error ?? `Error ${r.status}`);
        return;
      }
      onStart(data.job_id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">¿Dónde está tu negocio online?</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Al menos una URL es necesaria. Cuantas más añadas, más rico queda el perfil.
      </p>

      <div className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="website">Web</Label>
          <Input
            id="website"
            type="url"
            placeholder="https://tunegocio.es"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="google">Google Business / Maps</Label>
          <Input
            id="google"
            type="url"
            placeholder="https://www.google.com/maps/place/..."
            value={google}
            onChange={(e) => setGoogle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tripadvisor">TripAdvisor</Label>
          <Input
            id="tripadvisor"
            type="url"
            placeholder="https://www.tripadvisor.es/Restaurant_Review-..."
            value={tripadvisor}
            onChange={(e) => setTripadvisor(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          disabled={!hasAtLeastOne || submitting}
          onClick={submit}
          variant="brand"
          size="lg"
        >
          {submitting ? "Enviando…" : "Escanear"}
        </Button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase SCRAPING — polling al /status/[id]
// ─────────────────────────────────────────────────────────────

function ScrapingStep({
  jobId,
  startedAt,
  onReady,
  onFailed,
}: {
  jobId: string;
  startedAt: number;
  onReady: (result: JobResultJson) => void;
  onFailed: (err: string) => void;
}) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        try {
          const r = await fetch(`/api/onboarding/fast/status/${jobId}`);
          const data = (await r.json()) as StatusResponse;
          if (data.status === "ready" && data.result_json) {
            onReady(data.result_json);
            return;
          }
          if (data.status === "failed") {
            onFailed(data.error ?? "scrape falló sin detalle");
            return;
          }
          // Timeout visual (el backend también tiene watchdog vía cron).
          if (Date.now() - startedAt > SCRAPE_TIMEOUT_MS) {
            onFailed("Tardó demasiado. Reintenta o usa el wizard tradicional.");
            return;
          }
        } catch (e) {
          onFailed(e instanceof Error ? e.message : String(e));
          return;
        }
      }
    }
    poll();

    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [jobId, startedAt, onReady, onFailed]);

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
      <h2 className="text-lg font-semibold">Leyendo tus URLs…</h2>
      <p className="mt-2 text-sm text-neutral-600">
        Tiempo transcurrido: {elapsed}s. Máximo {SCRAPE_TIMEOUT_MS / 1000}s.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase RESOLVING — conflictos + fallback si canonicos vacío
// ─────────────────────────────────────────────────────────────

function ResolvingStep({
  result,
  onResolve,
}: {
  result: JobResultJson;
  onResolve: (resoluciones: Record<string, unknown>) => void;
}) {
  const canonicos = result.canonicos ?? {};
  const conflictos = result.conflictos ?? [];

  // Fallback: si no hay canonicos ni conflictos, mini-form manual.
  if (Object.keys(canonicos).length === 0 && conflictos.length === 0) {
    return (
      <ManualMiniForm
        onSubmit={(manualCanonicos) => onResolve(manualCanonicos)}
      />
    );
  }

  // Caso normal: resolver conflictos (o ninguno).
  return <ConflictResolver canonicos={canonicos} conflictos={conflictos} onResolve={onResolve} />;
}

function ConflictResolver({
  canonicos,
  conflictos,
  onResolve,
}: {
  canonicos: Record<string, unknown>;
  conflictos: Conflicto[];
  onResolve: (resoluciones: Record<string, unknown>) => void;
}) {
  const [choices, setChoices] = React.useState<Record<string, unknown>>({});
  // Horario SIEMPRE editable y confirmado por humano. Bug observado (Bonets
  // Grill): el scraper/merger metía "L-V 9:00-18:00" desde fuentes poco
  // fiables y acababa en el system_prompt sin que nadie lo viese. Ahora lo
  // presentamos siempre, pre-filled con canonicos.hours si existe.
  const hoursInConflict = conflictos.some((c) => c.campo === "hours");
  const [hours, setHours] = React.useState<string>(
    typeof canonicos.hours === "string" ? canonicos.hours : "",
  );
  const [hoursAck, setHoursAck] = React.useState<boolean>(false);

  const allResolved = conflictos.every((c) => c.campo in choices);
  const hoursOk = hours.trim().length >= 3 || hoursAck;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Revisemos los datos</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Lo que coincide ya está guardado.{" "}
        {conflictos.length > 0
          ? `Hay ${conflictos.length} diferencia(s) entre fuentes — elige cuál usar.`
          : "No hay conflictos."}
      </p>

      {!hoursInConflict && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2">
            <Badge>horario</Badge>
            <span className="text-xs text-blue-900">Revisa tu horario de atención (crítico para reservas)</span>
          </div>
          <Input
            className="mt-2"
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setHoursAck(false);
            }}
            placeholder={
              typeof canonicos.hours === "string"
                ? canonicos.hours
                : "Ej: Mar-Sáb 13:30-16:30 y 19:30-23:00. Dom-Lun cerrado."
            }
          />
          <p className="mt-2 text-xs text-blue-800">
            Si lo dejas vacío el bot no podrá rechazar reservas fuera de hora — úsalo solo si de verdad abres 24/7.
          </p>
          {hours.trim().length < 3 && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-blue-900">
              <input
                type="checkbox"
                checked={hoursAck}
                onChange={(e) => setHoursAck(e.target.checked)}
              />
              Confirmo que mi negocio está abierto 24/7.
            </label>
          )}
        </div>
      )}

      {Object.keys(canonicos).length > 0 ? (
        <details className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Datos ya consensuados ({Object.keys(canonicos).length})
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-neutral-700">
            {JSON.stringify(canonicos, null, 2)}
          </pre>
        </details>
      ) : null}

      <div className="mt-4 space-y-4">
        {conflictos.map((c) => (
          <div key={c.campo} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <Badge>{c.campo}</Badge>
              <span className="text-xs text-amber-900">Elige uno:</span>
            </div>
            <div className="mt-2 space-y-2">
              {c.valores.map((v, idx) => {
                const selected = JSON.stringify(choices[c.campo]) === JSON.stringify(v.valor);
                return (
                  <label
                    key={`${c.campo}-${v.origen}-${idx}`}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${
                      selected ? "border-neutral-900 bg-white" : "border-amber-300 bg-white/60"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`conflict-${c.campo}`}
                      className="mt-0.5"
                      checked={selected}
                      onChange={() =>
                        setChoices((prev) => ({ ...prev, [c.campo]: v.valor }))
                      }
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-neutral-500">{v.origen}</div>
                      <div className="mt-0.5 break-words">
                        {typeof v.valor === "string"
                          ? v.valor
                          : JSON.stringify(v.valor, null, 2)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <Button
          disabled={(!allResolved && conflictos.length > 0) || !hoursOk}
          onClick={() => {
            // Si el user editó horario (no había conflicto), inyectamos como
            // resolución para que el merger lo use sobre canonicos.hours.
            const finalChoices: Record<string, unknown> = { ...choices };
            if (!hoursInConflict && hours.trim().length >= 3) {
              finalChoices.hours = hours.trim();
            }
            onResolve(finalChoices);
          }}
          variant="brand"
          size="lg"
        >
          Continuar
        </Button>
      </div>
    </section>
  );
}

function ManualMiniForm({
  onSubmit,
}: {
  onSubmit: (canonicos: Record<string, unknown>) => void;
}) {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [hours, setHours] = React.useState("");
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Rellena lo mínimo</h2>
      <p className="mt-1 text-sm text-neutral-600">
        No pudimos leer ninguna de tus URLs. Dime lo esencial y seguimos.
      </p>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="m-name">Nombre del negocio</Label>
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-desc">Descripción corta</Label>
          <Textarea
            id="m-desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="m-hours">Horario (opcional)</Label>
          <Input
            id="m-hours"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="L-V 9:00-18:00"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <Button
          disabled={name.trim().length < 2 || description.trim().length < 10}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim(),
              ...(hours.trim() ? { hours: hours.trim() } : {}),
            })
          }
          variant="brand"
          size="lg"
        >
          Continuar
        </Button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase PROVIDER — selector + confirm
// ─────────────────────────────────────────────────────────────

function ProviderStep({
  jobId,
  canonicos,
  resoluciones,
  onConfirmed,
  onError,
}: {
  jobId: string;
  canonicos: Record<string, unknown>;
  resoluciones: Record<string, unknown>;
  onConfirmed: (slug: string) => void;
  onError: (msg: string) => void;
}) {
  const [agentName, setAgentName] = React.useState(
    (typeof canonicos.name === "string" ? canonicos.name.split(" ")[0] : "") || "Asistente",
  );
  const [tone, setTone] = React.useState<"professional" | "friendly" | "sales" | "empathetic">(
    "friendly",
  );
  const [useCases, setUseCases] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  function toggleUseCase(v: string) {
    setUseCases((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function submit() {
    setSubmitting(true);
    onError("");
    try {
      const r = await fetch("/api/onboarding/fast/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          resoluciones,
          tone,
          useCases,
          agentName,
          provider: "evolution",
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        onError(data?.error ?? `Error ${r.status}`);
        return;
      }
      onConfirmed(data.slug);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = agentName.trim().length >= 2 && useCases.length >= 1;

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">¿Cómo será tu asistente?</h2>

      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Nombre del asistente</Label>
          <Input id="agent-name" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
        </div>

        <div>
          <Label>Tono</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {TONES.map((t) => (
              <label
                key={t.value}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  tone === t.value
                    ? "border-neutral-900 bg-neutral-50"
                    : "border-neutral-200 bg-white"
                }`}
              >
                <input
                  type="radio"
                  name="tone"
                  className="sr-only"
                  checked={tone === t.value}
                  onChange={() => setTone(t.value)}
                />
                <div className="font-medium">{t.label}</div>
                <div className="mt-0.5 text-xs text-neutral-500">{t.desc}</div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>Para qué lo vas a usar (marca ≥1)</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {USE_CASES.map((uc) => {
              const active = useCases.includes(uc);
              return (
                <button
                  key={uc}
                  type="button"
                  onClick={() => toggleUseCase(uc)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    active
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-700"
                  }`}
                >
                  {uc}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button disabled={!canSubmit || submitting} onClick={submit} variant="brand" size="lg">
          {submitting ? "Creando…" : "Crear agente"}
        </Button>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase QR — muestra el QR Evolution y link al dashboard
// ─────────────────────────────────────────────────────────────

function QRStep({ slug, onDone }: { slug: string; onDone: () => void }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-lg font-semibold">¡Listo!</h2>
      <p className="mt-2 text-sm text-neutral-600">
        Tu tenant <code className="rounded bg-neutral-100 px-1">{slug}</code> está creado.
        Escanea el QR desde WhatsApp en tu móvil para conectar el número.
      </p>
      <div className="my-6 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-8 text-sm text-neutral-500">
        El QR aparece en el dashboard →
      </div>
      <Button onClick={onDone} variant="brand" size="lg">
        Ir al dashboard
      </Button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Fase FAILED — retry o legacy
// ─────────────────────────────────────────────────────────────

function FailedStep({
  error,
  onRetry,
  onLegacy,
}: {
  error: string;
  onRetry: () => void;
  onLegacy: () => void;
}) {
  return (
    <section className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-red-900">Algo no salió bien</h2>
      <p className="mt-2 text-sm text-red-800">{error}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onRetry}>
          Reintentar
        </Button>
        <Button variant="secondary" onClick={onLegacy}>
          Usar wizard tradicional
        </Button>
      </div>
    </section>
  );
}
