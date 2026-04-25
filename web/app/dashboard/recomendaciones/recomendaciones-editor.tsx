"use client";

// Editor de recomendaciones + upsell flags (mig 046).
// Optimistic UI: cada toggle hace fetch al API y revierte el estado si falla.

import { useMemo, useState, useTransition } from "react";

type Item = {
  id: string;
  category: string;
  name: string;
  priceCents: number;
  description: string | null;
  available: boolean;
  isRecommended: boolean;
  sortOrder: number;
};

type UpsellConfig = {
  suggestStarterWithMain: boolean;
  suggestDessertAtClose: boolean;
  suggestPairing: boolean;
};

type Props = {
  initialItems: Item[];
  initialUpsellConfig: UpsellConfig;
};

function euros(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function RecomendacionesEditor({ initialItems, initialUpsellConfig }: Props) {
  const [items, setItems] = useState(initialItems);
  const [upsell, setUpsell] = useState(initialUpsellConfig);
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const cat = it.category || "Otros";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  const recCount = items.filter((i) => i.isRecommended).length;
  const anyFlagOn = upsell.suggestStarterWithMain || upsell.suggestDessertAtClose || upsell.suggestPairing;

  async function toggleRecommend(item: Item) {
    const next = !item.isRecommended;
    // Optimistic update.
    setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, isRecommended: next } : x)));
    setError(null);
    try {
      const res = await fetch(`/api/tenant/menu/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRecommended: next }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "error"));
    } catch (e) {
      // Revertir.
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, isRecommended: !next } : x)));
      setError("No se pudo guardar. Intenta de nuevo.");
      console.error(e);
    }
  }

  async function toggleFlag(key: keyof UpsellConfig) {
    const next = { ...upsell, [key]: !upsell[key] };
    setUpsell(next);
    setError(null);
    try {
      const res = await fetch(`/api/agent/upsell`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "error"));
    } catch (e) {
      setUpsell(upsell);
      setError("No se pudo guardar la configuración. Intenta de nuevo.");
      console.error(e);
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Panel de flags upsell */}
      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">Sugerencias proactivas</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Cuando activas un flag, el mesero ofrecerá un item ⭐ recomendado en ese momento concreto.
          Si no hay ningún item marcado como recomendado, las sugerencias quedan desactivadas
          (el bot nunca inventa).
        </p>

        {!recCount && anyFlagOn && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Tienes flags activos pero ningún plato marcado como ⭐ recomendado.
            Marca al menos uno abajo para que el bot empiece a sugerir.
          </div>
        )}

        <div className="mt-4 space-y-3">
          <ToggleRow
            label="Sugerir un entrante cuando el cliente pide solo plato principal"
            hint="Ej: pide solo 'Hamburguesa Dacoka' — el bot ofrece un entrante ⭐ antes de cerrar."
            checked={upsell.suggestStarterWithMain}
            onChange={() => startTransition(() => { toggleFlag("suggestStarterWithMain"); })}
          />
          <ToggleRow
            label="Sugerir un postre antes de cerrar el pedido"
            hint="Cuando el cliente dice 'nada más', el bot pregunta: '¿Dejamos hueco para un postre?'"
            checked={upsell.suggestDessertAtClose}
            onChange={() => startTransition(() => { toggleFlag("suggestDessertAtClose"); })}
          />
          <ToggleRow
            label="Sugerir maridaje de bebida"
            hint="Cuando el cliente elige principal sin bebida, el bot ofrece una copa ⭐."
            checked={upsell.suggestPairing}
            onChange={() => startTransition(() => { toggleFlag("suggestPairing"); })}
          />
        </div>
      </section>

      {/* Carta con checkboxes */}
      <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Tu carta — marca las recomendaciones</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {recCount > 0
                ? `${recCount} ${recCount === 1 ? "item marcado" : "items marcados"} ⭐`
                : "Ningún item marcado todavía"}
              . Los cambios se aplican al instante — el mesero leerá tus ⭐ en el siguiente mensaje.
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            Tu carta está vacía. Añade platos desde{" "}
            <a href="/dashboard/carta" className="font-medium text-neutral-900 underline">
              /dashboard/carta
            </a>{" "}
            y vuelve aquí a marcar recomendaciones.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {grouped.map(([cat, rows]) => (
              <div key={cat}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{cat}</h3>
                <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                  {rows.map((it) => (
                    <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <label className="flex flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={it.isRecommended}
                          onChange={() => startTransition(() => { toggleRecommend(it); })}
                          className="h-5 w-5 rounded border-neutral-300 text-amber-500 focus:ring-amber-400"
                        />
                        <span className="flex-1">
                          <span className="text-[15px] font-medium text-neutral-900">
                            {it.isRecommended && <span className="mr-1">⭐</span>}
                            {it.name}
                          </span>
                          {it.description && (
                            <span className="block text-[13px] text-neutral-500">{it.description}</span>
                          )}
                        </span>
                      </label>
                      <span className="text-sm tabular-nums text-neutral-700">{euros(it.priceCents)}</span>
                      {!it.available && (
                        <span className="text-[11px] font-medium uppercase text-neutral-400">Agotado</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-5 w-5 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-neutral-900">{label}</span>
        <span className="mt-0.5 block text-[13px] text-neutral-500">{hint}</span>
      </span>
    </label>
  );
}
