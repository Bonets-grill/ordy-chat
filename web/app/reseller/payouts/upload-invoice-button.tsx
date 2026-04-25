"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 5 * 1024 * 1024;

const ERROR_LABELS: Record<string, string> = {
  file_required: "Selecciona un PDF",
  only_pdf_allowed: "Solo se aceptan archivos PDF",
  file_too_large: "Máximo 5 MB",
  invalid_state: "Este payout ya no admite cambios",
  forbidden: "No puedes subir factura para este payout",
  rate_limited: "Demasiados intentos, espera un rato",
};

export function UploadInvoiceButton({ payoutId }: { payoutId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick() {
    setError(null);
    inputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError(ERROR_LABELS.only_pdf_allowed);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(ERROR_LABELS.file_too_large);
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/reseller/payouts/${payoutId}/invoice`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(ERROR_LABELS[data.error ?? ""] ?? "Error subiendo el PDF");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={pick}
        disabled={pending}
        className="text-xs text-brand-600 hover:underline disabled:opacity-50"
      >
        {pending ? "Subiendo…" : "Subir PDF"}
      </button>
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={onChange}
        className="hidden"
      />
    </span>
  );
}
