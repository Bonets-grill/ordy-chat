"use client";

// Editor de la biblioteca de modificadores (mig 051).
//
// UX:
//   - Lista de grupos a la izquierda. Click en uno abre panel detalle a la
//     derecha con sus opciones + dialog "Asignar a productos".
//   - "+ Nuevo grupo" abre form inline con nombre + tipo + opciones iniciales.
//   - Cada cambio dispara fetch al API y refleja optimista. Error → revierte.

import * as React from "react";

type Option = {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  available: boolean;
  sortOrder: number;
  // Campos extra que el server envía pero el cliente ignora — solo declarados
  // para que el inferencer Drizzle case con esta forma sin TS2322.
  i18nTranslations?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

type Group = {
  id: string;
  tenantId: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: Option[];
  assignedMenuItemIds: string[];
  i18nTranslations?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

type Item = {
  id: string;
  category: string;
  name: string;
  priceCents: number;
};

function formatDelta(cents: number): string {
  if (cents === 0) return "gratis";
  return `+${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

function parsePriceDelta(raw: string): number | null {
  const cleaned = raw.replace(",", ".").replace(/[+€\s]/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function ModifierGroupsEditor({
  initialGroups,
  allItems,
}: {
  initialGroups: Group[];
  allItems: Item[];
}) {
  const [groups, setGroups] = React.useState<Group[]>(initialGroups);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialGroups[0]?.id ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [assignDialogFor, setAssignDialogFor] = React.useState<string | null>(null);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  function flash(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }

  async function createGroup(payload: {
    name: string;
    selectionType: "single" | "multi";
    required: boolean;
    options: Array<{ name: string; priceDeltaCents: number }>;
  }) {
    const res = await fetch("/api/tenant/modifier-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(body.error === "name_taken" ? "Ya existe un grupo con ese nombre." : `Error: ${body.error ?? res.status}`);
      return false;
    }
    setGroups((g) => [...g, body.group]);
    setSelectedId(body.group.id);
    setCreating(false);
    return true;
  }

  async function deleteGroup(id: string) {
    if (!confirm("¿Borrar este grupo? Se desvinculará de todos los productos.")) return;
    const res = await fetch(`/api/tenant/modifier-groups/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash(`Error borrando: ${body.error ?? res.status}`);
      return;
    }
    setGroups((g) => g.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function addOption(groupId: string, draft: { name: string; priceDeltaCents: number }) {
    const res = await fetch(`/api/tenant/modifier-groups/${groupId}/options`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(`Error añadiendo opción: ${body.error ?? res.status}`);
      return;
    }
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, options: [...g.options, body.option] } : g)),
    );
  }

  async function deleteOption(groupId: string, optionId: string) {
    const res = await fetch(`/api/tenant/modifier-groups/${groupId}/options/${optionId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash(`Error: ${body.error ?? res.status}`);
      return;
    }
    setGroups((gs) =>
      gs.map((g) =>
        g.id === groupId ? { ...g, options: g.options.filter((o) => o.id !== optionId) } : g,
      ),
    );
  }

  async function saveAssignments(groupId: string, menuItemIds: string[]) {
    const res = await fetch(`/api/tenant/modifier-groups/${groupId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ menuItemIds, append: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash(`Error guardando asignaciones: ${body.error ?? res.status}`);
      return;
    }
    setGroups((gs) =>
      gs.map((g) => (g.id === groupId ? { ...g, assignedMenuItemIds: menuItemIds } : g)),
    );
    setAssignDialogFor(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100"
        >
          + Nuevo grupo
        </button>
        {groups.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-600">
            Aún no tienes grupos. Crea el primero — por ejemplo "Tamaño" con opciones S/M/L.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(g.id)}
                  className={`flex w-full flex-col items-start rounded-xl border px-3 py-2.5 text-left transition ${
                    selectedId === g.id
                      ? "border-violet-400 bg-violet-50"
                      : "border-stone-200 bg-white hover:bg-stone-50"
                  }`}
                >
                  <span className="text-sm font-medium text-stone-900">{g.name}</span>
                  <span className="text-xs text-stone-500">
                    {g.selectionType === "single" ? "Elegir 1" : "Elegir varias"} · {g.options.length} opciones · usado en {g.assignedMenuItemIds.length} productos
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        {creating ? (
          <NewGroupForm onCancel={() => setCreating(false)} onCreate={createGroup} />
        ) : selected ? (
          <GroupDetail
            group={selected}
            allItems={allItems}
            onDelete={() => deleteGroup(selected.id)}
            onAddOption={(d) => addOption(selected.id, d)}
            onDeleteOption={(id) => deleteOption(selected.id, id)}
            onOpenAssign={() => setAssignDialogFor(selected.id)}
          />
        ) : (
          <p className="text-sm text-stone-500">Selecciona un grupo a la izquierda o crea uno nuevo.</p>
        )}
      </section>

      {error && (
        <div className="fixed bottom-6 right-6 rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {assignDialogFor && (
        <AssignDialog
          group={groups.find((g) => g.id === assignDialogFor)!}
          allItems={allItems}
          onClose={() => setAssignDialogFor(null)}
          onSave={(ids) => saveAssignments(assignDialogFor, ids)}
        />
      )}
    </div>
  );
}

function NewGroupForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (p: {
    name: string;
    selectionType: "single" | "multi";
    required: boolean;
    options: Array<{ name: string; priceDeltaCents: number }>;
  }) => Promise<boolean>;
}) {
  const [name, setName] = React.useState("");
  const [selectionType, setSelectionType] = React.useState<"single" | "multi">("single");
  const [required, setRequired] = React.useState(false);
  const [draftOpts, setDraftOpts] = React.useState<Array<{ name: string; priceDeltaCents: number }>>(
    [],
  );
  const [optName, setOptName] = React.useState("");
  const [optPrice, setOptPrice] = React.useState("");

  function addOpt() {
    if (!optName.trim()) return;
    const cents = parsePriceDelta(optPrice);
    if (cents === null) return;
    setDraftOpts((o) => [...o, { name: optName.trim(), priceDeltaCents: cents }]);
    setOptName("");
    setOptPrice("");
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onCreate({ name: name.trim(), selectionType, required, options: draftOpts });
      }}
      className="flex flex-col gap-4"
    >
      <h3 className="text-base font-semibold text-stone-900">Nuevo grupo de modificadores</h3>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-stone-700">Nombre</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tamaño, Extras, Quitar ingredientes…"
          required
          maxLength={120}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-stone-700">Tipo</span>
          <select
            value={selectionType}
            onChange={(e) => setSelectionType(e.target.value as "single" | "multi")}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          >
            <option value="single">Elegir 1 (radio)</option>
            <option value="multi">Elegir varias (checkbox)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          Obligatorio elegir
        </label>
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="mb-2 text-xs font-medium text-stone-700">Opciones iniciales (puedes añadir más después)</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={optName}
            onChange={(e) => setOptName(e.target.value)}
            placeholder="S, Bacon, Sin cebolla…"
            className="flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            value={optPrice}
            onChange={(e) => setOptPrice(e.target.value)}
            placeholder="0,00 €"
            className="w-28 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={addOpt}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-100"
          >
            +
          </button>
        </div>
        {draftOpts.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {draftOpts.map((o, i) => (
              <li key={i} className="flex justify-between text-stone-700">
                <span>{o.name}</span>
                <span className="text-stone-500">{formatDelta(o.priceDeltaCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          Crear grupo
        </button>
      </div>
    </form>
  );
}

function GroupDetail({
  group,
  allItems,
  onDelete,
  onAddOption,
  onDeleteOption,
  onOpenAssign,
}: {
  group: Group;
  allItems: Item[];
  onDelete: () => void;
  onAddOption: (d: { name: string; priceDeltaCents: number }) => Promise<void>;
  onDeleteOption: (id: string) => Promise<void>;
  onOpenAssign: () => void;
}) {
  const [optName, setOptName] = React.useState("");
  const [optPrice, setOptPrice] = React.useState("");

  const assignedItems = allItems.filter((it) => group.assignedMenuItemIds.includes(it.id));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">{group.name}</h2>
          <p className="mt-1 text-sm text-stone-600">
            {group.selectionType === "single" ? "El cliente elige 1" : "El cliente puede elegir varias"}
            {group.required ? " · obligatorio" : " · opcional"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
        >
          Borrar grupo
        </button>
      </header>

      <section>
        <h3 className="mb-2 text-sm font-medium text-stone-800">Opciones</h3>
        {group.options.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-500">
            Aún sin opciones. Añade al menos una abajo.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200">
            {group.options.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-stone-800">{o.name}</span>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-stone-500">{formatDelta(o.priceDeltaCents)}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteOption(o.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!optName.trim()) return;
            const cents = parsePriceDelta(optPrice);
            if (cents === null) return;
            await onAddOption({ name: optName.trim(), priceDeltaCents: cents });
            setOptName("");
            setOptPrice("");
          }}
        >
          <input
            type="text"
            value={optName}
            onChange={(e) => setOptName(e.target.value)}
            placeholder="Nueva opción"
            className="flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <input
            type="text"
            value={optPrice}
            onChange={(e) => setOptPrice(e.target.value)}
            placeholder="0,00 €"
            className="w-28 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
          >
            Añadir
          </button>
        </form>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-stone-800">Productos asignados ({assignedItems.length})</h3>
          <button
            type="button"
            onClick={onOpenAssign}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
          >
            Asignar a productos
          </button>
        </div>
        {assignedItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-500">
            Sin productos asignados. Pulsa "Asignar a productos" para añadir.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {assignedItems.map((it) => (
              <span
                key={it.id}
                className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-700"
              >
                {it.name}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AssignDialog({
  group,
  allItems,
  onClose,
  onSave,
}: {
  group: Group;
  allItems: Item[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set(group.assignedMenuItemIds));
  const [filter, setFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const filtered = filter
    ? allItems.filter((it) => it.name.toLowerCase().includes(filter.toLowerCase()))
    : allItems;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((s) => {
      const next = new Set(s);
      for (const it of filtered) next.add(it.id);
      return next;
    });
  }

  function clearAllVisible() {
    setSelected((s) => {
      const next = new Set(s);
      for (const it of filtered) next.delete(it.id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h3 className="text-base font-semibold text-stone-900">Asignar "{group.name}" a productos</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
          >
            ✕
          </button>
        </header>
        <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar…"
            className="flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
          >
            Marcar todo
          </button>
          <button
            type="button"
            onClick={clearAllVisible}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50"
          >
            Desmarcar todo
          </button>
        </div>
        <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
          {filtered.map((it) => (
            <li key={it.id}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-stone-50">
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={() => toggle(it.id)}
                  className="h-4 w-4 accent-violet-600"
                />
                <span className="flex-1 text-sm text-stone-800">{it.name}</span>
                <span className="text-xs text-stone-500">{it.category}</span>
              </label>
            </li>
          ))}
        </ul>
        <footer className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <span className="text-xs text-stone-500">{selected.size} seleccionados</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await onSave(Array.from(selected));
                setSaving(false);
              }}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
