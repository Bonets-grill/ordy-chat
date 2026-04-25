"use client";

// Comandero board — mobile-first. 3 vistas:
//   1. tables   — grid de mesas con badge libre/ocupada.
//   2. menu     — al elegir mesa, carta + carrito + modificadores.
//   3. (post)   — confirma y vuelve a tables.

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CreditCard, LogOut, Minus, Plus, Search, ShoppingCart, Trash2, Utensils, X } from "lucide-react";

type Modifier = { id: string; name: string; priceDeltaCents: number };
type ModifierGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  /** Mig 051: si != null, este grupo solo se muestra cuando esa opción
   * concreta de OTRO grupo del mismo producto está seleccionada. Útil para
   * "Tipo de cocción" que solo aplica si la carne es Medallón (Smash no
   * tiene puntos de cocción). NULL = siempre visible (legacy). */
  dependsOnOptionId?: string | null;
  modifiers: Modifier[];
};
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  category: string;
  imageUrl: string | null;
  isRecommended: boolean;
  modifierGroups: ModifierGroup[];
};
type Table = {
  id: string;
  number: string;
  zone: string | null;
  seats: number;
  state: "free" | "occupied";
  openOrdersCount: number;
  openTotalCents: number;
};
type CartLine = {
  itemId: string;
  qty: number;
  notes?: string;
  modifiers: { groupId: string; modifierId: string; name: string; priceDeltaCents: number }[];
};

type View = "tables" | "menu" | "pos";

type TicketLine = {
  orderId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  modifiersJson: Array<{ name: string; priceDeltaCents: number }> | null;
  notes: string | null;
};

type TicketTotals = {
  subtotal: number;
  tax: number;
  total: number;
  discount: number;
  tip: number;
  finalToPay: number;
};

type Ticket = {
  tableNumber: string;
  orders: Array<{ id: string; status: string; totalCents: number; createdAt: string }>;
  lines: TicketLine[];
  totals: TicketTotals;
};

const formatEur = (cents: number) =>
  `${(cents / 100).toFixed(2).replace(".", ",")} €`;

const ZONE_FALLBACK = "Sin zona";

function groupTablesByZone(tables: Table[]): Array<{ zone: string; list: Table[] }> {
  const map = new Map<string, Table[]>();
  for (const t of tables) {
    const key = (t.zone ?? "").trim() || ZONE_FALLBACK;
    const arr = map.get(key) ?? [];
    arr.push(t);
    map.set(key, arr);
  }
  // Orden alfabético por zona, "Sin zona" siempre al final.
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === ZONE_FALLBACK) return 1;
      if (b === ZONE_FALLBACK) return -1;
      return a.localeCompare(b, "es");
    })
    .map(([zone, list]) => ({ zone, list }));
}

type ComanderoActor =
  | { kind: "employee"; name: string; role: "waiter" | "manager" }
  | { kind: "owner"; name: string; tenantSlug?: string | null };

export function ComanderoBoard({ actor }: { actor?: ComanderoActor }) {
  const router = useRouter();
  const [view, setView] = React.useState<View>("tables");
  const [tables, setTables] = React.useState<Table[]>([]);
  const [items, setItems] = React.useState<MenuItem[]>([]);
  const [tableNumber, setTableNumber] = React.useState<string | null>(null);
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // Carga inicial + refresh.
  const loadTables = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/comandero/tables", { cache: "no-store" });
      if (r.ok) setTables(((await r.json()) as { tables: Table[] }).tables ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadTables();
  }, [loadTables]);

  React.useEffect(() => {
    if (view !== "menu" || items.length > 0) return;
    fetch("/api/comandero/menu", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { items?: MenuItem[] }) => setItems(d.items ?? []))
      .catch(() => setError("No se pudo cargar la carta"));
  }, [view, items.length]);

  function selectTable(t: Table) {
    // Mesa libre → vista menú directa para empezar pedido nuevo.
    // Mesa ocupada → vista POS con la cuenta acumulada para cobrar/ajustar.
    setTableNumber(t.number);
    setError(null);
    if (t.state === "occupied") {
      setView("pos");
    } else {
      setCart([]);
      setView("menu");
    }
  }

  async function closeTable(
    t: Table,
    method: "cash" | "card" = "cash",
    extras: { discountCents?: number; tipCents?: number } = {},
  ) {
    const r = await fetch(
      `/api/comandero/tables/${encodeURIComponent(t.number)}/close`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: method,
          discountCents: extras.discountCents,
          tipCents: extras.tipCents,
        }),
      },
    );
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Error ${r.status}`);
      return false;
    }
    await loadTables();
    router.refresh();
    return true;
  }

  function addToCart(item: MenuItem, modifiers: CartLine["modifiers"] = []) {
    setCart((prev) => {
      // Si ya hay línea con mismos modifiers, +qty. Si no, push nueva.
      const sameKey = prev.findIndex(
        (l) =>
          l.itemId === item.id &&
          JSON.stringify(l.modifiers) === JSON.stringify(modifiers),
      );
      if (sameKey >= 0) {
        const next = [...prev];
        next[sameKey] = { ...next[sameKey], qty: next[sameKey].qty + 1 };
        return next;
      }
      return [...prev, { itemId: item.id, qty: 1, modifiers }];
    });
  }

  function changeQty(idx: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const target = next[idx];
      if (!target) return prev;
      const newQty = target.qty + delta;
      if (newQty <= 0) return next.filter((_, i) => i !== idx);
      next[idx] = { ...target, qty: newQty };
      return next;
    });
  }

  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearCart() {
    if (cart.length === 0) return;
    if (confirm("¿Vaciar todo el carrito?")) setCart([]);
  }

  const itemsById = React.useMemo(() => {
    const m = new Map<string, MenuItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const cartTotal = React.useMemo(() => {
    return cart.reduce((sum, l) => {
      const i = itemsById.get(l.itemId);
      if (!i) return sum;
      const mods = l.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
      return sum + (i.priceCents + mods) * l.qty;
    }, 0);
  }, [cart, itemsById]);

  async function submit() {
    if (!tableNumber || cart.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/comandero/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber,
          items: cart.map((l) => ({
            menuItemId: l.itemId,
            quantity: l.qty,
            modifiers: l.modifiers.length ? l.modifiers : undefined,
          })),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(data.error ?? `Error ${r.status}`);
        return;
      }
      // Reset y vuelve a tables.
      setCart([]);
      setView("tables");
      setTableNumber(null);
      await loadTables();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  // IMPORTANTE: este useMemo DEBE estar arriba del early return de "tables".
  // Antes vivía después y al alternar view tables↔menu cambiaba el número de
  // hooks ejecutados → React error #310 (rendered more hooks than previous
  // render) que crasheaba la página entera. Incidente prod 2026-04-25 13:14.
  const filteredItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);
  const itemsByCategory = React.useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of filteredItems) {
      const arr = m.get(i.category) ?? [];
      arr.push(i);
      m.set(i.category, arr);
    }
    return Array.from(m.entries());
  }, [filteredItems]);
  const allCategories = React.useMemo(() => {
    const m = new Set<string>();
    for (const i of items) m.add(i.category);
    return Array.from(m);
  }, [items]);

  function scrollToCategory(cat: string) {
    const el = document.getElementById(`cmd-cat-${cat}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (view === "tables") {
    const totalOccupied = tables.filter((t) => t.state === "occupied").length;
    const totalRevenue = tables.reduce((sum, t) => sum + (t.openTotalCents ?? 0), 0);
    return (
      <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100">
        {actor ? <ActorTopBar actor={actor} /> : null}
        <main className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Comandero</h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Selecciona una mesa para tomar pedido. Los pedidos van directos al KDS.
            </p>
          </div>
          {tables.length > 0 ? (
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 shadow-sm">
                <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  Mesas activas
                </div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-neutral-900">
                  {totalOccupied}<span className="text-sm font-normal text-neutral-400">/{tables.length}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 shadow-sm">
                <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                  Por cobrar
                </div>
                <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-emerald-900">
                  {formatEur(totalRevenue)}
                </div>
              </div>
            </div>
          ) : null}
        </header>

        {loading ? (
          <p className="text-sm text-neutral-500">Cargando mesas…</p>
        ) : tables.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-sm">
            <p className="text-sm text-neutral-600">
              No tienes mesas configuradas. Ve a{" "}
              <a href="/agent/tables" className="font-medium text-brand-600 hover:underline">
                Mesas y QRs
              </a>{" "}
              para crearlas.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {groupTablesByZone(tables).map(({ zone, list }) => {
              const occupied = list.filter((t) => t.state === "occupied").length;
              return (
                <section key={zone}>
                  <header className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-700">
                      {zone}
                    </h2>
                    <span className="text-xs text-neutral-500">
                      {occupied}/{list.length} ocupada{occupied !== 1 ? "s" : ""}
                    </span>
                  </header>
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {list.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => selectTable(t)}
                          className={`group relative w-full overflow-hidden rounded-2xl border-2 p-5 text-left shadow-sm transition active:scale-[0.97] hover:shadow-md ${
                            t.state === "occupied"
                              ? "border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100/60 hover:border-amber-400"
                              : "border-emerald-200 bg-gradient-to-br from-white to-emerald-50/60 hover:border-emerald-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-neutral-900">
                              {t.number}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                t.state === "occupied"
                                  ? "bg-amber-200/70 text-amber-900"
                                  : "bg-emerald-200/70 text-emerald-900"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  t.state === "occupied" ? "bg-amber-600 animate-pulse" : "bg-emerald-600"
                                }`}
                              />
                              {t.state === "occupied" ? "Ocupada" : "Libre"}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                            {t.seats} pax
                          </div>
                          {t.state === "occupied" ? (
                            <div className="mt-3 space-y-1 border-t border-amber-200/60 pt-2">
                              <div className="flex items-baseline justify-between">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
                                  Pedidos
                                </span>
                                <span className="font-mono text-sm font-bold tabular-nums text-amber-900">
                                  {t.openOrdersCount}
                                </span>
                              </div>
                              {t.openTotalCents > 0 ? (
                                <div className="flex items-baseline justify-between">
                                  <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
                                    Acumulado
                                  </span>
                                  <span className="font-mono text-base font-bold tabular-nums text-neutral-900">
                                    {formatEur(t.openTotalCents)}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-3 border-t border-emerald-200/60 pt-2 text-[11px] font-medium text-emerald-700">
                              Toca para abrir
                            </div>
                          )}
                        </button>
                        {t.state === "occupied" ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void closeTable(t, "cash");
                              }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
                            >
                              💵 Efectivo
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void closeTable(t, "card");
                              }}
                              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-800 active:scale-95"
                            >
                              <CreditCard size={12} />
                              Tarjeta
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
        {error ? (
          <p className="mt-4 text-center text-sm text-red-600">{error}</p>
        ) : null}
      </main>
      </div>
    );
  }

  if (view === "pos" && tableNumber) {
    return (
      <PosView
        tableNumber={tableNumber}
        onBack={() => {
          setView("tables");
          setTableNumber(null);
          setError(null);
        }}
        onAddItems={() => {
          setCart([]);
          setView("menu");
        }}
        onCobrar={async (method, extras) => {
          const t = tables.find((x) => x.number === tableNumber);
          if (!t) return false;
          const ok = await closeTable(t, method, extras);
          if (ok) {
            setView("tables");
            setTableNumber(null);
          }
          return ok;
        }}
        actor={actor}
      />
    );
  }

  // view === "menu"
  return (
    <div className="min-h-screen bg-stone-50">
      {actor ? <ActorTopBar actor={actor} /> : null}
      <main className="mx-auto max-w-4xl px-4 py-4">
      <header className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setView("tables");
            setTableNumber(null);
            setCart([]);
            setSearch("");
          }}
          className="rounded-full p-2 text-neutral-700 hover:bg-neutral-100"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            Mesa {tableNumber}
          </h1>
          <p className="text-xs text-neutral-500">
            {cart.length} línea{cart.length !== 1 ? "s" : ""} · {formatEur(cartTotal)}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">Cargando carta…</p>
      ) : (
        <>
          {/* Buscador + chips de categoría sticky bajo el ActorTopBar.
              Top calculado para no chocar con el ActorTopBar (38px ~ py-2 + texto).
              Usar top-0 si no hay actor. */}
          <div
            className={`sticky z-20 -mx-4 mb-4 border-b border-neutral-200 bg-stone-50 px-4 py-2 ${
              actor ? "top-[38px]" : "top-0"
            }`}
          >
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar plato o ingrediente…"
                className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-9 text-sm focus:border-neutral-900 focus:outline-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
            {!search && allCategories.length > 1 ? (
              <div className="mt-2 -mx-1 flex gap-1.5 overflow-x-auto pb-1">
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => scrollToCategory(cat)}
                    className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {itemsByCategory.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Sin resultados para “{search}”.
            </p>
          ) : (
            <div className="space-y-6 pb-32">
              {itemsByCategory.map(([cat, list]) => (
                <section key={cat} id={`cmd-cat-${cat}`} className="scroll-mt-32">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {cat}
                  </h2>
                  <ul className="space-y-2">
                    {list.map((item) => (
                      <ItemRow key={item.id} item={item} onAdd={addToCart} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Carrito flotante — bottom sheet estilo POS */}
      {cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-white/85">
          <div className="mx-auto max-w-4xl px-4 py-3">
            <details className="rounded-2xl">
              <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-800 px-4 py-3 text-white shadow-md transition hover:shadow-lg">
                <span className="flex items-center gap-3">
                  <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                    <ShoppingCart size={18} />
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold text-emerald-950 ring-2 ring-neutral-900">
                      {cart.reduce((s, l) => s + l.qty, 0)}
                    </span>
                  </span>
                  <span className="flex flex-col text-left">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/60">
                      Carrito · {cart.length} línea{cart.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-sm font-semibold">Pulsa para ver detalle</span>
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-xl font-bold tabular-nums">
                    {formatEur(cartTotal)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      clearCart();
                    }}
                    className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white/80 transition hover:bg-white/20"
                    aria-label="Vaciar carrito"
                  >
                    Vaciar
                  </button>
                </span>
              </summary>
              <ul className="mt-3 max-h-72 overflow-y-auto space-y-1.5 rounded-xl border border-neutral-200 bg-white p-2 text-sm">
                {cart.map((l, i) => {
                  const item = itemsById.get(l.itemId);
                  if (!item) return null;
                  return (
                    <li key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                      <button
                        type="button"
                        onClick={() => changeQty(i, -1)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 hover:bg-neutral-200"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center font-mono text-sm font-bold tabular-nums">{l.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(i, 1)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-white hover:bg-neutral-800"
                      >
                        <Plus size={14} />
                      </button>
                      <span className="flex-1 truncate text-sm">
                        <span className="font-medium text-neutral-900">{item.name}</span>
                        {l.modifiers.length > 0 ? (
                          <span className="ml-1 text-xs text-neutral-500">
                            ({l.modifiers.map((m) => m.name).join(", ")})
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
                        aria-label={`Quitar ${item.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || cart.length === 0}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow disabled:opacity-50"
            >
              <Check size={18} />
              {submitting ? "Enviando…" : `Enviar a cocina · ${formatEur(cartTotal)}`}
            </button>
            {error ? (
              <p className="mt-2 text-center text-xs text-red-600">{error}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
    </div>
  );
}

function ActorTopBar({ actor }: { actor: ComanderoActor }) {
  async function logout() {
    if (actor.kind !== "employee") {
      // owner: lo mandamos al dashboard como "salir del modo comandero".
      window.location.href = "/dashboard";
      return;
    }
    try {
      await fetch("/api/comandero/logout", { method: "POST" });
    } finally {
      window.location.href = "/agent/comandero";
    }
  }
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="flex items-center gap-2">
        <Utensils className="h-4 w-4 text-neutral-700" />
        <span className="text-sm font-semibold text-neutral-900">
          {actor.name}
        </span>
        {actor.kind === "employee" && actor.role === "manager" ? (
          <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            Manager
          </span>
        ) : null}
        {actor.kind === "owner" ? (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
            Owner
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100"
      >
        <LogOut size={12} />
        {actor.kind === "employee" ? "Cerrar sesión" : "Salir del modo"}
      </button>
    </header>
  );
}

function ItemRow({
  item,
  onAdd,
}: {
  item: MenuItem;
  onAdd: (item: MenuItem, modifiers?: CartLine["modifiers"]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const hasGroups = item.modifierGroups.length > 0;

  function quickAdd() {
    if (hasGroups) setOpen(true);
    else onAdd(item, []);
  }

  return (
    <li className="group overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition hover:border-neutral-300 hover:shadow-md">
      <div className="flex items-center gap-4 p-4">
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold text-neutral-900">
              {item.isRecommended ? <span className="mr-1 text-amber-500">⭐</span> : null}
              {item.name}
            </span>
            <span className="shrink-0 font-mono text-base font-bold tabular-nums text-neutral-900">
              {formatEur(item.priceCents)}
            </span>
          </div>
          {item.description ? (
            <p className="line-clamp-2 text-xs text-neutral-500">
              {item.description}
            </p>
          ) : null}
          {hasGroups ? (
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-600">
              Personalizable · {item.modifierGroups.length} grupo{item.modifierGroups.length !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={quickAdd}
          aria-label={`Añadir ${item.name}`}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center self-center rounded-2xl bg-neutral-900 text-white shadow-md transition hover:bg-neutral-800 hover:shadow-lg active:scale-95"
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
      {open && hasGroups ? (
        <ModifierPicker
          item={item}
          onCancel={() => setOpen(false)}
          onConfirm={(mods) => {
            onAdd(item, mods);
            setOpen(false);
          }}
        />
      ) : null}
    </li>
  );
}

function ModifierPicker({
  item,
  onConfirm,
  onCancel,
}: {
  item: MenuItem;
  onConfirm: (mods: CartLine["modifiers"]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = React.useState<Record<string, Set<string>>>(
    () => Object.fromEntries(item.modifierGroups.map((g) => [g.id, new Set<string>()])),
  );

  // Mig 051: un grupo con dependsOnOptionId solo aparece si esa opción está
  // seleccionada en algún otro grupo del producto. Recalculamos qué grupos son
  // visibles cada render — barato porque modifierGroups suele ser <5.
  const allSelectedOptionIds = React.useMemo(() => {
    const all = new Set<string>();
    for (const set of Object.values(selected)) {
      for (const id of set) all.add(id);
    }
    return all;
  }, [selected]);

  const visibleGroups = React.useMemo(
    () =>
      item.modifierGroups.filter(
        (g) => !g.dependsOnOptionId || allSelectedOptionIds.has(g.dependsOnOptionId),
      ),
    [item.modifierGroups, allSelectedOptionIds],
  );

  // Si un grupo se vuelve invisible tras un cambio (cliente cambia a Smash
  // tras haber elegido cocción), limpiamos su selección — evita persistir
  // datos no aplicables al item final.
  React.useEffect(() => {
    setSelected((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const g of item.modifierGroups) {
        const isVisible = !g.dependsOnOptionId || allSelectedOptionIds.has(g.dependsOnOptionId);
        if (!isVisible && next[g.id] && next[g.id].size > 0) {
          next[g.id] = new Set();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allSelectedOptionIds, item.modifierGroups]);

  function toggle(group: ModifierGroup, modId: string) {
    setSelected((prev) => {
      const cur = new Set(prev[group.id] ?? []);
      if (group.selectionType === "single") {
        cur.clear();
        cur.add(modId);
      } else {
        if (cur.has(modId)) cur.delete(modId);
        else cur.add(modId);
      }
      return { ...prev, [group.id]: cur };
    });
  }

  function isValid(): boolean {
    return visibleGroups.every((g) => {
      const set = selected[g.id] ?? new Set();
      if (g.required && set.size < g.minSelect) return false;
      if (g.maxSelect != null && set.size > g.maxSelect) return false;
      return true;
    });
  }

  function confirm() {
    const mods: CartLine["modifiers"] = [];
    for (const g of visibleGroups) {
      for (const id of selected[g.id] ?? []) {
        const m = g.modifiers.find((mm) => mm.id === id);
        if (m) {
          mods.push({
            groupId: g.id,
            modifierId: m.id,
            name: m.name,
            priceDeltaCents: m.priceDeltaCents,
          });
        }
      }
    }
    onConfirm(mods);
  }

  return (
    <div className="border-t border-neutral-100 bg-neutral-50 p-3">
      {visibleGroups.map((g) => (
        <div key={g.id} className="mb-3 last:mb-0">
          <div className="mb-1 text-xs font-semibold text-neutral-700">
            {g.name}{" "}
            {g.required ? (
              <span className="text-red-500">*</span>
            ) : (
              <span className="text-neutral-400">(opcional)</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {g.modifiers.map((m) => {
              const checked = (selected[g.id] ?? new Set()).has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(g, m.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    checked
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-300 bg-white text-neutral-700"
                  }`}
                >
                  {m.name}
                  {m.priceDeltaCents > 0 ? ` (+${formatEur(m.priceDeltaCents)})` : ""}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!isValid()}
          className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Añadir
        </button>
      </div>
    </div>
  );
}

// Exporto el icono usado en sidebar para evitar re-import en otros lugares.
export const ComanderoIcon = Utensils;

// ── POSView (mig 054) ──────────────────────────────────────────────
// Vista cuenta de mesa ocupada: lee /api/comandero/tables/[n]/ticket,
// muestra líneas + totales, permite aplicar descuento + propina y
// disparar cobro (efectivo o tarjeta) con la suma final ajustada.
//
// Split bill no soportado v1 (UX compleja). Si Mario pide split,
// duplicar este componente con un selector de items por subcuenta.
function PosView({
  tableNumber,
  onBack,
  onAddItems,
  onCobrar,
  actor,
}: {
  tableNumber: string;
  onBack: () => void;
  onAddItems: () => void;
  onCobrar: (
    method: "cash" | "card",
    extras: { discountCents: number; tipCents: number },
  ) => Promise<boolean>;
  actor?: ComanderoActor;
}) {
  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Inputs como string para permitir edición libre. Validamos al cobrar.
  const [discountInput, setDiscountInput] = React.useState("");
  const [tipInput, setTipInput] = React.useState("");
  const [discountMode, setDiscountMode] = React.useState<"eur" | "pct">("eur");
  const [tipMode, setTipMode] = React.useState<"eur" | "pct">("pct");
  const [paying, setPaying] = React.useState(false);
  const [showSplit, setShowSplit] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/comandero/tables/${encodeURIComponent(tableNumber)}/ticket`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Error ${r.status}`);
        return;
      }
      setTicket((await r.json()) as Ticket);
    } finally {
      setLoading(false);
    }
  }, [tableNumber]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Computa céntimos de descuento/propina a partir de inputs + modo + total.
  const totalCents = ticket?.totals.total ?? 0;

  function parseAmountCents(raw: string, mode: "eur" | "pct", base: number): number {
    const n = Number(raw.replace(",", ".").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n < 0) return 0;
    if (mode === "pct") return Math.round((base * Math.min(100, n)) / 100);
    return Math.round(n * 100);
  }

  const discountCents = parseAmountCents(discountInput, discountMode, totalCents);
  const tipCents = parseAmountCents(tipInput, tipMode, totalCents);
  const finalToPay = Math.max(0, totalCents - discountCents + tipCents);

  // Agrupa líneas por pedido para que el mesero vea el "ticket".
  const linesByOrder = React.useMemo(() => {
    const map = new Map<string, TicketLine[]>();
    for (const l of ticket?.lines ?? []) {
      const arr = map.get(l.orderId) ?? [];
      arr.push(l);
      map.set(l.orderId, arr);
    }
    return map;
  }, [ticket]);

  async function handlePay(method: "cash" | "card") {
    if (paying) return;
    if (finalToPay > 0 && !confirm(`Cobrar ${formatEur(finalToPay)} a la mesa ${tableNumber} (${method === "cash" ? "efectivo" : "tarjeta"})?`)) return;
    setPaying(true);
    try {
      const ok = await onCobrar(method, { discountCents, tipCents });
      if (!ok) setError("No se pudo cerrar la mesa");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {actor ? <ActorTopBar actor={actor} /> : null}
      <main className="mx-auto max-w-2xl px-4 py-4">
        <header className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-stone-900">Mesa {tableNumber}</h1>
            <p className="text-xs text-stone-500">Cuenta y cobro</p>
          </div>
          <button
            type="button"
            onClick={onAddItems}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 active:scale-95"
          >
            <Plus size={14} />
            Añadir items
          </button>
        </header>

        {loading ? (
          <p className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">Cargando cuenta…</p>
        ) : error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">{error}</p>
        ) : !ticket || ticket.orders.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
            La mesa no tiene pedidos abiertos.
          </p>
        ) : (
          <>
            {/* Líneas agrupadas por pedido */}
            <section className="mb-4 rounded-xl border border-stone-200 bg-white">
              {Array.from(linesByOrder.entries()).map(([orderId, lines], idx) => (
                <div key={orderId} className={idx > 0 ? "border-t border-stone-100" : ""}>
                  <div className="flex items-baseline justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-stone-500">
                    <span>Pedido #{orderId.slice(0, 6)}</span>
                    <span>{lines.length} líneas</span>
                  </div>
                  <ul className="divide-y divide-stone-100">
                    {lines.map((l, i) => {
                      const mods = (l.modifiersJson ?? []).map((m) => m.name).join(", ");
                      return (
                        <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="font-medium text-stone-900">{l.quantity}×</span>
                              <span className="text-stone-800">{l.name}</span>
                            </div>
                            {mods && <div className="ml-6 text-xs text-stone-500">{mods}</div>}
                            {l.notes && <div className="ml-6 text-xs italic text-stone-500">{l.notes}</div>}
                          </div>
                          <span className="text-sm tabular-nums text-stone-700">{formatEur(l.lineTotalCents)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>

            {/* Totales + ajustes */}
            <section className="mb-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
              <div className="space-y-1.5 p-5 text-sm">
                <div className="flex justify-between text-stone-500">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatEur(ticket.totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-stone-500">
                  <span>IVA</span>
                  <span className="font-mono tabular-nums">{formatEur(ticket.totals.tax)}</span>
                </div>
                <div className="mt-1.5 flex justify-between border-t border-stone-100 pt-2 font-semibold text-stone-900">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatEur(ticket.totals.total)}</span>
                </div>
              </div>

              <div className="grid gap-3 border-t border-stone-100 bg-stone-50/40 p-5">
                <AdjustmentInput
                  label="Descuento"
                  value={discountInput}
                  onChange={setDiscountInput}
                  mode={discountMode}
                  onModeChange={setDiscountMode}
                  computedCents={discountCents}
                  accent="rose"
                />
                <AdjustmentInput
                  label="Propina"
                  value={tipInput}
                  onChange={setTipInput}
                  mode={tipMode}
                  onModeChange={setTipMode}
                  computedCents={tipCents}
                  accent="emerald"
                />
              </div>

              <div className="flex items-baseline justify-between gap-4 bg-gradient-to-r from-emerald-50 to-emerald-100/60 px-5 py-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-900">
                  A pagar
                </span>
                <span className="font-mono text-3xl font-bold tabular-nums text-emerald-900">
                  {formatEur(finalToPay)}
                </span>
              </div>
            </section>

            {/* Cobrar — botones grandes estilo POS profesional */}
            <section className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={paying}
                onClick={() => handlePay("cash")}
                className="rounded-2xl bg-emerald-600 px-4 py-5 text-base font-semibold text-white shadow-md transition hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              >
                <span className="mr-1">💵</span> Efectivo
              </button>
              <button
                type="button"
                disabled={paying}
                onClick={() => handlePay("card")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-4 py-5 text-base font-semibold text-white shadow-md transition hover:bg-neutral-800 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              >
                <CreditCard size={18} /> Tarjeta
              </button>
            </section>

            <button
              type="button"
              onClick={() => setShowSplit(true)}
              className="mt-3 w-full rounded-2xl border-2 border-dashed border-stone-300 bg-white px-4 py-3.5 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-50 active:scale-[0.98]"
            >
              👥 Dividir cuenta entre varios clientes
            </button>
          </>
        )}

        {showSplit && ticket && (
          <SplitBillDialog
            tableNumber={tableNumber}
            ticket={ticket}
            onClose={() => setShowSplit(false)}
            onClosed={() => {
              setShowSplit(false);
              onBack();
            }}
          />
        )}
      </main>
    </div>
  );
}

function AdjustmentInput({
  label,
  value,
  onChange,
  mode,
  onModeChange,
  computedCents,
  accent,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mode: "eur" | "pct";
  onModeChange: (m: "eur" | "pct") => void;
  computedCents: number;
  accent: "rose" | "emerald";
}) {
  const accentBg = accent === "rose" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700";
  return (
    <div className={`rounded-lg border p-3 ${accentBg}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        <span className="text-xs tabular-nums">{formatEur(computedCents)}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        />
        <div className="inline-flex rounded-md border border-stone-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => onModeChange("eur")}
            className={`rounded px-2 py-1 text-xs ${mode === "eur" ? "bg-stone-900 text-white" : "text-stone-600"}`}
          >
            €
          </button>
          <button
            type="button"
            onClick={() => onModeChange("pct")}
            className={`rounded px-2 py-1 text-xs ${mode === "pct" ? "bg-stone-900 text-white" : "text-stone-600"}`}
          >
            %
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SplitBillDialog (Mig 055) ──────────────────────────────────────
// Dividir cuenta entre N comensales. 3 modos:
//   - equal: divide finalToPay entre N partes iguales
//   - amount: el mesero introduce el monto exacto a cobrar (split por monto libre)
//   - item: marca order_items concretos que cubre la subcuenta
//
// Cada subcuenta se persiste como `pending` y el mesero la cobra de uno en uno.
// Cuando la suma de pagados >= finalToPay, todos los orders dine_in abiertos
// se marcan paid y la mesa se libera.
type SplitPaymentRow = {
  id: string;
  splitKind: "item" | "amount" | "equal";
  amountCents: number;
  paymentMethod: string;
  status: "pending" | "paid" | "voided";
  label: string | null;
  paidAt: string | null;
};

function SplitBillDialog({
  tableNumber,
  ticket,
  onClose,
  onClosed,
}: {
  tableNumber: string;
  ticket: Ticket;
  onClose: () => void;
  onClosed: () => void;
}) {
  type SplitMode = "equal" | "amount" | "item";
  const [mode, setMode] = React.useState<SplitMode>("equal");
  const [partyCount, setPartyCount] = React.useState(2);
  const [amountInput, setAmountInput] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<"cash" | "card">("cash");
  const [label, setLabel] = React.useState("");
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [payments, setPayments] = React.useState<SplitPaymentRow[]>([]);
  const [remainingCents, setRemainingCents] = React.useState<number>(ticket.totals.finalToPay);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    const r = await fetch(`/api/comandero/tables/${encodeURIComponent(tableNumber)}/split`, { cache: "no-store" });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Error ${r.status}`);
      return;
    }
    const json = (await r.json()) as { payments: SplitPaymentRow[]; totals: { remaining: number } };
    setPayments(json.payments);
    setRemainingCents(json.totals.remaining);
  }, [tableNumber]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  // Build itemKey for the per-item split (stable across renders).
  const itemKeys = React.useMemo(() => {
    return ticket.lines.map((l, idx) => `${l.orderId}:${idx}`);
  }, [ticket.lines]);

  function toggleItem(key: string) {
    setSelectedItems((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Compute amount based on mode.
  const computedAmount = React.useMemo(() => {
    if (mode === "equal") {
      const n = Math.max(1, Math.floor(partyCount));
      return Math.floor(remainingCents / n);
    }
    if (mode === "amount") {
      const n = Number(amountInput.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.round(n * 100);
    }
    // item mode
    let total = 0;
    for (const key of selectedItems) {
      const idx = itemKeys.indexOf(key);
      if (idx >= 0) {
        const line = ticket.lines[idx];
        total += line.lineTotalCents;
      }
    }
    return total;
  }, [mode, partyCount, amountInput, remainingCents, selectedItems, itemKeys, ticket.lines]);

  async function createPayment() {
    if (computedAmount <= 0) {
      setError("Monto inválido");
      return;
    }
    if (computedAmount > remainingCents + 1) {
      setError(`Excede lo que queda por pagar (${formatEur(remainingCents)})`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const items = mode === "item"
        ? Array.from(selectedItems).map((key) => {
            const idx = itemKeys.indexOf(key);
            const l = ticket.lines[idx];
            return {
              orderId: l.orderId,
              name: l.name,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
            };
          })
        : undefined;
      const r = await fetch(`/api/comandero/tables/${encodeURIComponent(tableNumber)}/split`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          splitKind: mode,
          amountCents: computedAmount,
          paymentMethod,
          items,
          label: label.trim() || null,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Error ${r.status}`);
        return;
      }
      setLabel("");
      setSelectedItems(new Set());
      setAmountInput("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function payNow(paymentId: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/comandero/tables/${encodeURIComponent(tableNumber)}/split/${paymentId}/pay`,
        { method: "PATCH" },
      );
      const data = (await r.json().catch(() => ({}))) as { error?: string; tableClosed?: boolean };
      if (!r.ok) {
        setError(data.error ?? `Error ${r.status}`);
        return;
      }
      if (data.tableClosed) {
        onClosed();
        return;
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(paymentId: string) {
    if (!confirm("¿Cancelar esta subcuenta?")) return;
    setBusy(true);
    try {
      await fetch(
        `/api/comandero/tables/${encodeURIComponent(tableNumber)}/split?id=${paymentId}`,
        { method: "DELETE" },
      );
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-2 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-stone-900">Dividir cuenta · Mesa {tableNumber}</h3>
            <p className="text-xs text-stone-500">Quedan {formatEur(remainingCents)} por cobrar</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Subcuentas existentes */}
          {payments.length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-stone-500">Subcuentas</h4>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-stone-900">{formatEur(p.amountCents)}</span>
                        <span className="text-xs text-stone-500">{p.paymentMethod === "cash" ? "Efectivo" : "Tarjeta"}</span>
                        {p.label && <span className="text-xs text-stone-600">· {p.label}</span>}
                      </div>
                      <span className={`text-[10px] font-medium uppercase ${p.status === "paid" ? "text-emerald-600" : "text-amber-600"}`}>
                        {p.status === "paid" ? "Pagado" : "Pendiente"}
                      </span>
                    </div>
                    {p.status === "pending" && (
                      <div className="flex gap-1">
                        <button type="button" disabled={busy} onClick={() => payNow(p.id)} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Cobrar</button>
                        <button type="button" disabled={busy} onClick={() => voidPayment(p.id)} className="rounded border border-stone-300 px-2.5 py-1 text-xs text-stone-700 disabled:opacity-50"><Trash2 size={12} /></button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Nueva subcuenta */}
          <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-violet-700">Nueva subcuenta</h4>

            {/* Mode tabs */}
            <div className="mb-3 flex gap-1 rounded-md border border-stone-200 bg-white p-0.5 text-xs">
              {(["equal", "amount", "item"] as SplitMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1.5 ${mode === m ? "bg-stone-900 text-white" : "text-stone-700"}`}
                >
                  {m === "equal" ? "Partes iguales" : m === "amount" ? "Monto libre" : "Por items"}
                </button>
              ))}
            </div>

            {mode === "equal" && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm text-stone-700">¿Entre cuántos?</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={partyCount}
                  onChange={(e) => setPartyCount(Number(e.target.value) || 1)}
                  className="w-20 rounded-md border border-stone-300 px-2 py-1 text-sm"
                />
                <span className="ml-auto text-sm font-semibold text-stone-900">{formatEur(computedAmount)}</span>
              </div>
            )}
            {mode === "amount" && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm text-stone-700">€</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="0,00"
                  className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm"
                />
                <span className="text-sm font-semibold text-stone-900">{formatEur(computedAmount)}</span>
              </div>
            )}
            {mode === "item" && (
              <div className="mb-3 max-h-48 overflow-y-auto rounded-md border border-stone-200 bg-white">
                <ul className="divide-y divide-stone-100 text-sm">
                  {ticket.lines.map((l, idx) => {
                    const key = itemKeys[idx];
                    const checked = selectedItems.has(key);
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleItem(key)} className="h-4 w-4 accent-violet-600" />
                          <span className="flex-1">{l.quantity}× {l.name}</span>
                          <span className="text-stone-700 tabular-nums">{formatEur(l.lineTotalCents)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="border-t border-stone-200 bg-stone-50 px-3 py-2 text-right text-sm font-semibold">
                  Total seleccionado: {formatEur(computedAmount)}
                </div>
              </div>
            )}

            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Etiqueta (Mario, Cliente 1…)"
                maxLength={80}
                className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm"
              />
              <div className="inline-flex rounded-md border border-stone-300 p-0.5">
                <button type="button" onClick={() => setPaymentMethod("cash")} className={`rounded px-2 py-1 text-xs ${paymentMethod === "cash" ? "bg-emerald-600 text-white" : "text-stone-700"}`}>Efectivo</button>
                <button type="button" onClick={() => setPaymentMethod("card")} className={`rounded px-2 py-1 text-xs ${paymentMethod === "card" ? "bg-stone-900 text-white" : "text-stone-700"}`}>Tarjeta</button>
              </div>
            </div>

            <button
              type="button"
              disabled={busy || computedAmount <= 0}
              onClick={createPayment}
              className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              + Añadir subcuenta {formatEur(computedAmount)}
            </button>
          </section>

          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
