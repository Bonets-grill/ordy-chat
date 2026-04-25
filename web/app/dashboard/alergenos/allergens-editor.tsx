"use client";

// Editor de la biblioteca de alérgenos (mig 051).
// Igual UX que el editor de modificadores: lista a la izquierda, detalle a
// la derecha, dialog "Asignar a productos" con multi-select y filtro.

import * as React from "react";

type Allergen = {
  id: string;
  tenantId: string;
  code: string;
  label: string;
  icon: string | null;
  sortOrder: number;
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

// Slug determinístico desde label. El usuario rara vez teclea el code a mano.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function AllergensEditor({
  initialAllergens,
  allItems,
}: {
  initialAllergens: Allergen[];
  allItems: Item[];
}) {
  const [allergens, setAllergens] = React.useState<Allergen[]>(initialAllergens);
  const [selectedId, setSelectedId] = React.useState<string | null>(initialAllergens[0]?.id ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [assignDialogFor, setAssignDialogFor] = React.useState<string | null>(null);

  const selected = allergens.find((a) => a.id === selectedId) ?? null;

  function flash(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }

  async function createAllergen(payload: { code: string; label: string; icon: string | null }) {
    const res = await fetch("/api/tenant/allergens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      flash(
        body.error === "code_taken"
          ? "Ya existe un alérgeno con ese código."
          : `Error: ${body.error ?? res.status}`,
      );
      return false;
    }
    setAllergens((a) => [...a, body.allergen]);
    setSelectedId(body.allergen.id);
    setCreating(false);
    return true;
  }

  async function deleteAllergen(id: string) {
    if (!confirm("¿Borrar este alérgeno? Se quitará de todos los productos.")) return;
    const res = await fetch(`/api/tenant/allergens/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash(`Error borrando: ${body.error ?? res.status}`);
      return;
    }
    setAllergens((a) => a.filter((x) => x.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function saveAssignments(allergenId: string, menuItemIds: string[]) {
    const res = await fetch(`/api/tenant/allergens/${allergenId}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ menuItemIds, append: false }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      flash(`Error guardando asignaciones: ${body.error ?? res.status}`);
      return;
    }
    setAllergens((arr) =>
      arr.map((a) => (a.id === allergenId ? { ...a, assignedMenuItemIds: menuItemIds } : a)),
    );
    setAssignDialogFor(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          + Nuevo alérgeno
        </button>
        {allergens.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-6 text-sm text-stone-600">
            Aún no tienes alérgenos. Empieza por los habituales: gluten, lactosa, frutos secos, huevo, pescado…
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allergens.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(a.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                    selectedId === a.id
                      ? "border-amber-400 bg-amber-50"
                      : "border-stone-200 bg-white hover:bg-stone-50"
                  }`}
                >
                  {a.icon && <span className="text-lg">{a.icon}</span>}
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-stone-900">{a.label}</span>
                    <span className="block text-xs text-stone-500">
                      {a.code} · usado en {a.assignedMenuItemIds.length} productos
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        {creating ? (
          <NewAllergenForm onCancel={() => setCreating(false)} onCreate={createAllergen} />
        ) : selected ? (
          <AllergenDetail
            allergen={selected}
            allItems={allItems}
            onDelete={() => deleteAllergen(selected.id)}
            onOpenAssign={() => setAssignDialogFor(selected.id)}
          />
        ) : (
          <p className="text-sm text-stone-500">
            Selecciona un alérgeno a la izquierda o crea uno nuevo.
          </p>
        )}
      </section>

      {error && (
        <div className="fixed bottom-6 right-6 rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {assignDialogFor && (
        <AssignDialog
          allergen={allergens.find((a) => a.id === assignDialogFor)!}
          allItems={allItems}
          onClose={() => setAssignDialogFor(null)}
          onSave={(ids) => saveAssignments(assignDialogFor, ids)}
        />
      )}
    </div>
  );
}

const COMMON_PRESETS: Array<{ code: string; label: string; icon: string }> = [
  { code: "gluten", label: "Gluten", icon: "🌾" },
  { code: "lactosa", label: "Lactosa", icon: "🥛" },
  { code: "huevo", label: "Huevo", icon: "🥚" },
  { code: "frutos_secos", label: "Frutos secos", icon: "🥜" },
  { code: "pescado", label: "Pescado", icon: "🐟" },
  { code: "marisco", label: "Marisco", icon: "🦐" },
  { code: "soja", label: "Soja", icon: "🌱" },
  { code: "apio", label: "Apio", icon: "🌿" },
  { code: "mostaza", label: "Mostaza", icon: "🟡" },
  { code: "sesamo", label: "Sésamo", icon: "·" },
  { code: "sulfitos", label: "Sulfitos", icon: "🍷" },
  { code: "cacahuetes", label: "Cacahuetes", icon: "🥜" },
  { code: "moluscos", label: "Moluscos", icon: "🐚" },
  { code: "altramuces", label: "Altramuces", icon: "🫘" },
];

function NewAllergenForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (p: { code: string; label: string; icon: string | null }) => Promise<boolean>;
}) {
  const [label, setLabel] = React.useState("");
  const [code, setCode] = React.useState("");
  const [icon, setIcon] = React.useState("");
  const [touchedCode, setTouchedCode] = React.useState(false);

  React.useEffect(() => {
    if (!touchedCode) setCode(slugify(label));
  }, [label, touchedCode]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim() || !code.trim()) return;
        await onCreate({ label: label.trim(), code: code.trim(), icon: icon.trim() || null });
      }}
      className="flex flex-col gap-4"
    >
      <h3 className="text-base font-semibold text-stone-900">Nuevo alérgeno</h3>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <p className="mb-2 text-xs font-medium text-stone-700">Plantillas comunes (UE 1169/2011)</p>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_PRESETS.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => {
                setLabel(p.label);
                setCode(p.code);
                setIcon(p.icon);
                setTouchedCode(true);
              }}
              className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-xs hover:bg-stone-100"
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px_80px]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-stone-700">Nombre</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Gluten, Lactosa…"
            required
            maxLength={80}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-stone-700">Código (slug)</span>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""));
              setTouchedCode(true);
            }}
            required
            maxLength={40}
            pattern="[a-z0-9_\-]+"
            className="rounded-lg border border-stone-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-stone-700">Icono</span>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            maxLength={8}
            placeholder="🌾"
            className="rounded-lg border border-stone-300 px-3 py-2 text-center text-lg"
          />
        </label>
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
          disabled={!label.trim() || !code.trim()}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Crear alérgeno
        </button>
      </div>
    </form>
  );
}

function AllergenDetail({
  allergen,
  allItems,
  onDelete,
  onOpenAssign,
}: {
  allergen: Allergen;
  allItems: Item[];
  onDelete: () => void;
  onOpenAssign: () => void;
}) {
  const assignedItems = allItems.filter((it) => allergen.assignedMenuItemIds.includes(it.id));
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {allergen.icon && <span className="text-3xl">{allergen.icon}</span>}
          <div>
            <h2 className="text-xl font-semibold text-stone-900">{allergen.label}</h2>
            <p className="mt-1 font-mono text-xs text-stone-500">{allergen.code}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
        >
          Borrar alérgeno
        </button>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-stone-800">
            Productos que lo contienen ({assignedItems.length})
          </h3>
          <button
            type="button"
            onClick={onOpenAssign}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
          >
            Marcar productos
          </button>
        </div>
        {assignedItems.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 px-4 py-3 text-sm text-stone-500">
            Sin productos marcados. Pulsa "Marcar productos" para añadir.
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
  allergen,
  allItems,
  onClose,
  onSave,
}: {
  allergen: Allergen;
  allItems: Item[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    new Set(allergen.assignedMenuItemIds),
  );
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h3 className="text-base font-semibold text-stone-900">
            Marcar productos con "{allergen.label}"
          </h3>
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
        </div>
        <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
          {filtered.map((it) => (
            <li key={it.id}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-stone-50">
                <input
                  type="checkbox"
                  checked={selected.has(it.id)}
                  onChange={() => toggle(it.id)}
                  className="h-4 w-4 accent-amber-600"
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
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
