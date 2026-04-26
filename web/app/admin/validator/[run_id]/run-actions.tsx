"use client";

// web/app/admin/validator/[run_id]/run-actions.tsx
// Sprint 3 validador-ui · Fase 8 · botones acción run-level.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { ValidatorRunDetail } from "@/lib/admin/validator-queries";
import {
  approveRunAction,
  rejectRunAction,
  rollbackAutopatchAction,
  triggerManualAutopatchAction,
} from "./actions";
import { unpauseAgentAction } from "../../tenants/[id]/actions";

type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: string };

export function RunActionsHeader({
  run,
  effectiveMode,
}: {
  run: ValidatorRunDetail;
  effectiveMode: "auto" | "manual" | "skip";
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onResult(label: string, result: ActionResult) {
    if (result.ok) {
      setMsg(`${label}: OK`);
      setErr(null);
      router.refresh();
    } else {
      setErr(`${label}: ${result.error}`);
      setMsg(null);
    }
  }

  const canApprove = effectiveMode === "manual" && (run.status === "pass" || run.status === "review");
  const canRollback = Boolean(run.previousSystemPrompt);
  // Disparar autopatch manual solo si existe algún fail/review pasado.
  const canTriggerAutopatch = run.status === "fail" || run.status === "review";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !canApprove}
          onClick={() =>
            start(async () => {
              const r = await approveRunAction(run.id);
              onResult("approveRun", r);
            })
          }
        >
          Aprobar run
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const reason = window.prompt("Motivo del rechazo (requerido)") ?? "";
              if (!reason.trim()) return;
              const r = await rejectRunAction(run.id, reason.trim());
              onResult("rejectRun", r);
            })
          }
        >
          Rechazar run
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !canTriggerAutopatch}
          onClick={() =>
            start(async () => {
              const ok = await confirm({
                title: "¿Disparar autopatch manual?",
                description: "El validador propondrá un parche al system_prompt basado en los fallos. Podrás revisarlo antes de aplicar.",
                confirmLabel: "Disparar",
              });
              if (!ok) return;
              const r = await triggerManualAutopatchAction(run.id);
              onResult("triggerAutopatch", r);
            })
          }
        >
          Disparar autopatch
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending || !canRollback}
          onClick={() =>
            start(async () => {
              const ok = await confirm({
                title: "¿Revertir al system_prompt anterior?",
                description: "Se restaurará el prompt previo al autopatch. El histórico queda en audit_log.",
                confirmLabel: "Revertir",
                variant: "danger",
              });
              if (!ok) return;
              const r = await rollbackAutopatchAction(run.id);
              onResult("rollback", r);
            })
          }
        >
          Rollback autopatch
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const ok = await confirm({
                title: "¿Reactivar agente?",
                description: "El agente volverá a responder mensajes de WhatsApp para este tenant.",
                confirmLabel: "Reactivar",
              });
              if (!ok) return;
              const r = await unpauseAgentAction(run.tenantId);
              onResult("unpauseAgent", r);
            })
          }
        >
          Unpausar agente
        </Button>
      </div>
      {msg && <p className="text-xs text-emerald-600">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
