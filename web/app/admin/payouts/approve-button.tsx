"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ApproveButton({
  payoutId,
  highValue,
}: {
  payoutId: string;
  highValue: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    let confirmationText: string | undefined;
    if (highValue) {
      const input = prompt(
        `⚠ HIGH-VALUE PAYOUT — pega el ID EXACTO del payout para confirmar:\n\n${payoutId}`,
      );
      if (input === null) return; // user canceled
      confirmationText = input;
    } else {
      if (!confirm("¿Ejecutar transfer Stripe ahora?")) return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          highValue
            ? { confirm_high_value: true, confirmation_text: confirmationText }
            : {},
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        router.refresh();
      } else {
        setError(body.error ?? `Error ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "network_error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="primary" size="sm" onClick={approve} disabled={loading}>
        {loading ? "Procesando…" : highValue ? "Aprobar (HV)" : "Aprobar"}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
