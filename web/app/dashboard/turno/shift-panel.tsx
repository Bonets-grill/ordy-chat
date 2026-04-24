"use client";

// Panel cliente: refresca cada 10s el turno actual. Permite abrir o cerrar.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ByMethod = {
  cashCents: number;
  cardCents: number;
  transferCents: number;
  otherCents: number;
};
type Summary = {
  count: number;
  paidCount: number;
  total: number;
  paidTotal: number;
  // Mig 039: desglose por método. Opcional por si el endpoint viejo no lo envía
  // (no debería pasar en prod post-deploy pero no rompemos render si falta).
  byMethod?: ByMethod;
};
type Shift = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingCashCents: number;
  countedCashCents: number | null;
  openedBy: string | null;
  notes: string | null;
};
type CurrentResp = { shift: Shift | null; summary?: Summary };

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function parseEurosInput(raw: string): number | null {
  const n = Number(raw.replace(",", ".").replace(/[€\s]/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function ShiftPanel() {
  const router = useRouter();
  const [data, setData] = React.useState<CurrentResp | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [openingRaw, setOpeningRaw] = React.useState("0,00");
  const [countedRaw, setCountedRaw] = React.useState("0,00");
  const [notesRaw, setNotesRaw] = React.useState("");

  const fetchCurrent = React.useCallback(async () => {
    try {
      const r = await fetch("/api/shifts/current", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as CurrentResp;
        setData(j);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    fetchCurrent();
    const t = window.setInterval(fetchCurrent, 10_000);
    return () => window.clearInterval(t);
  }, [fetchCurrent]);

  async function openShift() {
    const opening = parseEurosInput(openingRaw);
    if (opening === null) {
      setError("Efectivo inicial inválido");
      return;
    }
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/shifts/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCashCents: opening }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) { setError(j.error ?? "Error"); return; }
      await fetchCurrent();
      router.refresh();
    } finally { setLoading(false); }
  }

  async function closeShift() {
    if (!data?.shift) return;
    const counted = parseEurosInput(countedRaw);
    if (counted === null) {
      setError("Efectivo contado inválido");
      return;
    }
    if (!window.confirm("¿Cerrar turno? Esta acción no se puede deshacer.")) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/shifts/${data.shift.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedCashCents: counted, notes: notesRaw.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) { setError(j.error ?? "Error"); return; }
      setCountedRaw("0,00");
      setNotesRaw("");
      await fetchCurrent();
      router.refresh();
    } finally { setLoading(false); }
  }

  if (!data) return <p className="text-sm text-neutral-500">Cargando…</p>;

  if (!data.shift) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-700">No hay turno abierto. Ábrelo para empezar a acumular pedidos en caja.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-600">Efectivo inicial (€)</span>
            <input
              type="text"
              inputMode="decimal"
              value={openingRaw}
              onChange={(e) => setOpeningRaw(e.target.value)}
              className="mt-1 block w-40 rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </label>
          <Button variant="brand" onClick={openShift} disabled={loading}>
            {loading ? "Abriendo…" : "Abrir turno"}
          </Button>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
      </div>
    );
  }

  const s = data.shift;
  const sum = data.summary ?? { count: 0, paidCount: 0, total: 0, paidTotal: 0 };
  // Mig 039: esperado caja = opening + SOLO cash+NULL. Fallback a paidTotal
  // para pre-deploy (endpoint no envía byMethod aún) — nunca peor que antes.
  const cashPaid = sum.byMethod?.cashCents ?? sum.paidTotal;
  const expected = s.openingCashCents + cashPaid;
  const openedDate = new Date(s.openedAt);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-emerald-800">Turno abierto</div>
            <div className="mt-1 text-sm text-emerald-900">
              Desde <b>{openedDate.toLocaleString("es-ES")}</b>
              {s.openedBy && ` · por ${s.openedBy}`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold text-emerald-900">{euros(sum.paidTotal)}</div>
            <div className="text-[11px] text-emerald-800">cobrado en este turno</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Pedidos" value={String(sum.count)} />
        <Metric label="Pagados" value={String(sum.paidCount)} />
        <Metric label="Caja inicial" value={euros(s.openingCashCents)} />
        <Metric label="Esperado caja" value={euros(expected)} highlight />
      </div>

      {/* Mig 039: desglose por método de pago del turno vivo. Solo se pinta
           si el endpoint devolvió byMethod (omitido pre-deploy o en summary
           vacío). No sumamos card/transfer al esperado de caja. */}
      {sum.byMethod && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-neutral-900">Por método de pago</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Solo <b>efectivo</b> entra en el cuadre de caja. Tarjeta y transferencia liquidan por fuera.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Efectivo" value={euros(sum.byMethod.cashCents)} />
            <Metric label="Tarjeta" value={euros(sum.byMethod.cardCents)} />
            <Metric label="Transferencia" value={euros(sum.byMethod.transferCents)} />
            <Metric label="Otro" value={euros(sum.byMethod.otherCents)} />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold text-neutral-900">Cerrar turno</h3>
        <p className="mt-1 text-xs text-neutral-500">
          Cuenta el efectivo físico y anótalo abajo. Calculamos la diferencia vs. lo esperado.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-600">
              Efectivo contado (€)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={countedRaw}
              onChange={(e) => setCountedRaw(e.target.value)}
              className="mt-1 block w-40 rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </label>
          <label className="block flex-1 min-w-[180px]">
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-600">Notas (opcional)</span>
            <input
              type="text"
              value={notesRaw}
              onChange={(e) => setNotesRaw(e.target.value)}
              maxLength={500}
              placeholder="Incidencias, devoluciones, etc."
              className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </label>
          <Button variant="brand" onClick={closeShift} disabled={loading}>
            {loading ? "Cerrando…" : "Cerrar turno"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${highlight ? "text-emerald-900" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}
