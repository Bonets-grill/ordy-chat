"use client";

// Lista + form para agent_rules del tenant. Compact: textarea + priority +
// botón. Cada regla activa en una fila con botón eliminar (soft delete).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addRuleAction, removeRuleAction } from "./rules-actions";

export type Rule = {
  id: string;
  rule_text: string;
  priority: number;
  created_at: string;
};

export function RulesCard({
  tenantId,
  rules,
}: {
  tenantId: string;
  rules: Rule[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const t = text.trim();
    if (t.length < 3) {
      setMsg("Regla muy corta (mínimo 3 caracteres).");
      return;
    }
    if (t.length > 500) {
      setMsg("Regla muy larga (máximo 500 caracteres).");
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await addRuleAction(tenantId, t, priority);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMsg((res as { error?: string }).error ?? "error");
        return;
      }
      setText("");
      setPriority(0);
      router.refresh();
    });
  }

  function remove(ruleId: string) {
    if (!confirm("¿Eliminar esta regla?")) return;
    startTransition(async () => {
      const res = await removeRuleAction(tenantId, ruleId);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMsg((res as { error?: string }).error ?? "error");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 p-4">
        <h3 className="text-base font-semibold">Reglas duras del agente</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Reglas operativas persistentes inyectadas en el system_prompt del bot
          cliente en cada turno. Ej: "15 min antes del cierre solo takeaway".
          Prioridad mayor = aparece primero en el prompt.
        </p>
      </div>

      <div className="divide-y divide-neutral-100">
        {rules.length === 0 ? (
          <div className="p-4 text-sm text-neutral-500">Sin reglas activas.</div>
        ) : (
          rules.map((r) => (
            <div
              key={r.id}
              className="flex items-start gap-3 p-3"
            >
              <span className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-md bg-neutral-100 text-[11px] font-semibold text-neutral-600">
                {r.priority}
              </span>
              <p className="flex-1 text-sm text-neutral-800 leading-relaxed">
                {r.rule_text}
              </p>
              <button
                onClick={() => remove(r.id)}
                disabled={pending}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-neutral-100 p-3">
        <div className="flex items-start gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nueva regla…  (ej: 'Nunca aceptamos reservas de más de 8 personas')"
            rows={2}
            maxLength={500}
            disabled={pending}
            className="flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:bg-white disabled:opacity-60"
          />
          <div className="flex flex-col gap-1 w-24">
            <label className="text-[10px] uppercase tracking-wide text-neutral-500">
              Prioridad
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              disabled={pending}
              className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:bg-white disabled:opacity-60"
            />
          </div>
          <button
            onClick={add}
            disabled={pending || !text.trim()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "…" : "Añadir"}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <p className="text-[11px] text-neutral-500">
            {text.length}/500 chars · prioridad 0-100 (higher first)
          </p>
          {msg && <p className="text-[11px] text-red-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
