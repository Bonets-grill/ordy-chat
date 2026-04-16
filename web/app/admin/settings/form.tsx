"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEYS = [
  "anthropic_api_key",
  "stripe_secret_key",
  "stripe_webhook_secret",
  "stripe_price_id",
  "whapi_default_token",
  "platform_url",
] as const;

export function SettingsForm({
  populated,
  descriptions,
}: {
  populated: Record<string, boolean>;
  descriptions: Record<string, string>;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) {
      setMsg("No hay cambios.");
      setSaving(false);
      return;
    }
    const r = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: Object.fromEntries(entries) }),
    });
    setSaving(false);
    setMsg(r.ok ? "Guardado." : "Error.");
    if (r.ok) setValues({});
  }

  return (
    <div className="space-y-5">
      {KEYS.map((k) => (
        <div key={k} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-neutral-700">{k}</label>
            {populated[k] && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">configurada</span>}
          </div>
          {descriptions[k] && <p className="text-xs text-neutral-500">{descriptions[k]}</p>}
          <Input
            type={k.includes("secret") || k.includes("key") || k.includes("token") ? "password" : "text"}
            placeholder={populated[k] ? "•••••• (dejar vacío para no cambiar)" : "Pega el valor aquí"}
            value={values[k] ?? ""}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })}
          />
        </div>
      ))}

      <div className="flex items-center gap-3 pt-4">
        <Button variant="brand" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
        {msg && <span className="text-sm text-neutral-500">{msg}</span>}
      </div>
    </div>
  );
}
