"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Initial = {
  agentName: string;
  tone: "professional" | "friendly" | "sales" | "empathetic";
  schedule: string;
  systemPrompt: string;
  paused: boolean;
};

export function AgentEditor({ tenantId, initial }: { tenantId: string; initial: Initial }) {
  const [form, setForm] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    const r = await fetch("/api/agent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, ...form }),
    });
    setSaving(false);
    setMsg(r.ok ? "Guardado" : "Error al guardar");
    setTimeout(() => setMsg(null), 3000);
  }

  async function togglePause() {
    const next = !form.paused;
    setForm((f) => ({ ...f, paused: next }));
    await fetch("/api/agent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, paused: next }),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identidad</CardTitle>
          <CardDescription>Nombre, tono y horario del agente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Nombre del agente</label>
            <Input value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Tono</label>
            <select
              value={form.tone}
              onChange={(e) => setForm({ ...form, tone: e.target.value as Initial["tone"] })}
              className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm"
            >
              <option value="professional">Profesional</option>
              <option value="friendly">Amigable</option>
              <option value="sales">Vendedor</option>
              <option value="empathetic">Empático</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-neutral-700">Horario</label>
            <Input value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System prompt</CardTitle>
          <CardDescription>El alma del agente. Editá con cuidado — cambios afectan todas las respuestas.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={18}
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4">
        <div>
          <div className="font-medium text-neutral-900">{form.paused ? "Agente pausado" : "Agente activo"}</div>
          <div className="text-sm text-neutral-500">{form.paused ? "No está respondiendo a nadie." : "Responde automáticamente a todos los mensajes entrantes."}</div>
        </div>
        <Button variant={form.paused ? "brand" : "secondary"} onClick={togglePause}>
          {form.paused ? "Reactivar" : "Pausar"}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="brand" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
        {msg && <span className="text-sm text-neutral-500">{msg}</span>}
      </div>
    </div>
  );
}
