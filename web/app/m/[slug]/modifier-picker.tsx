// web/app/m/[slug]/modifier-picker.tsx
//
// Mig 042 — picker visual de modificadores en el widget público /m/[slug].
// Cierra la deuda técnica explícita del PR #113 (modifiers shippeados sin UI
// porque menu-experience.tsx tiene 1300+ líneas y se prohibió tocarlo).
//
// Este componente es independiente: lo invoca menu-experience pasando un
// item y un onConfirm. Si el item no tiene grupos configurados (la mayoría
// de la carta hoy), se auto-confirma con array vacío y el precio base —
// transparente para el caller.
//
// Diseño:
// - Bottom sheet en móvil, modal centrado en desktop (sm:items-center).
// - Cada grupo es una sección con su nombre + badge "Obligatorio" si toca.
// - Modifiers en radio (single) o checkbox (multi).
// - Precio final dinámico en footer.
// - Botón Confirmar deshabilitado si required/min_select no se cumple.
//
// Estilo coherente con el resto del widget: stone-900/950, brandColor en
// CTAs, tipografía sans default. Sin dependencias nuevas — todo Tailwind +
// lucide-react ya instalados.

"use client";

import { Check, Loader2, X } from "lucide-react";
import * as React from "react";

type Modifier = {
  id: string;
  name: string;
  priceDeltaCents: number;
};

type Group = {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  modifiers: Modifier[];
};

export type ModifierSelection = {
  groupId: string;
  modifierId: string;
  name: string;
  priceDeltaCents: number;
};

type Props = {
  open: boolean;
  /** El item del que se abren los modifiers. Si null mientras open=true, no renderiza. */
  item: { id: string; name: string; priceCents: number } | null;
  /** Slug del tenant — se usa para fetchear el endpoint público de modifiers. */
  slug: string;
  /** Color de marca del tenant — para el CTA de confirmación. */
  brandColor: string;
  /** i18n labels mínimos. */
  labels: {
    required: string;
    optional: string;
    /** "Selecciona al menos {min}" — recibe el min como string. */
    minSelectHint: (min: string) => string;
    /** "Máx {max}" — recibe el max como string. */
    maxSelectHint: (max: string) => string;
    confirm: string;
    /** "Confirmar · {price}". */
    confirmWithTotal: (total: string) => string;
    cancel: string;
    loading: string;
    errorRetry: string;
  };
  onClose(): void;
  onConfirm(selection: ModifierSelection[], finalPriceCents: number): void;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; groups: Group[] }
  | { kind: "error" };

function formatEur(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function ModifierPicker(props: Props) {
  const { open, item, slug, brandColor, labels, onClose, onConfirm } = props;

  const [state, setState] = React.useState<FetchState>({ kind: "idle" });
  // selectedByGroup[groupId] = Set<modifierId>
  const [selectedByGroup, setSelectedByGroup] = React.useState<Record<string, Set<string>>>({});

  // Auto-confirm path. Cuando el endpoint devuelve groups vacío, no mostramos
  // UI: confirmamos directo con el precio base. Esto mantiene el widget
  // existente intacto para los 99% de items que aún no tienen modifiers.
  // Usamos useRef para evitar bucle (autoConfirm dispara onConfirm que
  // triggers cleanup que vuelve a montar y dispararía otra vez).
  const autoConfirmedRef = React.useRef<string | null>(null);

  // Reset al cambiar de item o cerrar.
  React.useEffect(() => {
    if (!open || !item) {
      setState({ kind: "idle" });
      setSelectedByGroup({});
      autoConfirmedRef.current = null;
      return;
    }
    // Fetch al abrir.
    let cancelled = false;
    setState({ kind: "loading" });
    setSelectedByGroup({});
    autoConfirmedRef.current = null;
    (async () => {
      try {
        const r = await fetch(
          `/api/public/menu/${encodeURIComponent(slug)}/${encodeURIComponent(item.id)}/modifiers`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!r.ok) {
          setState({ kind: "error" });
          return;
        }
        const data = (await r.json()) as { groups?: Group[] };
        const groups = Array.isArray(data.groups) ? data.groups : [];
        setState({ kind: "ready", groups });
      } catch {
        if (cancelled) return;
        setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item, slug]);

  // Auto-confirm cuando llega groups vacío. Lo hacemos con un effect separado
  // que ve el state ready+empty y dispara onConfirm UNA sola vez por item.
  React.useEffect(() => {
    if (!open || !item) return;
    if (state.kind !== "ready") return;
    if (state.groups.length > 0) return;
    if (autoConfirmedRef.current === item.id) return;
    autoConfirmedRef.current = item.id;
    onConfirm([], item.priceCents);
  }, [open, item, state, onConfirm]);

  // Cálculo de validez + precio final.
  const validation = React.useMemo(() => {
    if (state.kind !== "ready") return { valid: false, priceCents: item?.priceCents ?? 0, selection: [] as ModifierSelection[] };
    let priceCents = item?.priceCents ?? 0;
    let valid = true;
    const selection: ModifierSelection[] = [];
    for (const g of state.groups) {
      const sel = selectedByGroup[g.id] ?? new Set<string>();
      const minRequired = g.required ? Math.max(1, g.minSelect) : g.minSelect;
      if (sel.size < minRequired) valid = false;
      if (g.maxSelect !== null && sel.size > g.maxSelect) valid = false;
      for (const modId of sel) {
        const mod = g.modifiers.find((m) => m.id === modId);
        if (!mod) continue;
        priceCents += mod.priceDeltaCents;
        selection.push({
          groupId: g.id,
          modifierId: mod.id,
          name: mod.name,
          priceDeltaCents: mod.priceDeltaCents,
        });
      }
    }
    return { valid, priceCents, selection };
  }, [state, selectedByGroup, item]);

  if (!open || !item) return null;
  // Auto-confirm path: groups vacío → no renderizamos nada (el efecto ya
  // disparó onConfirm). Evita un flash de modal vacío.
  if (state.kind === "ready" && state.groups.length === 0) return null;

  function toggleSingle(groupId: string, modifierId: string) {
    setSelectedByGroup((prev) => ({ ...prev, [groupId]: new Set([modifierId]) }));
  }

  function toggleMulti(groupId: string, modifierId: string, maxSelect: number | null) {
    setSelectedByGroup((prev) => {
      const cur = new Set(prev[groupId] ?? []);
      if (cur.has(modifierId)) {
        cur.delete(modifierId);
      } else {
        if (maxSelect !== null && cur.size >= maxSelect) {
          // Silently ignore — la UI ya señala maxSelect en el header del grupo.
          return prev;
        }
        cur.add(modifierId);
      }
      return { ...prev, [groupId]: cur };
    });
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modifier-picker-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <div id="modifier-picker-title" className="truncate text-base font-bold text-stone-900">
              {item.name}
            </div>
            <div className="text-xs text-stone-500">{formatEur(item.priceCents)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.cancel}
            className="rounded-lg p-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.kind === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-12 text-stone-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{labels.loading}</span>
            </div>
          ) : state.kind === "error" ? (
            <div className="py-12 text-center text-sm text-stone-600">{labels.errorRetry}</div>
          ) : state.kind === "ready" ? (
            <div className="space-y-5">
              {state.groups.map((g) => {
                const sel = selectedByGroup[g.id] ?? new Set<string>();
                const showMin = g.required || g.minSelect > 0;
                const minRequired = g.required ? Math.max(1, g.minSelect) : g.minSelect;
                const unmet = sel.size < minRequired;
                return (
                  <fieldset key={g.id} className="space-y-2">
                    <legend className="flex w-full items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-stone-900">{g.name}</span>
                      <span className="flex items-center gap-1.5">
                        {g.required ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              unmet ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {labels.required}
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wide text-stone-400">
                            {labels.optional}
                          </span>
                        )}
                      </span>
                    </legend>
                    {showMin && minRequired > 1 ? (
                      <div className="text-[11px] text-stone-500">
                        {labels.minSelectHint(String(minRequired))}
                      </div>
                    ) : null}
                    {g.maxSelect !== null && g.selectionType === "multi" ? (
                      <div className="text-[11px] text-stone-500">
                        {labels.maxSelectHint(String(g.maxSelect))}
                      </div>
                    ) : null}
                    <div className="space-y-1">
                      {g.modifiers.map((m) => {
                        const checked = sel.has(m.id);
                        const ariaPressed = checked;
                        const handleClick = () => {
                          if (g.selectionType === "single") toggleSingle(g.id, m.id);
                          else toggleMulti(g.id, m.id, g.maxSelect);
                        };
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={handleClick}
                            aria-pressed={ariaPressed}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.99] ${
                              checked
                                ? "border-stone-900 bg-stone-50"
                                : "border-stone-200 bg-white hover:border-stone-400"
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                                g.selectionType === "single" ? "rounded-full" : "rounded-md"
                              } border ${
                                checked ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"
                              }`}
                            >
                              {checked ? <Check className="h-3 w-3" /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-stone-900">{m.name}</span>
                            {m.priceDeltaCents > 0 ? (
                              <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-700">
                                +{formatEur(m.priceDeltaCents)}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="border-t border-stone-200 bg-white px-5 py-3">
          <button
            type="button"
            disabled={state.kind !== "ready" || !validation.valid}
            onClick={() => onConfirm(validation.selection, validation.priceCents)}
            className="w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-300"
            style={{
              backgroundColor: state.kind !== "ready" || !validation.valid ? undefined : brandColor,
            }}
          >
            {state.kind !== "ready"
              ? labels.confirm
              : labels.confirmWithTotal(formatEur(validation.priceCents))}
          </button>
        </footer>
      </div>
    </div>
  );
}
