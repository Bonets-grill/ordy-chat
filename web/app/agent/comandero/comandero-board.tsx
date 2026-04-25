"use client";

// Comandero board — mobile-first. 3 vistas:
//   1. tables   — grid de mesas con badge libre/ocupada.
//   2. menu     — al elegir mesa, carta + carrito + modificadores.
//   3. (post)   — confirma y vuelve a tables.

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Minus, Plus, ShoppingCart, Utensils } from "lucide-react";

type Modifier = { id: string; name: string; priceDeltaCents: number };
type ModifierGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
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

type View = "tables" | "menu";

const formatEur = (cents: number) =>
  `${(cents / 100).toFixed(2).replace(".", ",")} €`;

export function ComanderoBoard() {
  const router = useRouter();
  const [view, setView] = React.useState<View>("tables");
  const [tables, setTables] = React.useState<Table[]>([]);
  const [items, setItems] = React.useState<MenuItem[]>([]);
  const [tableNumber, setTableNumber] = React.useState<string | null>(null);
  const [cart, setCart] = React.useState<CartLine[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

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
    setTableNumber(t.number);
    setCart([]);
    setError(null);
    setView("menu");
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

  if (view === "tables") {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold text-neutral-900">Comandero</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Selecciona una mesa para tomar el pedido. Los pedidos van directos al KDS.
          </p>
        </header>

        {loading ? (
          <p className="text-sm text-neutral-500">Cargando mesas…</p>
        ) : tables.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 p-8 text-center">
            <p className="text-sm text-neutral-600">
              No tienes mesas configuradas. Ve a{" "}
              <a href="/agent/tables" className="font-medium text-brand-600 hover:underline">
                Mesas y QRs
              </a>{" "}
              para crearlas.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {tables.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTable(t)}
                  className={`w-full rounded-xl border p-4 text-left transition active:scale-95 ${
                    t.state === "occupied"
                      ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                      : "border-emerald-200 bg-emerald-50 hover:border-emerald-300"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold text-neutral-900">
                      {t.number}
                    </span>
                    <span className="text-xs text-neutral-500">
                      {t.seats} pax
                    </span>
                  </div>
                  {t.zone ? (
                    <div className="mt-1 text-xs text-neutral-500">{t.zone}</div>
                  ) : null}
                  <div className="mt-3 text-xs">
                    {t.state === "occupied" ? (
                      <span className="font-medium text-amber-800">
                        Ocupada · {t.openOrdersCount} pedido{t.openOrdersCount !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="font-medium text-emerald-800">Libre</span>
                    )}
                  </div>
                  {t.state === "occupied" && t.openTotalCents > 0 ? (
                    <div className="mt-1 text-xs text-neutral-700">
                      Acumulado: {formatEur(t.openTotalCents)}
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  // view === "menu"
  const itemsByCategory = React.useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const i of items) {
      const arr = m.get(i.category) ?? [];
      arr.push(i);
      m.set(i.category, arr);
    }
    return Array.from(m.entries());
  }, [items]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setView("tables");
            setTableNumber(null);
            setCart([]);
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
        <div className="space-y-6 pb-32">
          {itemsByCategory.map(([cat, list]) => (
            <section key={cat}>
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

      {/* Carrito flotante */}
      {cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white p-3 shadow-lg">
          <div className="mx-auto max-w-4xl">
            <details className="rounded-lg">
              <summary className="flex cursor-pointer items-center justify-between rounded-md bg-neutral-50 p-3">
                <span className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                  <ShoppingCart size={16} />
                  {cart.reduce((s, l) => s + l.qty, 0)} ítems
                </span>
                <span className="font-semibold text-neutral-900">
                  {formatEur(cartTotal)}
                </span>
              </summary>
              <ul className="mt-3 space-y-1 text-sm">
                {cart.map((l, i) => {
                  const item = itemsById.get(l.itemId);
                  if (!item) return null;
                  return (
                    <li key={i} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeQty(i, -1)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-6 text-center text-xs">{l.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(i, 1)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="flex-1 truncate text-xs">
                        {item.name}
                        {l.modifiers.length > 0 ? (
                          <span className="text-neutral-500">
                            {" "}
                            ({l.modifiers.map((m) => m.name).join(", ")})
                          </span>
                        ) : null}
                      </span>
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
    <li className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex gap-3 p-3">
        <div className="flex flex-1 flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-neutral-900">
              {item.isRecommended ? "⭐ " : ""}
              {item.name}
            </span>
            <span className="shrink-0 font-semibold text-neutral-900 tabular-nums">
              {formatEur(item.priceCents)}
            </span>
          </div>
          {item.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">
              {item.description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={quickAdd}
          aria-label={`Añadir ${item.name}`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full bg-neutral-900 text-white shadow active:scale-95"
        >
          <Plus size={18} />
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
    return item.modifierGroups.every((g) => {
      const set = selected[g.id] ?? new Set();
      if (g.required && set.size < g.minSelect) return false;
      if (g.maxSelect != null && set.size > g.maxSelect) return false;
      return true;
    });
  }

  function confirm() {
    const mods: CartLine["modifiers"] = [];
    for (const g of item.modifierGroups) {
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
      {item.modifierGroups.map((g) => (
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
