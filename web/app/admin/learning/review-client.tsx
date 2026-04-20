"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { approveRuleAction, rejectRuleAction } from "./actions";

export type LearningRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  rule_text: string;
  evidence: string | null;
  suggested_priority: number;
  status: "pending" | "approved" | "rejected" | "superseded";
  reviewed_at: string | null;
  created_at: string;
};

export function LearningReview({ row }: { row: LearningRow }) {
  const router = useRouter();
  const [priority, setPriority] = useState(row.suggested_priority);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPending = row.status === "pending";

  function approve() {
    setErr(null);
    startTransition(async () => {
      const res = await approveRuleAction(row.id, priority);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setErr((res as { error?: string }).error ?? "error");
        return;
      }
      router.refresh();
    });
  }

  function reject() {
    if (!confirm(`¿Rechazar esta propuesta de ${row.tenant_name}?`)) return;
    setErr(null);
    startTransition(async () => {
      const res = await rejectRuleAction(row.id);
      if (res && typeof res === "object" && "ok" in res && res.ok === false) {
        setErr((res as { error?: string }).error ?? "error");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Link
              href={`/admin/tenants/${row.tenant_id}`}
              className="font-mono text-neutral-700 hover:underline"
            >
              {row.tenant_slug}
            </Link>
            <span>·</span>
            <span>{row.tenant_name}</span>
            <span>·</span>
            <span>{new Date(row.created_at).toLocaleString("es-ES")}</span>
            {row.status !== "pending" && (
              <span
                className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  row.status === "approved"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-neutral-200 text-neutral-700"
                }`}
              >
                {row.status}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-neutral-900">{row.rule_text}</p>
          {row.evidence && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-700">
                evidencia del chat
              </summary>
              <blockquote className="mt-1 border-l-2 border-neutral-200 pl-3 text-xs italic text-neutral-600">
                {row.evidence}
              </blockquote>
            </details>
          )}
        </div>
        {isPending && (
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <label>prioridad</label>
              <input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
                disabled={pending}
                className="w-16 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={reject}
                disabled={pending}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Rechazar
              </button>
              <button
                onClick={approve}
                disabled={pending}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {pending ? "…" : "Aprobar"}
              </button>
            </div>
            {err && <p className="text-[10px] text-red-600">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
