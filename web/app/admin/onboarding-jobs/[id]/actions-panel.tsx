"use client";

// Panel cliente con botones Reset + Delete + confirm modal simple.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteJobAction, resetJobAction } from "../actions";

export function ActionsPanel({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const canReset = status === "failed";
  const canDelete = status === "failed" || status === "done";

  async function onReset() {
    if (!confirm("¿Reset este job? Se re-disparará el scrape.")) return;
    setBusy(true);
    setMsg(null);
    const r = await resetJobAction(jobId);
    setBusy(false);
    if (r.ok) {
      setMsg("Job reset. Scrape disparado.");
      router.refresh();
    } else {
      setMsg(`Error: ${r.error}`);
    }
  }

  async function onDelete() {
    if (!confirm("¿Borrar este job? Esta acción no se puede deshacer.")) return;
    setBusy(true);
    setMsg(null);
    const r = await deleteJobAction(jobId);
    setBusy(false);
    if (r.ok) {
      router.push("/admin/onboarding-jobs");
    } else {
      setMsg(`Error: ${r.error}`);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!canReset || busy} onClick={onReset}>
        {busy ? "…" : "Reset job"}
      </Button>
      <Button variant="secondary" disabled={!canDelete || busy} onClick={onDelete}>
        {busy ? "…" : "Borrar"}
      </Button>
      {!canReset && !canDelete ? (
        <span className="text-xs text-neutral-500">
          Estado actual ({status}) no permite acciones. Espera a que termine o falle.
        </span>
      ) : null}
      {msg ? <span className="text-sm text-neutral-600">{msg}</span> : null}
    </div>
  );
}
