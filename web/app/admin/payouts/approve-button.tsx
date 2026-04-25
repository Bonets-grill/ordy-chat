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

  async function postApprove(payload: Record<string, unknown>) {
    return fetch(`/api/admin/payouts/${payoutId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  const approve = async () => {
    let confirmationText: string | undefined;
    if (highValue) {
      const input = prompt(
        `⚠ HIGH-VALUE PAYOUT — pega el ID EXACTO del payout para confirmar:\n\n${payoutId}`,
      );
      if (input === null) return;
      confirmationText = input;
    } else {
      if (!confirm("¿Ejecutar transfer Stripe ahora?")) return;
    }

    setLoading(true);
    setError(null);
    try {
      const basePayload: Record<string, unknown> = highValue
        ? { confirm_high_value: true, confirmation_text: confirmationText }
        : {};
      let res = await postApprove(basePayload);
      let body = (await res.json().catch(() => ({}))) as { error?: string };

      // Mig 047: si el server pide TOTP, lo solicitamos aquí y reintentamos.
      if (res.status === 401 && body.error === "totp_required") {
        const token = prompt("Código TOTP de tu app autenticadora (6 dígitos):");
        if (token === null) {
          setLoading(false);
          return;
        }
        res = await postApprove({ ...basePayload, totp_token: token.trim() });
        body = (await res.json().catch(() => ({}))) as { error?: string };
      }

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
