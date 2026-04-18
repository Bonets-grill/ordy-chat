"use client";

// web/app/admin/validator/[run_id]/message-card.tsx
// Sprint 3 validador-ui · Fase 8 · card por mensaje (asserts + judge + acciones).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ValidatorMessageRow } from "@/lib/admin/validator-queries";
import {
  approveMessageAction,
  editMessageResponseAction,
  rejectMessageAction,
} from "./actions";

const VERDICT_TONE: Record<ValidatorMessageRow["verdict"], "success" | "warn" | "muted"> = {
  pass: "success",
  review: "warn",
  fail: "muted",
};

function ScoreBar({ score }: { score: number }) {
  // No hay progress.tsx en el proyecto — div Tailwind inline.
  const pct = Math.max(0, Math.min(100, score * 10));
  return (
    <div className="h-1.5 w-20 overflow-hidden rounded bg-neutral-100">
      <div style={{ width: `${pct}%` }} className="h-full bg-neutral-900" />
    </div>
  );
}

export function MessageCard({
  message,
  runId,
  canDecide,
}: {
  message: ValidatorMessageRow;
  runId: string;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(message.responseText);
  const [err, setErr] = useState<string | null>(null);

  function refresh(label: string, ok: boolean, error?: string) {
    if (ok) {
      setErr(null);
      router.refresh();
    } else {
      setErr(`${label}: ${error ?? "error"}`);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="muted">{message.seedId}</Badge>
          <Badge tone={VERDICT_TONE[message.verdict]}>verdict: {message.verdict}</Badge>
          {message.adminDecision && (
            <Badge tone={message.adminDecision === "rejected" ? "warn" : "success"}>
              admin: {message.adminDecision}
            </Badge>
          )}
          {message.durationMs !== null && (
            <span className="text-xs text-neutral-500">{message.durationMs}ms</span>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">seed</div>
          <p className="text-sm">{message.seedText}</p>
          {message.seedExpectedAction && (
            <p className="mt-1 text-xs text-neutral-500">
              espera tool: <code>{message.seedExpectedAction}</code>
            </p>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">respuesta</div>
          <p className="whitespace-pre-wrap text-sm">{message.responseText}</p>
          {message.adminEditedResponse && (
            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2">
              <div className="text-xs font-medium text-emerald-700">editado por admin</div>
              <p className="whitespace-pre-wrap text-sm">{message.adminEditedResponse}</p>
            </div>
          )}
        </div>

        {message.assertsResult && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(message.assertsResult).map(([k, v]) => (
              <Badge key={k} tone={v ? "success" : "warn"}>
                {k}: {v ? "OK" : "X"}
              </Badge>
            ))}
          </div>
        )}

        {message.judgeScores && (
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(message.judgeScores).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs text-neutral-600">
                <span className="w-36 tabular-nums">{k}</span>
                <ScoreBar score={Number(v)} />
                <span className="tabular-nums">{v}/10</span>
              </div>
            ))}
          </div>
        )}

        {message.judgeNotes && (
          <div className="rounded bg-neutral-50 p-2 text-xs text-neutral-600">
            <strong>judge:</strong> {message.judgeNotes}
          </div>
        )}

        {canDecide && !editing && (
          <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await approveMessageAction(runId, message.id);
                  refresh("approve", r.ok, !r.ok ? r.error : undefined);
                })
              }
            >
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const reason = window.prompt("Motivo (opcional)") ?? undefined;
                  const r = await rejectMessageAction(runId, message.id, reason);
                  refresh("reject", r.ok, !r.ok ? r.error : undefined);
                })
              }
            >
              Rechazar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              Editar respuesta
            </Button>
          </div>
        )}

        {canDecide && editing && (
          <div className="space-y-2 border-t border-neutral-100 pt-3">
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={4}
              maxLength={4000}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={pending || !editedText.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await editMessageResponseAction(runId, message.id, editedText);
                    refresh("edit", r.ok, !r.ok ? r.error : undefined);
                    if (r.ok) setEditing(false);
                  })
                }
              >
                Guardar edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setEditedText(message.responseText);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}
      </CardContent>
    </Card>
  );
}
