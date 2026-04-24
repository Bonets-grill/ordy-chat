"use client";

// Plano visual de mesas — drag-and-drop nativo en SVG.
//
// Dos modos:
//   - "edit"  → arrastra mesas, edita propiedades (panel lateral),
//               añade/borra mesas. Cada drop dispara PATCH /position.
//   - "view"  → solo lectura, mesas coloreadas por estado en vivo.
//               Auto-refresh cada 8s. Click → /conversations/[number].
//
// Sin librerías externas: pointer events nativos. SVG escala bien y soporta
// touch en tablet sin lift de drag-html5.

import * as React from "react";
import { useRouter } from "next/navigation";

const CANVAS_W = 2000;
const CANVAS_H = 1500;

type Status = "free" | "active" | "billing" | "paid";

type Table = {
  id: string;
  tableNumber: string;
  posX: number;
  posY: number;
  shape: "square" | "round" | "rect";
  seats: number;
  rotation: number;
  area: string | null;
  width: number;
  height: number;
  active: boolean;
  status: Status;
  sessionId?: string;
  totalCents?: number;
};

type Mode = "edit" | "view";

// Paleta por estado (Tailwind hex equivalentes para fill).
const STATUS_FILL: Record<Status, string> = {
  free: "#dcfce7", // green-100
  active: "#fef3c7", // amber-100
  billing: "#fee2e2", // red-100
  paid: "#f3f4f6", // gray-100
};
const STATUS_STROKE: Record<Status, string> = {
  free: "#16a34a", // green-600
  active: "#d97706", // amber-600
  billing: "#dc2626", // red-600
  paid: "#9ca3af", // gray-400
};

function formatEuros(cents?: number): string {
  if (!cents || cents <= 0) return "";
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

export function MesaCanvas({ tenantSlug: _tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  const [tables, setTables] = React.useState<Table[]>([]);
  const [mode, setMode] = React.useState<Mode>("edit");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Drag state — refs para evitar re-renders por movimiento de pointer.
  const dragRef = React.useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);

  // Carga inicial + refresh.
  const reload = React.useCallback(async () => {
    try {
      const r = await fetch("/api/tenant/tables/layout", { cache: "no-store" });
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as { tables: Table[] };
      setTables(data.tables ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Auto-refresh cada 8s en modo view (cliente caza cambios en vivo).
  React.useEffect(() => {
    if (mode !== "view") return;
    const t = setInterval(() => {
      reload();
    }, 8000);
    return () => clearInterval(t);
  }, [mode, reload]);

  // Convierte coords pointer (clientX/Y) → coords SVG (viewBox).
  function pointerToSvg(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = pt.matrixTransform(ctm.inverse());
    return { x: inv.x, y: inv.y };
  }

  function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  function onPointerDown(e: React.PointerEvent<SVGGElement>, t: Table) {
    if (mode !== "edit") return;
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = pointerToSvg(e);
    dragRef.current = {
      id: t.id,
      offsetX: x - t.posX,
      offsetY: y - t.posY,
      moved: false,
    };
    setSelectedId(t.id);
    // Capture en el SVG para no perder eventos al salir del rect.
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = pointerToSvg(e);
    const newX = Math.round(clamp(x - drag.offsetX, 0, CANVAS_W));
    const newY = Math.round(clamp(y - drag.offsetY, 0, CANVAS_H));
    drag.moved = true;
    setTables((prev) =>
      prev.map((t) => (t.id === drag.id ? { ...t, posX: newX, posY: newY } : t)),
    );
  }

  async function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (!drag.moved) return;
    const t = tables.find((x) => x.id === drag.id);
    if (!t) return;
    try {
      const r = await fetch(`/api/tenant/tables/${t.id}/position`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posX: t.posX, posY: t.posY }),
      });
      if (!r.ok) setError(`Posición no guardada: HTTP ${r.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    }
    void e; // pointer event ya no nos hace falta
  }

  async function patchShape(id: string, body: Partial<{ shape: Table["shape"]; seats: number; width: number; height: number; area: string | null }>) {
    const r = await fetch(`/api/tenant/tables/${id}/shape`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      setError(`No se pudo guardar: HTTP ${r.status}`);
      return;
    }
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...body, area: body.area === undefined ? t.area : body.area } : t)));
  }

  async function rotateBy90(id: string) {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    const next = ((t.rotation + 90) % 360);
    setTables((prev) => prev.map((x) => (x.id === id ? { ...x, rotation: next } : x)));
    await fetch(`/api/tenant/tables/${id}/position`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posX: t.posX, posY: t.posY, rotation: next }),
    });
  }

  async function deleteTable(id: string) {
    if (!confirm("¿Borrar esta mesa?")) return;
    const r = await fetch(`/api/tenant/tables/${id}`, { method: "DELETE" });
    if (r.ok) {
      setTables((prev) => prev.filter((t) => t.id !== id));
      setSelectedId(null);
    }
  }

  async function addTable(draft: { number: string; shape: Table["shape"]; seats: number; area: string }) {
    const r = await fetch("/api/tenant/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ number: draft.number, zone: draft.area || null, seats: draft.seats }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(body.detail ?? body.error ?? `HTTP ${r.status}`);
      return false;
    }
    // Inmediatamente persistimos shape/area mig 043 + posición inicial centrada.
    if (body.table?.id) {
      await patchShape(body.table.id, {
        shape: draft.shape,
        area: draft.area || null,
      });
    }
    await reload();
    setShowAdd(false);
    return true;
  }

  const selected = selectedId ? tables.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-3">
        <div className="inline-flex rounded-md border border-neutral-200 p-0.5">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`rounded px-3 py-1.5 text-sm font-medium ${mode === "edit" ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("view");
              setSelectedId(null);
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${mode === "view" ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
          >
            Vista (camarero)
          </button>
        </div>

        <div className="flex items-center gap-2">
          {mode === "view" && (
            <Legend />
          )}
          {mode === "edit" && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Añadir mesa
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Canvas */}
        <div className="flex-1 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-[70vh] w-full touch-none select-none"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={(e) => {
              if (e.target === svgRef.current) setSelectedId(null);
            }}
          >
            {/* Grid suave para orientarse */}
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />

            {tables.map((t) => (
              <TableShape
                key={t.id}
                table={t}
                mode={mode}
                selected={selectedId === t.id}
                onPointerDown={(e) => onPointerDown(e, t)}
                onClick={() => {
                  if (mode === "view" && t.status !== "free") {
                    // Camarero pincha mesa abierta → conversación / detalle.
                    router.push(`/conversations?mesa=${encodeURIComponent(t.tableNumber)}`);
                  } else if (mode === "edit") {
                    setSelectedId(t.id);
                  }
                }}
              />
            ))}
          </svg>
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">Cargando plano…</div>
          )}
          {!loading && tables.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              Aún no hay mesas. Pulsa &quot;Añadir mesa&quot; para empezar.
            </div>
          )}
        </div>

        {/* Panel lateral */}
        {mode === "edit" && selected && (
          <SidePanel
            table={selected}
            onPatch={(body) => patchShape(selected.id, body)}
            onRotate={() => rotateBy90(selected.id)}
            onDelete={() => deleteTable(selected.id)}
          />
        )}
      </div>

      {showAdd && (
        <AddTableModal onCancel={() => setShowAdd(false)} onAdd={addTable} />
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-600">
      <Dot color={STATUS_FILL.free} stroke={STATUS_STROKE.free} /> Libre
      <Dot color={STATUS_FILL.active} stroke={STATUS_STROKE.active} /> Ocupada
      <Dot color={STATUS_FILL.billing} stroke={STATUS_STROKE.billing} /> Pidió cuenta
      <Dot color={STATUS_FILL.paid} stroke={STATUS_STROKE.paid} /> Cobrada
    </div>
  );
}

function Dot({ color, stroke }: { color: string; stroke: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: color, border: `1px solid ${stroke}` }}
    />
  );
}

function TableShape({
  table,
  mode,
  selected,
  onPointerDown,
  onClick,
}: {
  table: Table;
  mode: Mode;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const fill = mode === "view" ? STATUS_FILL[table.status] : table.active ? "#ffffff" : "#f3f4f6";
  const stroke = mode === "view"
    ? STATUS_STROKE[table.status]
    : selected
      ? "#0ea5e9"
      : table.active
        ? "#525252"
        : "#a3a3a3";
  const strokeWidth = selected ? 4 : 2;
  const cx = table.width / 2;
  const cy = table.height / 2;
  const rotateTransform = `translate(${table.posX} ${table.posY}) rotate(${table.rotation} ${cx} ${cy})`;

  const cursor = mode === "edit" ? "grab" : table.status !== "free" ? "pointer" : "default";

  return (
    <g
      transform={rotateTransform}
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{ cursor, touchAction: "none" }}
    >
      {table.shape === "round" ? (
        <ellipse
          cx={cx}
          cy={cy}
          rx={table.width / 2}
          ry={table.height / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      ) : (
        <rect
          x={0}
          y={0}
          width={table.width}
          height={table.height}
          rx={table.shape === "rect" ? 8 : 12}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      )}
      {/* Etiqueta: número + total si activa */}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        dominantBaseline="middle"
        className="select-none"
        style={{ fontSize: 18, fontWeight: 600, fill: "#111827", pointerEvents: "none" }}
      >
        {table.tableNumber}
      </text>
      {mode === "view" && table.status !== "free" && table.totalCents ? (
        <text
          x={cx}
          y={cy + 16}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 12, fill: "#374151", pointerEvents: "none" }}
        >
          {formatEuros(table.totalCents)}
        </text>
      ) : null}
      <text
        x={cx}
        y={table.height - 6}
        textAnchor="middle"
        style={{ fontSize: 10, fill: "#6b7280", pointerEvents: "none" }}
      >
        {table.seats}p
      </text>
    </g>
  );
}

function SidePanel({
  table,
  onPatch,
  onRotate,
  onDelete,
}: {
  table: Table;
  onPatch: (body: Partial<{ shape: Table["shape"]; seats: number; width: number; height: number; area: string | null }>) => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="w-full shrink-0 rounded-lg border border-neutral-200 bg-white p-4 lg:w-72">
      <h3 className="text-sm font-semibold text-neutral-900">Mesa {table.tableNumber}</h3>
      <div className="mt-3 space-y-3">
        <Field label="Forma">
          <select
            value={table.shape}
            onChange={(e) => onPatch({ shape: e.target.value as Table["shape"] })}
            className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
          >
            <option value="square">Cuadrada</option>
            <option value="round">Redonda</option>
            <option value="rect">Rectangular</option>
          </select>
        </Field>

        <Field label="Sillas">
          <input
            type="number"
            min={1}
            max={30}
            value={table.seats}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 1 && v <= 30) onPatch({ seats: v });
            }}
            className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Área">
          <input
            type="text"
            value={table.area ?? ""}
            placeholder="Terraza, Salón, Barra"
            maxLength={60}
            onBlur={(e) => onPatch({ area: e.target.value.trim() || null })}
            onChange={() => {}}
            className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Ancho (px)">
            <input
              type="number"
              min={40}
              max={200}
              value={table.width}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 40 && v <= 200) onPatch({ width: v });
              }}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Alto (px)">
            <input
              type="number"
              min={40}
              max={200}
              value={table.height}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 40 && v <= 200) onPatch({ height: v });
              }}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onRotate}
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Rotar 90°
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50"
          >
            Borrar
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="font-medium uppercase tracking-wider text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function AddTableModal({
  onCancel,
  onAdd,
}: {
  onCancel: () => void;
  onAdd: (d: { number: string; shape: Table["shape"]; seats: number; area: string }) => Promise<boolean>;
}) {
  const [number, setNumber] = React.useState("");
  const [shape, setShape] = React.useState<Table["shape"]>("square");
  const [seats, setSeats] = React.useState(4);
  const [area, setArea] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-neutral-900">Añadir mesa</h3>
        <div className="mt-3 space-y-3">
          <Field label="Número o nombre">
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="5, T1, Terraza-3"
              maxLength={8}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Forma">
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value as Table["shape"])}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            >
              <option value="square">Cuadrada</option>
              <option value="round">Redonda</option>
              <option value="rect">Rectangular</option>
            </select>
          </Field>
          <Field label="Sillas">
            <input
              type="number"
              min={1}
              max={30}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value) || 4)}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Área (opcional)">
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Terraza, Salón, Barra"
              maxLength={60}
              className="mt-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            />
          </Field>
          {err && <p className="text-xs text-rose-700">{err}</p>}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !number.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              const ok = await onAdd({ number: number.trim(), shape, seats, area: area.trim() });
              setBusy(false);
              if (!ok) setErr("No se pudo crear (¿número duplicado?)");
            }}
            className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? "Creando…" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}
