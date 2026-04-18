"use client";

// web/app/admin/tenants/[id]/validator-card.tsx
// Sprint 3 validador-ui · Fase 9 · toggle validation_mode override + trigger manual + unpause.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  setValidationModeAction,
  triggerManualRunAction,
  unpauseAgentAction,
} from "./actions";

type Mode = "auto" | "manual" | "skip";

const MODE_OPTIONS: Array<{ value: "" | Mode; label: string }> = [
  { value: "", label: "Usar default global" },
  { value: "auto", label: "auto (autopatch + notify)" },
  { value: "manual", label: "manual (admin revisa)" },
  { value: "skip", label: "skip (sin validación)" },
];

export function ValidatorCard({
  tenantId,
  override,
  globalDefault,
  effectiveMode,
  paused,
}: {
  tenantId: string;
  override: Mode | null;
  globalDefault: Mode;
  effectiveMode: Mode;
  paused: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<"" | Mode>((override ?? "") as "" | Mode);

  function notify(label: string, ok: boolean, error?: string) {
    if (ok) {
      setMsg(`${label}: OK`);
      setErr(null);
      router.refresh();
    } else {
      setErr(`${label}: ${error ?? "error"}`);
      setMsg(null);
    }
  }

  const overrideLabel = override === null ? `(hereda global → ${globalDefault})` : "(override)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Validador</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">Modo efectivo:</span>
          <span className="font-medium">{effectiveMode}</span>
          <span className="text-neutral-400">{overrideLabel}</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="mode">Override por tenant</Label>
            <select
              id="mode"
              value={draft}
              onChange={(e) => setDraft(e.target.value as "" | Mode)}
              className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || draft === ((override ?? "") as "" | Mode)}
            onClick={() =>
              start(async () => {
                const modeToSet: Mode | null = draft === "" ? null : draft;
                const r = await setValidationModeAction(tenantId, modeToSet);
                notify("setValidationMode", r.ok, !r.ok ? r.error : undefined);
              })
            }
          >
            Guardar modo
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!window.confirm("¿Disparar run manual del validador?")) return;
                const r = await triggerManualRunAction(tenantId);
                notify("triggerManualRun", r.ok, !r.ok ? r.error : undefined);
              })
            }
          >
            Disparar validator manual
          </Button>
          {paused && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!window.confirm("¿Unpausar agente de este tenant?")) return;
                  const r = await unpauseAgentAction(tenantId);
                  notify("unpauseAgent", r.ok, !r.ok ? r.error : undefined);
                })
              }
            >
              Unpausar agente
            </Button>
          )}
        </div>

        {msg && <p className="text-xs text-emerald-600">{msg}</p>}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </CardContent>
    </Card>
  );
}
