"use client";

// web/app/admin/validator/run-button.tsx
// Botón "Correr run ahora" en la cabecera de /admin/validator.
// Muestra un <select> con los tenants y un botón que dispara
// triggerManualRunAction (action existente en tenants/[id]/actions.ts).
// UX directa para Mario: 2 clicks y tienes run.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerManualRunAction } from "../tenants/[id]/actions";

type TenantOption = { id: string; slug: string; name: string };

export function RunButton({ tenants }: { tenants: TenantOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(tenants[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (tenants.length === 0) return null;

  function fire() {
    if (!selected) return;
    setMsg(null);
    startTransition(async () => {
      const res = await triggerManualRunAction(selected);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setMsg(`Error: ${(res as { error?: string }).error ?? "no se pudo disparar"}`);
        return;
      }
      setMsg("Run lanzado. Se refrescará en unos segundos…");
      setTimeout(() => router.refresh(), 3000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
        disabled={pending}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
      <button
        onClick={fire}
        disabled={pending || !selected}
        className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Lanzando…" : "Correr run"}
      </button>
      {msg && (
        <span className="text-xs text-neutral-600">{msg}</span>
      )}
    </div>
  );
}
