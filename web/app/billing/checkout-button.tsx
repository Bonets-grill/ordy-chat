"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function CheckoutButton() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    const r = await fetch("/api/stripe/checkout", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (j.url) {
      window.location.href = j.url;
    } else {
      setError(j.error ?? "Error");
      setLoading(false);
    }
  }

  return (
    <div>
      <Button variant="brand" size="lg" onClick={go} disabled={loading}>
        {loading ? "Redirigiendo…" : "Activar €49.90/mes"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
