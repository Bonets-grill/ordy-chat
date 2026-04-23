"use client";

// Client editor del listado de mesas. CRUD contra /api/tenant/tables.
// Botón "Imprimir QRs" abre /agent/tables/print que usa window.print.

import * as React from "react";

type Table = {
  id: string;
  number: string;
  zone: string | null;
  seats: number;
  active: boolean;
  sortOrder: number;
};

type Draft = {
  number: string;
  zone: string;
  seats: number;
  active: boolean;
};

const EMPTY: Draft = { number: "", zone: "", seats: 4, active: true };

export function TablesEditor({
  initial,
  tenantSlug,
}: {
  initial: Table[];
  tenantSlug: string;
}) {
  const [tables, setTables] = React.useState<Table[]>(initial);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (busy) return;
    const n = draft.number.trim();
    if (!n) {
      setError("Número o nombre requerido");
      return;
    }
    if (!/^[A-Za-z0-9-]+$/.test(n)) {
      setError("Solo letras, dígitos y guión (ej. 5, T1, Terraza-3)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        number: n,
        zone: draft.zone.trim() || null,
        seats: draft.seats,
        active: draft.active,
      };
      const url = editingId ? `/api/tenant/tables/${editingId}` : "/api/tenant/tables";
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.detail ?? body.error ?? `HTTP ${r.status}`);
        return;
      }
      // Recargar lista.
      const list = await fetch("/api/tenant/tables", { cache: "no-store" });
      const data = (await list.json()) as { tables: Table[] };
      setTables(data.tables ?? []);
      setDraft(EMPTY);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar esta mesa?")) return;
    const r = await fetch(`/api/tenant/tables/${id}`, { method: "DELETE" });
    if (r.ok) setTables((prev) => prev.filter((t) => t.id !== id));
  }

  async function toggleActive(t: Table) {
    const r = await fetch(`/api/tenant/tables/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    if (r.ok) {
      setTables((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)),
      );
    }
  }

  function startEdit(t: Table) {
    setEditingId(t.id);
    setDraft({
      number: t.number,
      zone: t.zone ?? "",
      seats: t.seats,
      active: t.active,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      {/* Acciones rápidas */}
      {tables.length > 0 && (
        <section className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 p-4">
          <div>
            <h3 className="text-sm font-semibold text-violet-900">
              {tables.length} mesa{tables.length === 1 ? "" : "s"} configurada{tables.length === 1 ? "" : "s"}
            </h3>
            <p className="mt-1 text-xs text-violet-800/80">
              Cada QR enlaza a <code>/m/{tenantSlug}?mesa=&lt;número&gt;</code>.
            </p>
          </div>
          <a
            href="/agent/tables/print"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Imprimir QRs
          </a>
        </section>
      )}

      {/* Formulario */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">
          {editingId ? "Editar mesa" : "Añadir mesa"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">
              Número o nombre
            </label>
            <input
              type="text"
              value={draft.number}
              onChange={(e) => setDraft({ ...draft, number: e.target.value })}
              placeholder="5, T1, Terraza-3"
              maxLength={8}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">
              Zona (opcional)
            </label>
            <input
              type="text"
              value={draft.zone}
              onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
              placeholder="Terraza, Interior, Barra"
              maxLength={60}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">
              Capacidad
            </label>
            <input
              type="number"
              min={1}
              max={99}
              value={draft.seats}
              onChange={(e) => setDraft({ ...draft, seats: Number(e.target.value) || 4 })}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="table-active"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="table-active" className="text-sm text-neutral-700">
              Activa (acepta pedidos)
            </label>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !draft.number.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? "Guardando…" : editingId ? "Guardar cambios" : "Añadir mesa"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY);
                setError(null);
              }}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          )}
          {error && <span className="self-center text-xs text-rose-700">{error}</span>}
        </div>
      </section>

      {/* Lista */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">
          Mesas ({tables.length})
        </h2>
        {tables.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            Aún no hay mesas. Añade la primera arriba.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {tables.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-sm font-semibold text-neutral-700">
                  {t.number}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`font-medium ${t.active ? "text-neutral-900" : "text-neutral-400 line-through"}`}>
                      Mesa {t.number}
                    </span>
                    {t.zone && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                        {t.zone}
                      </span>
                    )}
                    <span className="text-xs text-neutral-500">
                      {t.seats} pers.
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => toggleActive(t)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                  >
                    {t.active ? "Activa" : "Inactiva"}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                  >
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
