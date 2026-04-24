"use client";

// web/app/dashboard/carta/modifiers-editor.tsx
//
// UI compacta para gestionar grupos de modificadores y sus modifiers de un
// menu_item. Se monta inline (expand/collapse) bajo el item en la lista del
// editor. Carga lazy: solo pide /api/tenant/menu/[id]/modifiers cuando el
// usuario abre el panel del item.
//
// Mig 042 — feature #5 modificadores de producto.

import * as React from "react";

type ModifierItem = {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  available: boolean;
  sortOrder: number;
};

type ModifierGroup = {
  id: string;
  tenantId: string;
  menuItemId: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  modifiers: ModifierItem[];
};

type FetchResponse = { groups: ModifierGroup[] } | { error: string };

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
  const [groups, setGroups] = React.useState<ModifierGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null); // id de grupo/mod en proceso

  // Form de "nuevo grupo".
  const [showNewGroup, setShowNewGroup] = React.useState(false);
  const [draftGroup, setDraftGroup] = React.useState({
    name: "",
    selectionType: "single" as "single" | "multi",
    required: false,
    minSelect: 0,
    maxSelect: null as number | null,
  });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenant/menu/${itemId}/modifiers`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as FetchResponse;
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          onToast("err", `Error cargando modificadores: ${"error" in body ? body.error : res.status}`);
          setGroups([]);
        } else {
          setGroups(body.groups);
        }
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

  async function reload() {
    const res = await fetch(`/api/tenant/menu/${itemId}/modifiers`, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as FetchResponse;
    if (res.ok && "groups" in body) setGroups(body.groups);
  }

  async function createGroup() {
    if (!draftGroup.name.trim()) {
      onToast("err", "Pon un nombre al grupo");
      return;
    }
    setBusy("new-group");
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftGroup.name.trim(),
          selectionType: draftGroup.selectionType,
          required: draftGroup.required,
          minSelect: draftGroup.minSelect,
          maxSelect: draftGroup.selectionType === "single" ? 1 : draftGroup.maxSelect,
          sortOrder: groups.length,
          modifiers: [],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `No se pudo crear: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      onToast("ok", "Grupo creado");
      setShowNewGroup(false);
      setDraftGroup({ name: "", selectionType: "single", required: false, minSelect: 0, maxSelect: null });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function deleteGroup(groupId: string) {
    if (!confirm("¿Borrar este grupo y todos sus modificadores?")) return;
    setBusy(groupId);
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers/${groupId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `No se pudo borrar: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      onToast("ok", "Grupo borrado");
    } finally {
      setBusy(null);
    }
  }

  async function patchGroup(groupId: string, patch: Partial<ModifierGroup>) {
    setBusy(groupId);
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `Error: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function addModifier(groupId: string, name: string, priceDeltaCents: number) {
    setBusy(`add-mod-${groupId}`);
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers/${groupId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, priceDeltaCents, available: true, sortOrder: 0 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `Error: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      onToast("ok", "Opción añadida");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function deleteModifier(groupId: string, modId: string) {
    setBusy(modId);
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers/${groupId}/items/${modId}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `Error: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, modifiers: g.modifiers.filter((m) => m.id !== modId) } : g)),
      );
      onToast("ok", "Opción borrada");
    } finally {
      setBusy(null);
    }
  }

  async function patchModifier(groupId: string, modId: string, patch: Partial<ModifierItem>) {
    setBusy(modId);
    try {
      const res = await fetch(`/api/tenant/menu/${itemId}/modifiers/${groupId}/items/${modId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onToast("err", `Error: ${body.error ?? `HTTP ${res.status}`}`);
        return;
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-violet-900">
          🧩 Modificadores de "{itemName}"
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
        >
          Cerrar
        </button>
      </div>
      <p className="mt-1 text-xs text-violet-800/70">
        Los grupos agrupan opciones (Tamaño, Extras, Sin…). El cliente las elige al pedir y
        el precio se ajusta automáticamente.
      </p>

      {loading ? (
        <p className="mt-3 text-xs text-neutral-500">Cargando…</p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.length === 0 && !showNewGroup && (
            <p className="rounded border border-dashed border-violet-200 bg-white/60 p-3 text-xs text-neutral-500">
              Aún no hay grupos. Añade el primero — por ejemplo "Tamaño" (single, obligatorio) o
              "Extras" (multi, opcional).
            </p>
          )}

          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              busyId={busy}
              onDeleteGroup={() => deleteGroup(g.id)}
              onPatchGroup={(patch) => patchGroup(g.id, patch)}
              onAddModifier={(name, delta) => addModifier(g.id, name, delta)}
              onDeleteModifier={(modId) => deleteModifier(g.id, modId)}
              onPatchModifier={(modId, patch) => patchModifier(g.id, modId, patch)}
            />
          ))}

          {showNewGroup ? (
            <div className="rounded-md border border-violet-200 bg-white p-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-violet-700">
                Nuevo grupo
              </h5>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-[11px] font-medium uppercase text-neutral-600">Nombre</label>
                  <input
                    type="text"
                    value={draftGroup.name}
                    onChange={(e) => setDraftGroup({ ...draftGroup, name: e.target.value })}
                    placeholder="Tamaño, Extras, Quitar ingredientes…"
                    className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase text-neutral-600">Tipo</label>
                  <select
                    value={draftGroup.selectionType}
                    onChange={(e) =>
                      setDraftGroup({
                        ...draftGroup,
                        selectionType: e.target.value as "single" | "multi",
                      })
                    }
                    className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
                  >
                    <option value="single">Single — elegir 1 (radio)</option>
                    <option value="multi">Multi — elegir varios (checkbox)</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input
                    id="newgroup-required"
                    type="checkbox"
                    checked={draftGroup.required}
                    onChange={(e) => setDraftGroup({ ...draftGroup, required: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <label htmlFor="newgroup-required" className="text-sm text-neutral-700">
                    Obligatorio elegir
                  </label>
                </div>
                {draftGroup.selectionType === "multi" ? (
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] font-medium uppercase text-neutral-600">Máx</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={draftGroup.maxSelect ?? ""}
                      placeholder="sin límite"
                      onChange={(e) =>
                        setDraftGroup({
                          ...draftGroup,
                          maxSelect: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="w-24 rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
                    />
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={createGroup}
                  disabled={busy === "new-group" || !draftGroup.name.trim()}
                  className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {busy === "new-group" ? "Creando…" : "Crear grupo"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewGroup(false)}
                  className="rounded border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewGroup(true)}
              className="rounded-md border border-dashed border-violet-300 bg-white px-3 py-2 text-xs font-medium text-violet-700 hover:border-violet-500 hover:bg-violet-50"
            >
              + Añadir grupo de modificadores
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  busyId,
  onDeleteGroup,
  onPatchGroup,
  onAddModifier,
  onDeleteModifier,
  onPatchModifier,
}: {
  group: ModifierGroup;
  busyId: string | null;
  onDeleteGroup: () => void;
  onPatchGroup: (patch: Partial<ModifierGroup>) => void;
  onAddModifier: (name: string, priceDeltaCents: number) => void;
  onDeleteModifier: (modId: string) => void;
  onPatchModifier: (modId: string, patch: Partial<ModifierItem>) => void;
}) {
  const [draftMod, setDraftMod] = React.useState({ name: "", priceRaw: "0,00" });

  function submitNewMod() {
    const cents = parsePriceDelta(draftMod.priceRaw);
    if (cents === null) return;
    if (!draftMod.name.trim()) return;
    onAddModifier(draftMod.name.trim(), cents);
    setDraftMod({ name: "", priceRaw: "0,00" });
  }

  const isBusy = busyId === group.id;

  return (
    <div className="rounded-md border border-violet-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <strong className="text-sm text-neutral-900">{group.name}</strong>
          <span className="ml-2 text-[11px] uppercase tracking-wider text-neutral-500">
            {group.selectionType === "single" ? "elegir 1" : "elegir varios"}
            {group.required ? " · obligatorio" : " · opcional"}
            {group.selectionType === "multi" && group.maxSelect ? ` · máx ${group.maxSelect}` : ""}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onPatchGroup({ required: !group.required })}
            disabled={isBusy}
            className="rounded px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
          >
            {group.required ? "Hacer opcional" : "Hacer obligatorio"}
          </button>
          <button
            type="button"
            onClick={onDeleteGroup}
            disabled={isBusy}
            className="rounded px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
          >
            Borrar grupo
          </button>
        </div>
      </div>

      <ul className="mt-2 divide-y divide-neutral-100">
        {group.modifiers.length === 0 ? (
          <li className="py-1.5 text-[11px] italic text-neutral-400">
            Sin opciones todavía. Añade abajo.
          </li>
        ) : (
          group.modifiers.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className={`text-sm ${m.available ? "text-neutral-800" : "text-neutral-400 line-through"}`}>
                {m.name}{" "}
                <span className="text-[11px] text-neutral-500">{formatDelta(m.priceDeltaCents)}</span>
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onPatchModifier(m.id, { available: !m.available })}
                  disabled={busyId === m.id}
                  className="rounded px-2 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
                >
                  {m.available ? "Activo" : "Agotado"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteModifier(m.id)}
                  disabled={busyId === m.id}
                  className="rounded px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={draftMod.name}
          onChange={(e) => setDraftMod({ ...draftMod, name: e.target.value })}
          placeholder="Ej: Extra queso, Sin cebolla, Tamaño grande…"
          className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />
        <input
          type="text"
          value={draftMod.priceRaw}
          onChange={(e) => setDraftMod({ ...draftMod, priceRaw: e.target.value })}
          placeholder="0,00"
          className="w-20 rounded border border-neutral-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />
        <button
          type="button"
          onClick={submitNewMod}
          disabled={busyId === `add-mod-${group.id}` || !draftMod.name.trim()}
          className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          + Opción
        </button>
      </div>
    </div>
  );
}
