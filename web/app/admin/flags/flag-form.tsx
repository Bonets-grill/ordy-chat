"use client";

// web/app/admin/flags/flag-form.tsx — UI por flag (card con toggle + guardar).

import * as React from "react";
import { Button } from "@/components/ui/button";
import { setFlagAction } from "./actions";

export type FlagState = {
  key: string;
  type: "bool" | "enum";
  description: string;
  value: unknown;
  source: "platform_settings" | "env" | "default";
  options?: readonly string[];
};

function sourceLabel(source: FlagState["source"]): string {
  if (source === "platform_settings") return "DB (override)";
  if (source === "env") return "ENV var";
  return "default";
}

function sourceColor(source: FlagState["source"]): string {
  if (source === "platform_settings") return "bg-emerald-100 text-emerald-800";
  if (source === "env") return "bg-amber-100 text-amber-800";
  return "bg-neutral-100 text-neutral-600";
}

export function FlagForm({ state }: { state: FlagState }) {
  const [value, setValue] = React.useState<unknown>(state.value);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const dirty = JSON.stringify(value) !== JSON.stringify(state.value);

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await setFlagAction({ key: state.key, value });
    setSaving(false);
    if (r.ok) {
      setMsg("Guardado.");
    } else {
      setMsg(`Error: ${r.error}`);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-sm font-semibold text-neutral-900">{state.key}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceColor(state.source)}`}
              title="Origen del valor actual"
            >
              {sourceLabel(state.source)}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-600">{state.description}</p>
        </div>

        <div className="shrink-0">
          {state.type === "bool" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-neutral-900"
                checked={value === true}
                onChange={(e) => setValue(e.target.checked)}
              />
              <span className="font-medium">{value === true ? "true" : "false"}</span>
            </label>
          ) : null}

          {state.type === "enum" && state.options ? (
            <select
              className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
              value={String(value)}
              onChange={(e) => setValue(e.target.value)}
            >
              {state.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-neutral-500">
          {msg ?? (dirty ? "Sin guardar" : "")}
        </span>
        <Button
          size="sm"
          variant={dirty ? "brand" : "secondary"}
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
