"use client";

import * as React from "react";

type Contact = {
  id: string;
  phone: string;
  label: string;
  kind: string;
  notes: string | null;
};

type Draft = { phone: string; label: string; kind: "proveedor" | "comercial" | "otro"; notes: string };
const EMPTY: Draft = { phone: "", label: "", kind: "proveedor", notes: "" };

export function SuppliersEditor({ initial }: { initial: Contact[] }) {
  const [contacts, setContacts] = React.useState<Contact[]>(initial);
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    if (busy || !draft.phone.trim() || !draft.label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tenant/non-customer-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: draft.phone.trim(),
          label: draft.label.trim(),
          kind: draft.kind,
          notes: draft.notes.trim() || null,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body.detail ?? body.error ?? `HTTP ${r.status}`);
        return;
      }
      const list = await fetch("/api/tenant/non-customer-contacts", { cache: "no-store" });
      const data = (await list.json()) as { contacts: Contact[] };
      setContacts(data.contacts ?? []);
      setDraft(EMPTY);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este contacto?")) return;
    const r = await fetch(`/api/tenant/non-customer-contacts/${id}`, { method: "DELETE" });
    if (r.ok) setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Añadir contacto</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Teléfono</label>
            <input
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              placeholder="+34 612 345 678"
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Nombre o empresa</label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Makro, Coca-Cola, Comercial X"
              maxLength={100}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Tipo</label>
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
            >
              <option value="proveedor">Proveedor</option>
              <option value="comercial">Comercial de venta</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Notas (opcional)</label>
            <input
              type="text"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={add}
            disabled={busy || !draft.phone.trim() || !draft.label.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Añadir"}
          </button>
          {error && <span className="self-center text-xs text-rose-700">{error}</span>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Contactos ({contacts.length})</h2>
        {contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            Aún no hay contactos. Añade el primero arriba.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{c.label}</span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                      {c.kind}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">+{c.phone}</div>
                  {c.notes && <p className="mt-1 text-xs text-neutral-500">{c.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
