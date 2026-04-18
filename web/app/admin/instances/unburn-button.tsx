"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { unburnInstanceAction } from "./actions";

export function UnburnButton({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function onClick() {
    if (!confirm("¿Marcar esta instancia como NO burned? El bot volverá a responder.")) return;
    setBusy(true);
    setErr(null);
    const r = await unburnInstanceAction(tenantId);
    setBusy(false);
    if (r.ok) {
      router.refresh();
    } else {
      setErr(r.error);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={onClick}>
        {busy ? "…" : "Unburn"}
      </Button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}
