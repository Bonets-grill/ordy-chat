// web/app/agent/reservations/reservations-list.tsx
// Client list de reservas. Agrupa por fecha, muestra hora/mesa/personas y
// permite confirmar / cancelar / marcar completada. Polling cada 10s.

"use client";

import { Calendar, Check, Clock, Phone, X } from "lucide-react";
import * as React from "react";

type Status = "pending" | "confirmed" | "completed" | "cancelled";

type Appointment = {
  id: string;
  customerPhone: string;
  customerName: string | null;
  startsAt: string;
  durationMin: number;
  title: string;
  notes: string | null;
  status: Status;
  createdAt: string;
};

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<Status, string> = {
  pending: "bg-amber-100 text-amber-800 ring-amber-200",
  confirmed: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  completed: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  cancelled: "bg-rose-100 text-rose-800 ring-rose-200",
};

type Scope = "upcoming" | "past";

export function ReservationsList({ timezone }: { timezone: string }) {
  const [scope, setScope] = React.useState<Scope>("upcoming");
  const [rows, setRows] = React.useState<Appointment[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const fetchRows = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments?scope=${scope}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { appointments: Appointment[] };
      setRows(data.appointments ?? []);
      setError(null);
    } catch {
      setError("Sin conexión. Reintentando…");
    } finally {
      setLoaded(true);
    }
  }, [scope]);

  React.useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  React.useEffect(() => {
    if (scope !== "upcoming") return;
    const id = setInterval(fetchRows, 10000);
    return () => clearInterval(id);
  }, [fetchRows, scope]);

  async function changeStatus(id: string, status: Status) {
    if (busy) return;
    setBusy(id);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    try {
      await fetch(`/api/appointments/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await fetchRows();
    } finally {
      setBusy(null);
    }
  }

  const grouped = React.useMemo(() => {
    const byDate = new Map<string, Appointment[]>();
    for (const r of rows) {
      const d = new Date(r.startsAt);
      const key = new Intl.DateTimeFormat("es-ES", {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(d);
      const list = byDate.get(key) ?? [];
      list.push(r);
      byDate.set(key, list);
    }
    return Array.from(byDate.entries());
  }, [rows, timezone]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Reservas</h1>
          <p className="mt-1 text-neutral-500">
            Citas que el agente ha creado por WhatsApp o webchat. Confirma, cancela o marca como completada.
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            Zona horaria: <code className="rounded bg-neutral-100 px-1 py-0.5">{timezone}</code>
          </p>
        </div>
        <div className="inline-flex rounded-full border border-neutral-200 bg-white p-1 text-sm shadow-sm">
          {(["upcoming", "past"] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-full px-3 py-1.5 transition ${
                scope === s ? "bg-brand-600 text-white shadow" : "text-neutral-600 hover:text-neutral-900"
              }`}
              aria-pressed={scope === s}
            >
              {s === "upcoming" ? "Próximas" : "Histórico"}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loaded ? (
        <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400">
          Cargando…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 p-12 text-center">
          <Calendar className="mx-auto h-10 w-10 text-neutral-300" />
          <p className="mt-3 font-medium text-neutral-700">
            {scope === "upcoming" ? "Sin reservas próximas" : "Sin histórico"}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Las reservas que cree el agente aparecerán aquí automáticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([date, items]) => (
            <section key={date} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
                {date}
              </h2>
              <div className="space-y-2">
                {items.map((r) => (
                  <AppointmentRow
                    key={r.id}
                    row={r}
                    timezone={timezone}
                    busy={busy === r.id}
                    onChange={(status) => changeStatus(r.id, status)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentRow({
  row,
  timezone,
  busy,
  onChange,
}: {
  row: Appointment;
  timezone: string;
  busy: boolean;
  onChange: (status: Status) => void;
}) {
  const hour = new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(row.startsAt));

  const canConfirm = row.status === "pending";
  const canComplete = row.status === "confirmed";
  const canCancel = row.status === "pending" || row.status === "confirmed";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="flex h-10 w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-neutral-100 font-mono text-sm font-semibold text-neutral-800">
          <Clock className="h-3 w-3 text-neutral-400" />
          {hour}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold text-neutral-900">
              {row.customerName ?? "Cliente sin nombre"}
            </span>
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${STATUS_TONE[row.status]}`}
            >
              {STATUS_LABEL[row.status]}
            </span>
          </div>
          <div className="mt-1 text-sm text-neutral-600">{row.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" /> {row.customerPhone}
            </span>
            <span>{row.durationMin} min</span>
            {row.notes ? <span className="italic">“{row.notes}”</span> : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {canConfirm ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("confirmed")}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Confirmar
          </button>
        ) : null}
        {canComplete ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("completed")}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Completada
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onChange("cancelled")}
            className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}
