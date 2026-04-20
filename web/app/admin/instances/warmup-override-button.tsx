"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toggleWarmupOverrideAction } from "./actions";

export function WarmupOverrideButton({
  tenantId,
  enabled,
}: {
  tenantId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onClick() {
    if (enabled) {
      if (!confirm("¿Desactivar el warmup_override? El tenant volverá al cap diario por tier.")) {
        return;
      }
      setBusy(true);
      setErr(null);
      const r = await toggleWarmupOverrideAction({ tenantId, enable: false });
      setBusy(false);
      if (r.ok) router.refresh();
      else setErr(r.error);
      return;
    }

    const reason = prompt(
      "Razón del override (mínimo 5 caracteres, queda en audit_log):",
      "",
    );
    if (!reason || reason.trim().length < 5) {
      setErr("Razón obligatoria (≥5 chars)");
      return;
    }
    if (
      !confirm(
        "¿Activar warmup_override?\n\n" +
          "Este tenant dejará de estar limitado por el cap diario. " +
          "Riesgo: si Evolution detecta spike en instancia nueva puede banear la cuenta. " +
          "Solo para tenants con volumen real alto confirmado.",
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await toggleWarmupOverrideAction({
      tenantId,
      enable: true,
      reason: reason.trim(),
    });
    setBusy(false);
    if (r.ok) router.refresh();
    else setErr(r.error);
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={enabled ? "ghost" : "secondary"}
        disabled={busy}
        onClick={onClick}
        title={
          enabled
            ? "Quitar override y volver al cap normal"
            : "Saltar cap diario del warmup para este tenant"
        }
      >
        {busy ? "…" : enabled ? "Quitar override" : "Override warmup"}
      </Button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}
