"use client";

// web/app/dashboard/carta/modifiers-editor.tsx
//
// Mig 051 — refactor: el panel inline en /dashboard/carta YA NO crea
// modificadores ni alérgenos. Se limita a ASIGNAR los que viven en la
// biblioteca tenant-wide (/dashboard/modificadores y /dashboard/alergenos).
//
// La motivación viene del usuario: "los modificadores y los alérgenos deben
// ser módulos aparte que cuando se creen se les pueda poner a cualquier
// producto que el tenant elija, porque ahora hay que hacer uno por uno".

import * as React from "react";

type LibraryGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  options: Array<{ id: string; name: string; priceDeltaCents: number }>;
};

type LibraryAllergen = {
  id: string;
  code: string;
  label: string;
  icon: string | null;
};

type LinkedGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  options: Array<{ id: string; name: string; priceDeltaCents: number }>;
};

type LinkedAllergen = {
  id: string;
  code: string;
  label: string;
  icon: string | null;
};

function formatDelta(cents: number): string {
  if (cents === 0) return "gratis";
  return `+${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function ModifiersEditor({
  itemId,
  itemName,
  onClose,
  onToast,
}: {
  itemId: string;
  itemName: string;
  onClose: () => void;
  onToast: (kind: "ok" | "err", msg: string) => void;
}) {
  const [linkedGroups, setLinkedGroups] = React.useState<LinkedGroup[]>([]);
  const [linkedAllergens, setLinkedAllergens] = React.useState<LinkedAllergen[]>([]);
  const [libraryGroups, setLibraryGroups] = React.useState<LibraryGroup[]>([]);
  const [libraryAllergens, setLibraryAllergens] = React.useState<LibraryAllergen[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dialog, setDialog] = React.useState<null | "modifiers" | "allergens">(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [linkedG, linkedA, libG, libA] = await Promise.all([
          fetch(`/api/tenant/menu/${itemId}/modifiers`, { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/tenant/menu/${itemId}/allergens`, { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/tenant/modifier-groups`, { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/tenant/allergens`, { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setLinkedGroups(linkedG.groups ?? []);
        setLinkedAllergens(linkedA.allergens ?? []);
        setLibraryGroups(libG.groups ?? []);
        setLibraryAllergens(libA.allergens ?? []);
      } catch (e) {
        if (!cancelled) onToast("err", `Error: ${e instanceof Error ? e.message : "desconocido"}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, onToast]);

  async function saveModifierLinks(groupIds: string[]) {
    const res = await fetch(`/api/tenant/menu/${itemId}/modifiers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onToast("err", `Error guardando modificadores: ${body.error ?? res.status}`);
      return;
    }
    const refreshed = await fetch(`/api/tenant/menu/${itemId}/modifiers`, { cache: "no-store" }).then(
      (r) => r.json(),
    );
    setLinkedGroups(refreshed.groups ?? []);
    setDialog(null);
    onToast("ok", "Modificadores actualizados");
  }

  async function saveAllergenLinks(allergenIds: string[]) {
    const res = await fetch(`/api/tenant/menu/${itemId}/allergens`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allergenIds }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onToast("err", `Error guardando alérgenos: ${body.error ?? res.status}`);
      return;
    }
    const refreshed = await fetch(`/api/tenant/menu/${itemId}/allergens`, { cache: "no-store" }).then(
      (r) => r.json(),
    );
    setLinkedAllergens(refreshed.allergens ?? []);
    setDialog(null);
    onToast("ok", "Alérgenos actualizados");
  }

  return (
    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-stone-900">
            🧩 Modificadores y alérgenos de "{itemName}"
          </h4>
          <p className="mt-0.5 text-xs text-stone-600">
            Se asignan desde la biblioteca compartida del local — crea los grupos en{" "}
            <a href="/dashboard/modificadores" className="text-violet-700 underline">
              Modificadores
            </a>{" "}
            y los alérgenos en{" "}
            <a href="/dashboard/alergenos" className="text-amber-700 underline">
              Alérgenos
            </a>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-stone-600 hover:underline"
        >
          Cerrar
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-sm text-stone-500">Cargando…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-violet-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-violet-700">
                Modificadores ({linkedGroups.length})
              </span>
              <button
                type="button"
                onClick={() => setDialog("modifiers")}
                className="rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-xs text-violet-900 hover:bg-violet-100"
              >
                Asignar de biblioteca
              </button>
            </div>
            {linkedGroups.length === 0 ? (
              <p className="text-xs text-stone-500">Sin modificadores asignados.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {linkedGroups.map((g) => (
                  <li key={g.id} className="rounded border border-stone-200 px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-stone-800">{g.name}</span>
                      <span className="text-[10px] text-stone-500">
                        {g.selectionType === "single" ? "elegir 1" : "elegir varias"}
                      </span>
                    </div>
                    {g.options.length > 0 && (
                      <p className="mt-0.5 text-xs text-stone-600">
                        {g.options
                          .slice(0, 4)
                          .map((o) => `${o.name} (${formatDelta(o.priceDeltaCents)})`)
                          .join(" · ")}
                        {g.options.length > 4 ? ` · +${g.options.length - 4}` : ""}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-amber-700">
                Alérgenos ({linkedAllergens.length})
              </span>
              <button
                type="button"
                onClick={() => setDialog("allergens")}
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
              >
                Asignar de biblioteca
              </button>
            </div>
            {linkedAllergens.length === 0 ? (
              <p className="text-xs text-stone-500">Sin alérgenos marcados.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {linkedAllergens.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-900"
                  >
                    {a.icon} {a.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {dialog === "modifiers" && (
        <ChecklistDialog
          title={`Modificadores para "${itemName}"`}
          items={libraryGroups.map((g) => ({
            id: g.id,
            label: g.name,
            sub:
              g.options.length > 0
                ? g.options
                    .slice(0, 3)
                    .map((o) => o.name)
                    .join(", ")
                : "(sin opciones)",
          }))}
          initialSelected={new Set(linkedGroups.map((g) => g.id))}
          accent="violet"
          emptyHint={
            <span>
              Aún no hay grupos en la biblioteca.{" "}
              <a href="/dashboard/modificadores" className="underline">
                Crea uno aquí
              </a>
              .
            </span>
          }
          onClose={() => setDialog(null)}
          onSave={(ids) => saveModifierLinks(ids)}
        />
      )}
      {dialog === "allergens" && (
        <ChecklistDialog
          title={`Alérgenos en "${itemName}"`}
          items={libraryAllergens.map((a) => ({
            id: a.id,
            label: `${a.icon ?? ""} ${a.label}`.trim(),
            sub: a.code,
          }))}
          initialSelected={new Set(linkedAllergens.map((a) => a.id))}
          accent="amber"
          emptyHint={
            <span>
              Aún no hay alérgenos en la biblioteca.{" "}
              <a href="/dashboard/alergenos" className="underline">
                Crea los habituales aquí
              </a>
              .
            </span>
          }
          onClose={() => setDialog(null)}
          onSave={(ids) => saveAllergenLinks(ids)}
        />
      )}
    </div>
  );
}

function ChecklistDialog({
  title,
  items,
  initialSelected,
  accent,
  emptyHint,
  onClose,
  onSave,
}: {
  title: string;
  items: Array<{ id: string; label: string; sub?: string }>;
  initialSelected: Set<string>;
  accent: "violet" | "amber";
  emptyHint: React.ReactNode;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(initialSelected);
  const [filter, setFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const filtered = filter
    ? items.filter((it) => it.label.toLowerCase().includes(filter.toLowerCase()))
    : items;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const accentBg = accent === "violet" ? "bg-violet-600 hover:bg-violet-700" : "bg-amber-600 hover:bg-amber-700";
  const accentRing = accent === "violet" ? "accent-violet-600" : "accent-amber-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <h3 className="text-base font-semibold text-stone-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-500 hover:bg-stone-100"
          >
            ✕
          </button>
        </header>
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-600">{emptyHint}</div>
        ) : (
          <>
            <div className="border-b border-stone-100 px-5 py-2">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
              />
            </div>
            <ul className="flex-1 divide-y divide-stone-100 overflow-y-auto">
              {filtered.map((it) => (
                <li key={it.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-5 py-2.5 hover:bg-stone-50">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      className={`mt-0.5 h-4 w-4 ${accentRing}`}
                    />
                    <span className="flex-1">
                      <span className="block text-sm text-stone-800">{it.label}</span>
                      {it.sub && <span className="block text-xs text-stone-500">{it.sub}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
        <footer className="flex items-center justify-between border-t border-stone-200 px-5 py-3">
          <span className="text-xs text-stone-500">{selected.size} marcados</span>
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
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${accentBg}`}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
