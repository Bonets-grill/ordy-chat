// web/app/agent/fiscal/verifactu-monitor.tsx
// Monitor operacional Verifactu — contadores por status + lista últimos 20
// recibos + botón reintentar en errores. Polling 15s.

"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import * as React from "react";

type Receipt = {
  id: string;
  orderId: string;
  invoiceSeries: string;
  invoiceNumber: number;
  verifactuStatus: string;
  verifactuSubmittedAt: string | null;
  verifactuHash: string | null;
  verifactuResponse: unknown;
  createdAt: string;
};

type Counts = {
  accepted: number;
  rejected: number;
  error: number;
  error_permanent: number;
  skipped: number;
  submitted: number;
  not_applicable: number;
  total: number;
  errors_24h: number;
};

type Filter =
  | "all"
  | "accepted"
  | "rejected"
  | "error"
  | "error_permanent"
  | "skipped";

const STATUS_LABEL: Record<string, string> = {
  accepted: "Aceptado",
  rejected: "Rechazado",
  error: "Error",
  error_permanent: "Error permanente",
  skipped: "Omitido",
  submitted: "Enviado",
  not_applicable: "No aplica",
};

const STATUS_TONE: Record<string, string> = {
  accepted: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  rejected: "bg-rose-100 text-rose-800 ring-rose-200",
  error: "bg-amber-100 text-amber-800 ring-amber-200",
  error_permanent: "bg-rose-200 text-rose-900 ring-rose-300",
  skipped: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  submitted: "bg-blue-100 text-blue-800 ring-blue-200",
  not_applicable: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};

const RETRYABLE = new Set(["error", "error_permanent", "rejected"]);

export function VerifactuMonitor() {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [receipts, setReceipts] = React.useState<Receipt[]>([]);
  const [counts, setCounts] = React.useState<Counts | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState<string | null>(null);
  const [retryNote, setRetryNote] = React.useState<string | null>(null);

  const fetchRows = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/fiscal/receipts?status=${filter}&limit=20`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { receipts: Receipt[]; counts: Counts };
      setReceipts(data.receipts);
      setCounts(data.counts);
      setError(null);
    } catch {
      setError("Sin conexión. Reintentando…");
    } finally {
      setLoaded(true);
    }
  }, [filter]);

  React.useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  React.useEffect(() => {
    const id = setInterval(fetchRows, 15000);
    return () => clearInterval(id);
  }, [fetchRows]);

  async function retry(receiptId: string) {
    if (retrying) return;
    setRetrying(receiptId);
    setRetryNote(null);
    try {
      const res = await fetch(`/api/fiscal/verifactu/retry/${receiptId}`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        newStatus?: string;
        error?: string;
      };
      if (res.ok && data.newStatus) {
        setRetryNote(`Reintentado. Nuevo estado: ${STATUS_LABEL[data.newStatus] || data.newStatus}`);
      } else {
        setRetryNote(data.error || "Reintento falló. Revisa el log.");
      }
      await fetchRows();
    } catch {
      setRetryNote("Error de red durante el reintento.");
    } finally {
      setRetrying(null);
      setTimeout(() => setRetryNote(null), 6000);
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400">
        Cargando estado Verifactu…
      </div>
    );
  }

  const alertErrors = counts && counts.errors_24h > 3;

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold text-neutral-900">Monitor Verifactu</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Estado de tus registros con AEAT. Reintenta errores manuales; el cron cada
          hora reintenta automáticamente errores recientes (máximo 3 intentos).
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {alertErrors ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <strong>Más de 3 errores en las últimas 24h.</strong> Revisa que tu
            certificado no esté caducado y que el estado de AEAT no esté caído.
            Si persiste, contacta con soporte.
          </div>
        </div>
      ) : null}

      {retryNote ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          {retryNote}
        </div>
      ) : null}

      {counts ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Aceptados"
            value={counts.accepted}
            icon={CheckCircle2}
            color="text-emerald-700"
          />
          <StatCard
            label="En error"
            value={counts.error + counts.error_permanent}
            icon={XCircle}
            color="text-amber-700"
          />
          <StatCard
            label="Rechazados"
            value={counts.rejected}
            icon={AlertTriangle}
            color="text-rose-700"
          />
          <StatCard
            label="Últimas 24h"
            value={counts.errors_24h}
            icon={Clock}
            color={alertErrors ? "text-rose-700" : "text-neutral-700"}
            hint="errores"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(["all", "accepted", "error", "error_permanent", "rejected", "skipped"] as Filter[]).map(
          (f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === f
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {f === "all" ? "Todos" : STATUS_LABEL[f] || f}
            </button>
          ),
        )}
      </div>

      {receipts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="mt-2 text-sm text-neutral-500">
            No hay recibos {filter === "all" ? "" : `con estado "${STATUS_LABEL[filter] || filter}"`}.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {receipts.map((r) => (
            <ReceiptRow
              key={r.id}
              receipt={r}
              retrying={retrying === r.id}
              onRetry={() => retry(r.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  hint,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
        <Icon className={`h-4 w-4 ${color}`} />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${color}`}>
        {value}
      </div>
      {hint ? <div className="text-[10px] text-neutral-400">{hint}</div> : null}
    </div>
  );
}

function ReceiptRow({
  receipt,
  retrying,
  onRetry,
}: {
  receipt: Receipt;
  retrying: boolean;
  onRetry: () => void;
}) {
  const invoiceLabel = `${receipt.invoiceSeries}-${String(receipt.invoiceNumber).padStart(6, "0")}`;
  const canRetry = RETRYABLE.has(receipt.verifactuStatus);
  const tone = STATUS_TONE[receipt.verifactuStatus] || STATUS_TONE.skipped;
  const errorDetail = extractErrorDetail(receipt.verifactuResponse);

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-neutral-900">
            {invoiceLabel}
          </span>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${tone}`}
          >
            {STATUS_LABEL[receipt.verifactuStatus] || receipt.verifactuStatus}
          </span>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {new Date(receipt.createdAt).toLocaleString("es-ES")}
          {receipt.verifactuSubmittedAt ? (
            <>
              {" · enviado "}
              {new Date(receipt.verifactuSubmittedAt).toLocaleString("es-ES")}
            </>
          ) : null}
        </div>
        {errorDetail ? (
          <div className="mt-1 text-xs text-rose-600">{errorDetail}</div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <a
          href={`/api/receipts/${receipt.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50"
        >
          <Download className="h-3.5 w-3.5" />
          PDF
        </a>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Reintentar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function extractErrorDetail(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const obj = response as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.rejectionReason === "string") return obj.rejectionReason;
  if (typeof obj.message === "string") return obj.message;
  return null;
}
