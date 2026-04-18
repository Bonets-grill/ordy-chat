"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ShareCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex items-center gap-3">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs"
      />
      <Button type="button" variant="primary" size="sm" onClick={copy}>
        {copied ? "Copiado ✓" : "Copiar"}
      </Button>
    </div>
  );
}
