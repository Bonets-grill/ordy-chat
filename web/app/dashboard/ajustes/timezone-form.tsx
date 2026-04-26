"use client";

// Form cliente: selector de zona horaria del tenant. Persiste vía PATCH
// /api/tenant/settings. Mostrar la hora actual en la TZ elegida sirve como
// confirmación visual al dueño antes de guardar.

import * as React from "react";
import { Button } from "@/components/ui/button";

type Option = { value: string; label: string; group: "España" | "Europa" | "América" | "Otros" };

const GROUP_ORDER: Array<Option["group"]> = ["España", "Europa", "América", "Otros"];

function formatNowInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    }).format(new Date());
  } catch {
    return "—";
  }
}

export function TimezoneForm({
  initialTimezone,
  options,
}: {
  initialTimezone: string;
  options: Option[];
}) {
  const [tz, setTz] = React.useState(initialTimezone);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Refresca el preview cada minuto sin recargar página.
  const [previewNow, setPreviewNow] = React.useState(() => formatNowInTz(tz));
  React.useEffect(() => {
    setPreviewNow(formatNowInTz(tz));
    const id = window.setInterval(() => setPreviewNow(formatNowInTz(tz)), 60_000);
    return () => window.clearInterval(id);
  }, [tz]);

  const grouped = React.useMemo(() => {
    const map: Record<Option["group"], Option[]> = { España: [], Europa: [], América: [], Otros: [] };
    for (const opt of options) map[opt.group].push(opt);
    return map;
  }, [options]);

  const dirty = tz !== initialTimezone;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2">
        <label htmlFor="tz" className="text-sm font-medium text-neutral-900">
          Zona horaria del restaurante
        </label>
        <select
          id="tz"
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          className="h-10 rounded-md border border-neutral-200 bg-white px-3 text-sm focus:border-neutral-400 focus:outline-none"
        >
          {GROUP_ORDER.map((group) => (
            <optgroup key={group} label={group}>
              {grouped[group].map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
        <span className="text-neutral-500">Hora actual en {tz}: </span>
        <span className="font-medium text-neutral-900">{previewNow}</span>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Guardando…" : "Guardar zona horaria"}
        </Button>
        {savedAt && !dirty && (
          <span className="text-xs text-emerald-600">
            Guardado · {savedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {error && <span className="text-xs text-red-600">Error: {error}</span>}
      </div>
    </div>
  );
}
