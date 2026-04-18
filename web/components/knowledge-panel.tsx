"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Faq = { id: string; question: string; answer: string; orderIndex: number };

type KnowledgeState = {
  paymentMethods: string[];
  acceptOnlinePayment: boolean;
  paymentNotes: string | null;
  faqs: Faq[];
};

const PAYMENT_LABELS: Record<string, string> = {
  online: "Pago online con tarjeta (requiere Stripe)",
  on_pickup: "Al recoger en el local",
  on_delivery: "Contra entrega (al recibir)",
  cash: "Efectivo",
  card_in_person: "Tarjeta en persona (datáfono)",
  bizum: "Bizum",
  transfer: "Transferencia bancaria",
};
const PAYMENT_ALL = Object.keys(PAYMENT_LABELS);

export function KnowledgePanel() {
  const [state, setState] = React.useState<KnowledgeState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);
  const [newQ, setNewQ] = React.useState("");
  const [newA, setNewA] = React.useState("");

  const load = React.useCallback(async () => {
    const r = await fetch("/api/knowledge");
    const d = await r.json();
    setState(d);
  }, []);

  React.useEffect(() => { load().catch(() => setMsg({ type: "error", text: "No pude cargar" })); }, [load]);

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  async function savePayment(patch: Partial<Pick<KnowledgeState, "paymentMethods" | "acceptOnlinePayment" | "paymentNotes">>) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
      await load();
      setMsg({ type: "success", text: "Guardado. El agente ya usa la nueva configuración." });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally { setSaving(false); }
  }

  async function addFaq() {
    if (!newQ.trim() || !newA.trim()) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/knowledge/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: newQ, answer: newA }),
      });
      if (!r.ok) throw new Error("error_creando_faq");
      setNewQ(""); setNewA("");
      await load();
      setMsg({ type: "success", text: "FAQ añadida al agente." });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally { setSaving(false); }
  }

  async function updateFaq(id: string, patch: { question?: string; answer?: string }) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch("/api/knowledge/faqs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!r.ok) throw new Error("error_editando");
      await load();
    } finally { setSaving(false); }
  }

  async function deleteFaq(id: string) {
    if (!confirm("¿Eliminar esta FAQ?")) return;
    setSaving(true);
    try {
      await fetch(`/api/knowledge/faqs?id=${id}`, { method: "DELETE" });
      await load();
    } finally { setSaving(false); }
  }

  function togglePaymentMethod(method: string) {
    const set = new Set(state?.paymentMethods ?? []);
    if (set.has(method)) set.delete(method);
    else set.add(method);
    if (set.size === 0) {
      setMsg({ type: "error", text: "Debe haber al menos un método de pago." });
      return;
    }
    savePayment({ paymentMethods: Array.from(set) });
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            msg.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Métodos de pago */}
      <Card>
        <CardHeader>
          <CardTitle>Métodos de pago</CardTitle>
          <CardDescription>
            El agente solo ofrecerá lo que selecciones. Si <strong>Online</strong> está desactivado, no prometerá link de pago por WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {PAYMENT_ALL.map((m) => {
              const active = state.paymentMethods.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={saving}
                  onClick={() => togglePaymentMethod(m)}
                  className={`rounded-lg border p-3 text-left text-sm ${
                    active
                      ? "border-brand-600 bg-brand-50 text-brand-900"
                      : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  <span className={`mr-2 inline-block h-3 w-3 rounded-sm border ${active ? "bg-brand-600 border-brand-600" : "border-neutral-400"}`} />
                  {PAYMENT_LABELS[m]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div>
              <div className="font-medium text-neutral-900">Aceptar pagos online (Stripe)</div>
              <p className="text-sm text-neutral-500">
                Al activar, el agente intentará generar un link de Stripe cuando el cliente confirme un pedido.
                Necesitas Stripe configurado en la plataforma.
              </p>
            </div>
            <Toggle
              checked={state.acceptOnlinePayment}
              disabled={saving}
              onChange={(v) => savePayment({ acceptOnlinePayment: v })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Notas sobre el pago (opcional)</label>
            <Textarea
              rows={2}
              defaultValue={state.paymentNotes ?? ""}
              placeholder="Ej: Aceptamos Bizum al 612345678 a nombre de Bonets Grill"
              onBlur={(e) => savePayment({ paymentNotes: e.target.value.trim() || null })}
            />
          </div>
        </CardContent>
      </Card>

      {/* FAQs */}
      <Card>
        <CardHeader>
          <CardTitle>Preguntas frecuentes ({state.faqs.length})</CardTitle>
          <CardDescription>
            Estas respuestas tienen <strong>prioridad máxima</strong> sobre el resto del conocimiento del agente.
            Úsalas para corregir errores (ej: &ldquo;las hamburguesas vienen con papas&rdquo;) o aclarar lo que el scraper pilló mal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {state.faqs.length === 0 && (
            <p className="text-sm text-neutral-500">Aún no hay FAQs. Añade la primera abajo.</p>
          )}
          {state.faqs.map((f) => (
            <FaqRow
              key={f.id}
              faq={f}
              disabled={saving}
              onSave={(q, a) => updateFaq(f.id, { question: q, answer: a })}
              onDelete={() => deleteFaq(f.id)}
            />
          ))}

          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/30 p-4">
            <div className="mb-2 text-sm font-medium text-brand-900">Añadir nueva FAQ</div>
            <div className="space-y-2">
              <Input
                placeholder="Pregunta (ej: ¿Las hamburguesas llevan papas?)"
                value={newQ}
                onChange={(e) => setNewQ(e.target.value)}
              />
              <Textarea
                rows={3}
                placeholder="Respuesta autoritativa (ej: Sí, todas nuestras hamburguesas incluyen patatas fritas. No ofrecer patatas como extra.)"
                value={newA}
                onChange={(e) => setNewA(e.target.value)}
              />
              <Button variant="brand" onClick={addFaq} disabled={saving || !newQ.trim() || !newA.trim()} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Añadir FAQ
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FaqRow({
  faq,
  disabled,
  onSave,
  onDelete,
}: {
  faq: Faq;
  disabled: boolean;
  onSave: (q: string, a: string) => void;
  onDelete: () => void;
}) {
  const [q, setQ] = React.useState(faq.question);
  const [a, setA] = React.useState(faq.answer);
  const dirty = q !== faq.question || a !== faq.answer;
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      <Input value={q} onChange={(e) => setQ(e.target.value)} className="font-medium" />
      <Textarea rows={3} value={a} onChange={(e) => setA(e.target.value)} />
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onDelete} disabled={disabled} className="gap-2 text-red-600 hover:text-red-700">
          <Trash2 className="h-4 w-4" /> Eliminar
        </Button>
        <Button variant="brand" onClick={() => onSave(q, a)} disabled={disabled || !dirty || !q.trim() || !a.trim()}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-brand-600" : "bg-neutral-300"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
    </button>
  );
}
