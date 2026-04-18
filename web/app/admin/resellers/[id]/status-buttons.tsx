"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Status = "pending" | "active" | "paused" | "terminated";

export function StatusButtons({
  resellerId,
  currentStatus,
}: {
  resellerId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const setStatus = (newStatus: Status) => {
    if (!confirm(`Cambiar estado a "${newStatus}"?`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/admin/resellers/${resellerId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Error: ${body.error ?? res.statusText}`);
      }
    });
  };

  return (
    <div className="flex gap-2">
      {currentStatus !== "active" && currentStatus !== "terminated" && (
        <Button variant="primary" size="sm" onClick={() => setStatus("active")} disabled={isPending}>
          Activar
        </Button>
      )}
      {currentStatus === "active" && (
        <Button variant="ghost" size="sm" onClick={() => setStatus("paused")} disabled={isPending}>
          Pausar
        </Button>
      )}
      {currentStatus === "paused" && (
        <Button variant="primary" size="sm" onClick={() => setStatus("active")} disabled={isPending}>
          Reactivar
        </Button>
      )}
      {currentStatus !== "terminated" && (
        <Button variant="ghost" size="sm" onClick={() => setStatus("terminated")} disabled={isPending}>
          Terminar
        </Button>
      )}
    </div>
  );
}
