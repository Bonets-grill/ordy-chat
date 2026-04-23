"use client";

// web/app/dashboard/carta/carta-editor.tsx
// Cliente: importar desde URL + CRUD manual de items por categoría.

import * as React from "react";

type MenuItem = {
  id: string;
  category: string;
  name: string;
  priceCents: number;
  description: string | null;
  imageUrl: string | null;
  available: boolean;
  sortOrder: number;
  source: string;
};

type Draft = {
  id?: string;
  category: string;
  name: string;
  priceCents: number;
  description: string;
  available: boolean;
};

const EMPTY_DRAFT: Draft = {
  category: "Otros",
  name: "",
  priceCents: 0,
  description: "",
  available: true,
};

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(",", ".").replace(/[€\s]/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function CartaEditor({ initial }: { initial: MenuItem[] }) {
  const [items, setItems] = React.useState<MenuItem[]>(initial);
  const [importUrl, setImportUrl] = React.useState("");
  const [importBusy, setImportBusy] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT);
  const [draftBusy, setDraftBusy] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Agrupar por categoría manteniendo el orden de aparición.
  const grouped = React.useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return map;
  }, [items]);

  async function importFromUrl() {
    if (!importUrl.trim() || importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const replaceExisting =
        items.length === 0 ||
        confirm(
          `Tienes ${items.length} items en la carta. ¿Reemplazarlos todos por los importados? (Cancelar = añadir al final)`,
        );
      const res = await fetch("/api/tenant/menu/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim(), replaceExisting }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      // Recargar lista completa.
      const list = await fetch("/api/tenant/menu", { cache: "no-store" });
      const data = (await list.json()) as { items: MenuItem[] };
      setItems(data.items ?? []);
      setImportUrl("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "error");
    } finally {
      setImportBusy(false);
    }
  }

  async function saveDraft() {
    if (draftBusy) return;
    setDraftBusy(true);
    setDraftError(null);
    try {
      const payload = {
        category: draft.category.trim() || "Otros",
        name: draft.name.trim(),
        priceCents: draft.priceCents,
        description: draft.description.trim() || null,
        available: draft.available,
      };
      if (!payload.name) {
        setDraftError("Nombre requerido");
        return;
      }
      let res: Response;
      if (editingId) {
        res = await fetch(`/api/tenant/menu/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/tenant/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDraftError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      const list = await fetch("/api/tenant/menu", { cache: "no-store" });
      const data = (await list.json()) as { items: MenuItem[] };
      setItems(data.items ?? []);
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
    } finally {
      setDraftBusy(false);
    }
  }

  // Status por-item para feedback visual durante delete/toggle. null cuando
  // no hay acción en curso, string cuando hay error.
  const [rowStatus, setRowStatus] = React.useState<Record<string, "busy" | string>>({});
  const setRowBusy = (id: string, v: "busy" | string | null) =>
    setRowStatus((prev) => {
      const next = { ...prev };
      if (v === null) delete next[id];
      else next[id] = v;
      return next;
    });

  // Toast global al top de la página para feedback ultra-visible (Mario
  // reportó que "no funciona" aunque la feedback inline ya existía — el
  // toast vive aquí fuera del row). null = sin toast.
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  async function deleteItem(id: string) {
    if (!confirm("¿Borrar este item?")) return;
    setRowBusy(id, "busy");
    // eslint-disable-next-line no-console
    console.log("[carta] delete", id);
    try {
      const res = await fetch(`/api/tenant/menu/${id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        setRowBusy(id, null);
        setToast({ kind: "ok", msg: "Item borrado" });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const err = `borrar falló: ${body.error ?? `HTTP ${res.status}`}`;
      setRowBusy(id, err);
      setToast({ kind: "err", msg: err });
    } catch (e) {
      const err = `borrar falló: ${e instanceof Error ? e.message : "desconocido"}`;
      setRowBusy(id, err);
      setToast({ kind: "err", msg: err });
    }
  }

  async function toggleAvailable(it: MenuItem) {
    setRowBusy(it.id, "busy");
    // eslint-disable-next-line no-console
    console.log("[carta] toggle", it.id, "→", !it.available);
    try {
      const res = await fetch(`/api/tenant/menu/${it.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ available: !it.available }),
        cache: "no-store",
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((i) => (i.id === it.id ? { ...i, available: !i.available } : i)),
        );
        setRowBusy(it.id, null);
        setToast({
          kind: "ok",
          msg: !it.available ? "Item activado" : "Item marcado agotado",
        });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const err = `cambio falló: ${body.error ?? `HTTP ${res.status}`}`;
      setRowBusy(it.id, err);
      setToast({ kind: "err", msg: err });
    } catch (e) {
      const err = `cambio falló: ${e instanceof Error ? e.message : "desconocido"}`;
      setRowBusy(it.id, err);
      setToast({ kind: "err", msg: err });
    }
  }

  function startEdit(it: MenuItem) {
    setEditingId(it.id);
    setDraft({
      id: it.id,
      category: it.category,
      name: it.name,
      priceCents: it.priceCents,
      description: it.description ?? "",
      available: it.available,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      {/* Toast global fixed top — sobrevive 4s, feedback ultra-visible */}
      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
      {/* Importar desde URL */}
      <section className="rounded-xl border border-violet-200 bg-violet-50 p-5">
        <h2 className="text-lg font-semibold text-violet-900">Importar carta desde URL</h2>
        <p className="mt-1 text-sm text-violet-800/80">
          Pega el enlace de tu menú online (web del restaurante, Last.shop, ResyOrder, etc.) y
          extraeremos los items con sus precios automáticamente.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            disabled={importBusy}
            placeholder="https://..."
            className="flex-1 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="button"
            onClick={importFromUrl}
            disabled={importBusy || !importUrl.trim()}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {importBusy ? "Extrayendo…" : "Importar"}
          </button>
        </div>
        {importError && (
          <p className="mt-2 text-xs text-rose-700">Error: {importError}</p>
        )}
      </section>

      {/* Editor manual de item */}
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-neutral-900">
          {editingId ? "Editar item" : "Añadir item manualmente"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Categoría</label>
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              maxLength={80}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Nombre</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={200}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">Precio (€)</label>
            <input
              type="text"
              defaultValue={(draft.priceCents / 100).toFixed(2).replace(".", ",")}
              onChange={(e) => {
                const cents = parsePriceInput(e.target.value);
                if (cents !== null) setDraft({ ...draft, priceCents: cents });
              }}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="available"
              checked={draft.available}
              onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="available" className="text-sm text-neutral-700">Disponible</label>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wider text-neutral-600">
              Descripción (opcional)
            </label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              maxLength={500}
              className="mt-1 w-full resize-none rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400"
            />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={draftBusy || !draft.name.trim()}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {draftBusy ? "Guardando…" : editingId ? "Guardar cambios" : "Añadir a la carta"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
                setDraftError(null);
              }}
              disabled={draftBusy}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              Cancelar
            </button>
          )}
          {draftError && <span className="self-center text-xs text-rose-700">{draftError}</span>}
        </div>
      </section>

      {/* Lista de items */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">
          Items en la carta ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            Aún no hay items. Importa desde una URL o añade el primero manualmente.
          </p>
        ) : (
          <div className="space-y-5">
            {[...grouped.entries()].map(([category, list]) => (
              <div key={category}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-600">
                  {category} <span className="text-neutral-400">({list.length})</span>
                </h3>
                <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                  {list.map((it) => (
                    <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                      {/* Thumbnail si el scraper capturó imagen del item.
                          Cap a 56x56 para no romper el layout con fotos grandes. */}
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.imageUrl}
                          alt={it.name}
                          loading="lazy"
                          className={`h-14 w-14 shrink-0 rounded-md border border-neutral-200 bg-neutral-50 object-cover ${
                            it.available ? "" : "opacity-40 grayscale"
                          }`}
                          onError={(e) => {
                            // Si la URL está rota (CDN caído o redirect 404),
                            // ocultamos el thumbnail y no rompemos la fila.
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-neutral-50 text-[10px] text-neutral-400">
                          sin foto
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`font-medium ${it.available ? "text-neutral-900" : "text-neutral-400 line-through"}`}>
                            {it.name}
                          </span>
                          <span className="text-sm text-neutral-700">{formatPrice(it.priceCents)}</span>
                          {it.source !== "manual" && (
                            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-500">
                              {it.source}
                            </span>
                          )}
                        </div>
                        {it.description && (
                          <p className="mt-1 text-xs text-neutral-500">{it.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => toggleAvailable(it)}
                            disabled={rowStatus[it.id] === "busy"}
                            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
                            title={it.available ? "Marcar agotado" : "Marcar disponible"}
                          >
                            {rowStatus[it.id] === "busy"
                              ? "…"
                              : it.available
                                ? "Activo"
                                : "Inactivo"}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(it)}
                            disabled={rowStatus[it.id] === "busy"}
                            className="rounded px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteItem(it.id)}
                            disabled={rowStatus[it.id] === "busy"}
                            className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Borrar
                          </button>
                        </div>
                        {rowStatus[it.id] && rowStatus[it.id] !== "busy" && (
                          <span className="text-[11px] text-rose-600">
                            {rowStatus[it.id]}
                          </span>
                        )}
                      </div>
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
