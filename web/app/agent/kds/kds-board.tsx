// web/app/agent/kds/kds-board.tsx
// KDS client board — 3 columnas (Pendiente / En preparación / Listo) con
// polling 2s y filtro kitchen|bar|all. Pulsar tarjeta avanza estado.

"use client";

import { ChefHat, GlassWater, Utensils } from "lucide-react";
import * as React from "react";

type Station = "all" | "kitchen" | "bar";
type OrderStatus = "pending" | "preparing" | "ready" | "served";

type KdsItem = {
  id: string;
  name: string;
  quantity: number;
  station: string;
  notes: string | null;
};

type KdsOrder = {
  id: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  items: KdsItem[];
};

const COLUMN_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];
const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  pending: "preparing",
  preparing: "ready",
  ready: "served",
  served: null,
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  served: "Servido",
};

const STATUS_TONE: Record<OrderStatus, { card: string; badge: string }> = {
  pending: { card: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-800" },
  preparing: { card: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-800" },
  ready: { card: "bg-emerald-50 border-emerald-300", badge: "bg-emerald-100 text-emerald-800" },
  served: { card: "bg-neutral-50 border-neutral-200", badge: "bg-neutral-100 text-neutral-700" },
};

export function KdsBoard() {
  const [station, setStation] = React.useState<Station>("all");
  const [orders, setOrders] = React.useState<KdsOrder[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [advancing, setAdvancing] = React.useState<string | null>(null);

  const fetchOrders = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/kds?station=${station}`, { cache: "no-store" });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { orders: KdsOrder[] };
      setOrders(data.orders ?? []);
      setError(null);
    } catch {
      setError("Sin conexión. Reintentando…");
    } finally {
      setLoaded(true);
    }
  }, [station]);

  React.useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  React.useEffect(() => {
    const id = setInterval(fetchOrders, 2000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  async function advance(orderId: string) {
    if (advancing) return;
    setAdvancing(orderId);
    // Optimistic: mover estado localmente para feedback instantáneo.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId && NEXT_STATUS[o.status]
          ? { ...o, status: NEXT_STATUS[o.status]! }
          : o,
      ),
    );
    try {
      await fetch("/api/kds/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      await fetchOrders();
    } finally {
      setAdvancing(null);
    }
  }

  const byStatus = COLUMN_STATUSES.reduce(
    (acc, s) => {
      acc[s] = orders.filter((o) => o.status === s);
      return acc;
    },
    {} as Record<OrderStatus, KdsOrder[]>,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">KDS — Cocina & Bar</h1>
          <p className="mt-1 text-neutral-500">
            Pedidos activos en tiempo real. Pulsa la tarjeta para avanzar de estado.
          </p>
        </div>
        <StationFilter value={station} onChange={setStation} />
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!loaded ? (
        <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-400">
          Cargando pedidos…
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-200 p-12 text-center">
          <Utensils className="mx-auto h-10 w-10 text-neutral-300" />
          <p className="mt-3 font-medium text-neutral-700">Cocina tranquila</p>
          <p className="mt-1 text-sm text-neutral-500">
            No hay pedidos activos ahora mismo. Los nuevos aparecerán aquí automáticamente.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMN_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              orders={byStatus[status]}
              onAdvance={advance}
              advancingId={advancing}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StationFilter({ value, onChange }: { value: Station; onChange: (s: Station) => void }) {
  const options: { id: Station; label: string; icon: typeof Utensils }[] = [
    { id: "all", label: "Todo", icon: Utensils },
    { id: "kitchen", label: "Cocina", icon: ChefHat },
    { id: "bar", label: "Bar", icon: GlassWater },
  ];
  return (
    <div className="inline-flex rounded-full border border-neutral-200 bg-white p-1 text-sm shadow-sm">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition ${
            value === id
              ? "bg-brand-600 text-white shadow"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
          aria-pressed={value === id}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Column({
  status,
  orders,
  onAdvance,
  advancingId,
}: {
  status: OrderStatus;
  orders: KdsOrder[];
  onAdvance: (id: string) => void;
  advancingId: string | null;
}) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
        <span>{STATUS_LABEL[status]}</span>
        <span className="rounded-full bg-neutral-100 px-2 text-xs text-neutral-500">
          {orders.length}
        </span>
      </h2>
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-center text-xs text-neutral-400">
          Sin pedidos
        </p>
      ) : (
        orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            disabled={advancingId === o.id}
            onAdvance={() => onAdvance(o.id)}
          />
        ))
      )}
    </div>
  );
}

function OrderCard({
  order,
  disabled,
  onAdvance,
}: {
  order: KdsOrder;
  disabled: boolean;
  onAdvance: () => void;
}) {
  const next = NEXT_STATUS[order.status];
  const tone = STATUS_TONE[order.status];
  const minutesAgo = Math.max(
    0,
    Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000),
  );
  const hasNotes =
    order.notes || order.items.some((it) => it.notes);

  return (
    <button
      type="button"
      onClick={onAdvance}
      disabled={disabled || !next}
      className={`block w-full rounded-xl border p-4 text-left transition hover:shadow-md disabled:opacity-50 ${tone.card}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-neutral-900">
          {order.tableNumber ? `Mesa ${order.tableNumber}` : "Para llevar"}
        </span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone.badge}`}>
          {minutesAgo} min
        </span>
      </div>
      {order.customerName ? (
        <div className="mt-1 text-xs text-neutral-500">{order.customerName}</div>
      ) : null}

      <ul className="mt-3 space-y-1 text-sm">
        {order.items.map((it) => (
          <li key={it.id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-medium text-neutral-700">{it.quantity}×</span>{" "}
              {it.name}
              {it.notes ? (
                <span className="ml-1 text-xs italic text-neutral-500">({it.notes})</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-neutral-400">
              {it.station === "bar" ? "Bar" : "Cocina"}
            </span>
          </li>
        ))}
      </ul>

      {hasNotes && order.notes ? (
        <div className="mt-3 rounded bg-white/70 px-2 py-1 text-xs text-neutral-700 ring-1 ring-neutral-200">
          {order.notes}
        </div>
      ) : null}

      {next ? (
        <div className="mt-3 text-xs font-medium uppercase tracking-wider text-neutral-600">
          Pulsa para marcar {STATUS_LABEL[next].toLowerCase()}
        </div>
      ) : null}
    </button>
  );
}
