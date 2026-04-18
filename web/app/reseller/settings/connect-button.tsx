"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ConnectStripeButton({
  label,
  resellerId,
}: {
  label: string;
  resellerId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reseller/stripe-connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resellerId }),
      });
      const body = await res.json();
      if (res.ok && body.url) {
        window.location.href = body.url;
      } else {
        setError(body.error ?? `Error ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="primary" onClick={start} disabled={loading}>
        {loading ? "Redirigiendo…" : label}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
