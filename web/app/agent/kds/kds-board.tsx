// web/app/agent/kds/kds-board.tsx
// KDS client board — 3 columnas (Pendiente / En preparación / Listo) con
// polling 2s y filtro kitchen|bar|all. Pulsar tarjeta avanza estado.
// Sección "Reservas próximas" sincroniza cada 30s con /api/kds/reservations.

"use client";

import { CalendarClock, ChefHat, GlassWater, Utensils } from "lucide-react";
import * as React from "react";

type KdsReservation = {
  id: string;
  customerPhone: string | null;
  customerName: string | null;
  startsAt: string;
  durationMin: number;
  title: string | null;
  notes: string | null;
  status: string;
  isTest?: boolean;
};

type Station = "all" | "kitchen" | "bar";
type OrderStatus =
  | "pending_kitchen_review"
  | "pending"
  | "preparing"
  | "ready"
  | "served";

type KdsItemModifier = {
  groupId: string;
  modifierId: string;
  name: string;
  priceDeltaCents: number;
};

type KdsItem = {
  id: string;
  name: string;
  quantity: number;
  station: string;
  notes: string | null;
  // Mig 042: modifiers seleccionados al pedir. Vacío si no aplica.
  modifiers?: KdsItemModifier[];
};

// Tipo de pago: el KDS NO cobra (eso vive en /agent/comandero), pero los
// pedidos pueden llegar ya pagados desde el comandero — mantenemos el
// shape para compatibilidad con el endpoint /api/kds.
type PaymentMethod = "cash" | "card" | "transfer" | "other";

type KdsOrder = {
  id: string;
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  status: OrderStatus;
  orderType: "dine_in" | "takeaway";
  pickupEtaMinutes: number | null;
  kitchenDecision: "pending" | "accepted" | "rejected";
  totalCents: number;
  currency: string;
  notes: string | null;
  isTest?: boolean;
  // Mig 039: null = pedido no cobrado aún (o pre-mig). Cuando el admin
  // pulsa "Cobrar" en el KDS con método seleccionado, se rellena.
  paymentMethod?: PaymentMethod | null;
  paidAt?: string | null;
  // Mig 041: propina en céntimos. 0 = sin propina (default). Pedidos pre-
  // mig 041 que el endpoint /api/kds aún no devuelva quedan en undefined.
  tipCents?: number;
  createdAt: string;
  items: KdsItem[];
};

// Columnas tradicionales (post-aceptación). pending_kitchen_review tiene su
// propia sección con botones aceptar/rechazar arriba del board.
const COLUMN_STATUSES: OrderStatus[] = ["pending", "preparing", "ready"];
const ETA_OPTIONS = [10, 15, 20, 25, 30, 35, 45] as const;
const REJECT_REASONS: { key: string; label: string; needsDetail: boolean; detailLabel?: string }[] = [
  { key: "closing_soon", label: "Cocina cerrando — no llegamos a tiempo", needsDetail: false },
  { key: "too_busy", label: "Mucha demanda ahora mismo, 30+ min de espera", needsDetail: false },
  { key: "out_of_stock", label: "Producto fuera de stock", needsDetail: true, detailLabel: "¿Qué producto?" },
  { key: "temporarily_unavailable", label: "Producto temporalmente no disponible", needsDetail: true, detailLabel: "¿Qué producto?" },
  { key: "kitchen_problem", label: "Problema técnico en cocina", needsDetail: false },
  { key: "other", label: "Otra razón", needsDetail: true, detailLabel: "Especifica" },
];
const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  pending_kitchen_review: null,  // se gestiona via accept/reject endpoints
  pending: "preparing",
  preparing: "ready",
  ready: "served",
  served: null,
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_kitchen_review: "Pendiente de aceptar",
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  served: "Servido",
};

const STATUS_TONE: Record<OrderStatus, { card: string; badge: string }> = {
  pending_kitchen_review: { card: "bg-violet-50 border-violet-300", badge: "bg-violet-100 text-violet-800" },
  pending: { card: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-800" },
  preparing: { card: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-800" },
  ready: { card: "bg-emerald-50 border-emerald-300", badge: "bg-emerald-100 text-emerald-800" },
  served: { card: "bg-neutral-50 border-neutral-200", badge: "bg-neutral-100 text-neutral-700" },
};

// Mig POS-redesign F7: ticket-age coloring estándar de KDS de clase mundial
// (Toast/Square). Verde <10min · ámbar 10-25min · rojo >25min. El badge de
// edad reemplaza el badge de status para reflejar urgencia operativa real.
function ageTone(minutes: number): string {
  if (minutes < 10) return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
  if (minutes < 25) return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
  return "bg-rose-100 text-rose-800 ring-1 ring-rose-200 animate-pulse";
}

export function KdsBoard({ kioskToken }: { kioskToken?: string } = {}) {
  const [station, setStation] = React.useState<Station>("all");
  const [orders, setOrders] = React.useState<KdsOrder[]>([]);
  const [reservations, setReservations] = React.useState<KdsReservation[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [advancing, setAdvancing] = React.useState<string | null>(null);
  // Toggle "🧪 Incluir pruebas".
  // 2026-04-24: default ahora ON — Mario pidió ver los pedidos del playground
  // en KDS para validar que el agente funciona ("quiero que lleguen para
  // revisar que el agente esta funcionando bien"). El toggle persiste la
  // elección del admin en localStorage para que no tenga que tocarlo cada
  // sesión.
  const [includeTest, setIncludeTest] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("kds-include-test");
      if (saved === "0") setIncludeTest(false);
      else if (saved === "1") setIncludeTest(true);
    } catch {
      /* noop */
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("kds-include-test", includeTest ? "1" : "0");
    } catch {
      /* noop */
    }
  }, [includeTest]);

  // Mig 030: cuando montamos esto desde /kiosk/<token> mandamos el token en
  // headers para que las rutas /api/kds/* autentiquen sin cookie de Auth.js.
  const authHeaders = React.useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (kioskToken) h["x-kiosk-token"] = kioskToken;
    return h;
  }, [kioskToken]);

  const fetchOrders = React.useCallback(async () => {
    try {
      const qs = `station=${station}${includeTest ? "&includeTest=1" : ""}`;
      const res = await fetch(`/api/kds?${qs}`, { cache: "no-store", headers: authHeaders });
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
  }, [station, includeTest, authHeaders]);

  const fetchReservations = React.useCallback(async () => {
    try {
      const qs = includeTest ? "?includeTest=1" : "";
      const res = await fetch(`/api/kds/reservations${qs}`, { cache: "no-store", headers: authHeaders });
      if (!res.ok) return;
      const data = (await res.json()) as { reservations: KdsReservation[] };
      setReservations(data.reservations ?? []);
    } catch {
      // best-effort, no rompe el board
    }
  }, [includeTest, authHeaders]);

  React.useEffect(() => {
    fetchOrders();
    fetchReservations();
  }, [fetchOrders, fetchReservations]);

  React.useEffect(() => {
    const id = setInterval(fetchOrders, 2000);
    return () => clearInterval(id);
  }, [fetchOrders]);

  React.useEffect(() => {
    // Reservas cambian más despacio — polling cada 30s es suficiente.
    const id = setInterval(fetchReservations, 30000);
    return () => clearInterval(id);
  }, [fetchReservations]);

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
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ orderId }),
      });
      await fetchOrders();
    } finally {
      setAdvancing(null);
    }
  }

  async function acceptKitchen(orderId: string, etaMinutes: number) {
    if (advancing) return;
    setAdvancing(orderId);
    try {
      const res = await fetch("/api/kds/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ orderId, etaMinutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`Aceptar falló: ${body.error ?? res.status}`);
      }
      await fetchOrders();
    } finally {
      setAdvancing(null);
    }
  }

  async function rejectKitchen(orderId: string, reasonKey: string, detail?: string) {
    if (advancing) return;
    setAdvancing(orderId);
    try {
      const res = await fetch("/api/kds/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ orderId, reasonKey, detail }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`Rechazar falló: ${body.error ?? res.status}`);
      }
      await fetchOrders();
    } finally {
      setAdvancing(null);
    }
  }

  // El cobro y propinas viven en /agent/comandero (POS). El KDS solo bumpea
  // estados de cocina. La ruta PATCH /api/orders/[id] sigue existiendo para
  // el comandero — se quitó solo del UI del KDS (mig 056).

  // Mig 030 bug-fix: "Pendientes de aceptar" filtra solo los que la cocina aún
  // no ha decidido. Antes mostraba TODOS los pending_kitchen_review incluyendo
  // los ya aceptados esperando confirmación del cliente — al pulsar Aceptar
  // otra vez el backend devolvía `kitchen_already_decided` y se veía un banner
  // rojo en la pantalla. Ahora las cards desaparecen en cuanto cocina decide.
  const pendingReview = orders.filter(
    (o) => o.status === "pending_kitchen_review" && o.kitchenDecision === "pending",
  );
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIncludeTest((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              includeTest
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
            aria-pressed={includeTest}
            title="Muestra/oculta pedidos y reservas creadas desde el playground"
          >
            {includeTest ? "🧪 Mostrando pruebas" : "🧪 Incluir pruebas"}
          </button>
          <StationFilter value={station} onChange={setStation} />
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <ReservationsPanel reservations={reservations} />

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
        <>
          {pendingReview.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-violet-700">
                <span>Pendientes de aceptar</span>
                <span className="rounded-full bg-violet-100 px-2 text-xs text-violet-700">
                  {pendingReview.length}
                </span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {pendingReview.map((o) => (
                  <ReviewCard
                    key={o.id}
                    order={o}
                    disabled={advancing === o.id}
                    onAccept={(eta) => acceptKitchen(o.id, eta)}
                    onReject={(rk, dt) => rejectKitchen(o.id, rk, dt)}
                  />
                ))}
              </div>
            </section>
          )}
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
        </>
      )}
    </div>
  );
}

function ReviewCard({
  order,
  disabled,
  onAccept,
  onReject,
}: {
  order: KdsOrder;
  disabled: boolean;
  onAccept: (etaMinutes: number) => void;
  onReject: (reasonKey: string, detail?: string) => void;
}) {
  const [eta, setEta] = React.useState<number>(20);
  const [mode, setMode] = React.useState<"idle" | "rejecting">("idle");
  const [reasonKey, setReasonKey] = React.useState<string>(REJECT_REASONS[0]!.key);
  const [detail, setDetail] = React.useState<string>("");
  const reason = REJECT_REASONS.find((r) => r.key === reasonKey)!;
  const tone = STATUS_TONE.pending_kitchen_review;
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000));
  const ageLabel = minutesAgo < 60 ? `${minutesAgo} min` : `${Math.round(minutesAgo / 60)} h`;
  const typeLabel = order.orderType === "dine_in"
    ? `Mesa ${order.tableNumber ?? "?"}`
    : `Llevar — ${order.customerName ?? "?"}`;

  return (
    <div className={`rounded-xl border p-4 ${tone.card}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-neutral-900">
          {order.isTest ? <span title="Pedido de playground" className="mr-1">🧪</span> : null}
          {typeLabel}
        </span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ageTone(minutesAgo)}`}>
          {ageLabel}
        </span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {order.items.map((it) => (
          <li key={it.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="font-medium text-neutral-700">{it.quantity}×</span> {it.name}
                {it.notes ? <span className="ml-1 text-xs italic text-neutral-500">({it.notes})</span> : null}
              </span>
            </div>
            {it.modifiers && it.modifiers.length > 0 ? (
              <span className="text-[11px] italic text-neutral-500">
                / {it.modifiers.map((m) => m.name).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {order.notes ? (
        <div className="mt-3 rounded bg-white/70 px-2 py-1 text-xs text-neutral-700 ring-1 ring-neutral-200">
          {order.notes}
        </div>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Tiempo</label>
            <select
              value={eta}
              onChange={(e) => setEta(Number(e.target.value))}
              disabled={disabled}
              className="rounded-md border border-violet-200 bg-white px-2 py-1 text-sm"
            >
              {ETA_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onAccept(eta)}
              disabled={disabled}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Aceptar
            </button>
            <button
              type="button"
              onClick={() => setMode("rejecting")}
              disabled={disabled}
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2 rounded-lg bg-white/80 p-3 ring-1 ring-rose-200">
          <label className="text-xs font-medium uppercase tracking-wider text-rose-700">Razón</label>
          <select
            value={reasonKey}
            onChange={(e) => { setReasonKey(e.target.value); setDetail(""); }}
            disabled={disabled}
            className="w-full rounded-md border border-rose-200 bg-white px-2 py-1 text-sm"
          >
            {REJECT_REASONS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          {reason.needsDetail && (
            <input
              type="text"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={reason.detailLabel ?? "Especifica"}
              disabled={disabled}
              maxLength={120}
              className="w-full rounded-md border border-rose-200 bg-white px-2 py-1 text-sm"
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReject(reasonKey, reason.needsDetail ? detail.trim() : undefined)}
              disabled={disabled || (reason.needsDetail && !detail.trim())}
              className="flex-1 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              Confirmar rechazo
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              disabled={disabled}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
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
  const ageLabel =
    minutesAgo < 60
      ? `${minutesAgo} min`
      : minutesAgo < 1440
        ? `${Math.round(minutesAgo / 60)} h`
        : `${Math.round(minutesAgo / 1440)} d`;
  const hasNotes = order.notes || order.items.some((it) => it.notes);

  return (
    <div
      className={`rounded-xl border p-4 text-left transition ${tone.card}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-neutral-900">
          {order.isTest ? <span title="Pedido de playground" className="mr-1">🧪</span> : null}
          {order.tableNumber ? `Mesa ${order.tableNumber}` : "Para llevar"}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ageTone(minutesAgo)}`}
        >
          {ageLabel}
        </span>
      </div>
      {order.customerName ? (
        <div className="mt-1 text-xs text-neutral-500">{order.customerName}</div>
      ) : null}

      <ul className="mt-3 space-y-1 text-sm">
        {order.items.map((it) => (
          <li key={it.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
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
            </div>
            {it.modifiers && it.modifiers.length > 0 ? (
              <span className="text-[11px] italic text-neutral-500">
                / {it.modifiers.map((m) => m.name).join(", ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {hasNotes && order.notes ? (
        <div className="mt-3 rounded bg-white/70 px-2 py-1 text-xs text-neutral-700 ring-1 ring-neutral-200">
          {order.notes}
        </div>
      ) : null}

      {next && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={disabled}
          className="mt-3 block w-full rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-neutral-700 ring-1 ring-neutral-200 hover:bg-white disabled:opacity-50"
        >
          Pulsa para marcar {STATUS_LABEL[next].toLowerCase()}
        </button>
      )}

      {/* KDS de cocina: el cobro NO vive aquí. Se maneja en /agent/comandero
           (POS/Front-of-house) — ver mig 054 split bill + propina + descuentos.
           Toast/Square/Lightspeed/TouchBistro/Revel/Clover separan KDS y POS
           por la misma razón: cocina solo bumpea estados. */}
    </div>
  );
}

function ReservationsPanel({ reservations }: { reservations: KdsReservation[] }) {
  // Solo muestra reservas activas y futuras del día actual + próximos días.
  // Las que ya pasaron hace >1h las filtra el endpoint.
  if (reservations.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/30 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-indigo-700">
          <CalendarClock className="h-4 w-4" />
          <span>Reservas próximas</span>
          <span className="rounded-full bg-indigo-100 px-2 text-xs text-indigo-700">0</span>
        </div>
        <p className="mt-2 text-xs text-indigo-700/70">
          Sin reservas próximas. Cuando el agente cree una por WhatsApp aparecerá aquí.
        </p>
      </section>
    );
  }
  // Agrupa por día (formato es-ES "lun, 22 abr").
  const byDay = new Map<string, KdsReservation[]>();
  const fmtDay = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" });
  const fmtTime = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });
  for (const r of reservations) {
    const key = fmtDay.format(new Date(r.startsAt));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(r);
  }
  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
      <header className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-indigo-700">
        <CalendarClock className="h-4 w-4" />
        <span>Reservas próximas</span>
        <span className="rounded-full bg-indigo-100 px-2 text-xs text-indigo-700">{reservations.length}</span>
      </header>
      <div className="space-y-3">
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-indigo-600/70">{day}</div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => {
                const minutesUntil = Math.round((new Date(r.startsAt).getTime() - Date.now()) / 60000);
                const isImminent = minutesUntil >= -10 && minutesUntil <= 60;
                const personasMatch = (r.title || "").match(/\d+/);
                const personas = personasMatch ? Number(personasMatch[0]) : null;
                const isCancelled = r.status === "cancelada" || r.status === "cancelado";
                return (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-3 text-sm shadow-sm ${
                      isCancelled
                        ? "border-rose-300 bg-rose-50"
                        : isImminent
                          ? "border-amber-300 bg-white ring-1 ring-amber-200"
                          : "border-indigo-200 bg-white"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`font-semibold ${
                          isCancelled ? "text-rose-700 line-through" : "text-neutral-900"
                        }`}
                      >
                        {fmtTime.format(new Date(r.startsAt))}
                      </span>
                      {isCancelled ? (
                        <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                          Cancelada
                        </span>
                      ) : (
                        personas !== null && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600">
                            {personas} {personas === 1 ? "pax" : "pax"}
                          </span>
                        )
                      )}
                    </div>
                    <div
                      className={`mt-1 truncate text-xs font-medium ${
                        isCancelled ? "text-rose-700/80 line-through" : "text-neutral-700"
                      }`}
                    >
                      {r.customerName ?? "Sin nombre"}
                    </div>
                    {r.title && (
                      <div
                        className={`mt-0.5 truncate text-[11px] ${
                          isCancelled ? "text-rose-700/70 line-through" : "text-neutral-500"
                        }`}
                      >
                        {r.title}
                      </div>
                    )}
                    {r.notes && !isCancelled && (
                      <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] italic text-amber-800">
                        {r.notes}
                      </div>
                    )}
                    {isImminent && !isCancelled && (
                      <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-amber-700">
                        {minutesUntil < 0 ? "En curso" : `En ${minutesUntil} min`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
