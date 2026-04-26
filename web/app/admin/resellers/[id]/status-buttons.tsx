"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAlert, useConfirm } from "@/components/ui/confirm-dialog";

type Status = "pending" | "active" | "paused" | "terminated";

const STATUS_LABEL: Record<Status, string> = {
  pending: "pendiente",
  active: "activo",
  paused: "pausado",
  terminated: "terminado",
};

export function StatusButtons({
  resellerId,
  currentStatus,
}: {
  resellerId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const alert = useAlert();
  const [isPending, startTransition] = useTransition();

  const setStatus = async (newStatus: Status) => {
    const ok = await confirm({
      title: `¿Cambiar estado a "${STATUS_LABEL[newStatus]}"?`,
      description:
        newStatus === "terminated"
          ? "Acción definitiva. El reseller dejará de poder onboardar nuevos tenants."
          : `El reseller pasará a estado "${STATUS_LABEL[newStatus]}".`,
      confirmLabel: "Cambiar",
      variant: newStatus === "terminated" || newStatus === "paused" ? "danger" : "default",
    });
    if (!ok) return;
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
        await alert({
          title: "No se pudo cambiar el estado",
          description: body.error ?? res.statusText,
        });
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
