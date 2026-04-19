"use client";

import * as React from "react";
import { CalendarX, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CLOSED_DAYS_MAX } from "@/lib/agent/closed-days";
import { setClosedDaysAction } from "./actions";

type Props = {
  initialDates: string[];
  today: string;
};

export function ClosedDaysCalendar({ initialDates, today }: Props) {
  const [dates, setDates] = React.useState<string[]>(initialDates);
  const [draft, setDraft] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const dirty = !sameArray(dates, initialDates);
  const todayClosed = dates.includes(today);

  function addDate() {
    if (!draft) return;
    if (draft < today) {
      setMsg({ tone: "err", text: "No puedes añadir fechas pasadas." });
      return;
    }
    if (dates.includes(draft)) {
      setDraft("");
      return;
    }
    if (dates.length >= CLOSED_DAYS_MAX) {
      setMsg({ tone: "err", text: `Máximo ${CLOSED_DAYS_MAX} fechas.` });
      return;
    }
    setDates([...dates, draft].sort());
    setDraft("");
    setMsg(null);
  }

  function removeDate(d: string) {
    setDates(dates.filter((x) => x !== d));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await setClosedDaysAction({ dates });
    setSaving(false);
    if (res.ok) {
      setDates(res.dates);
      setMsg({ tone: "ok", text: "Guardado. El agente ya aplica la regla." });
    } else {
      setMsg({ tone: "err", text: res.error || "Error al guardar." });
    }
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarX className="h-5 w-5 text-neutral-500" />
          Fechas bloqueadas
        </CardTitle>
        <CardDescription>
          El bot rechazará reservas solo en estos días concretos. Para horarios regulares usa el campo &ldquo;Horario&rdquo; de Mi agente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {todayClosed ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <Badge tone="warn">HOY</Badge>
            <span>
              El agente no acepta reservas para hoy (<strong>{today}</strong>).
            </span>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Input
            type="date"
            min={today}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-11 max-w-[180px]"
            aria-label="Nueva fecha cerrada"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={addDate}
            disabled={!draft || dates.length >= CLOSED_DAYS_MAX}
          >
            <Plus className="mr-1 h-4 w-4" /> Añadir día
          </Button>
        </div>

        {dates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
            No hay fechas bloqueadas. Tu agente acepta reservas todos los días.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {dates.map((d) => (
              <li
                key={d}
                className="group inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm"
              >
                <span className={d === today ? "font-semibold text-amber-700" : "text-neutral-900"}>
                  {d}
                </span>
                <button
                  type="button"
                  onClick={() => removeDate(d)}
                  className="rounded-full p-0.5 text-neutral-400 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Eliminar ${d}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between border-t border-neutral-100 pt-4">
          <p className="text-xs text-neutral-500">
            {dates.length} / {CLOSED_DAYS_MAX} fechas.
          </p>
          <div className="flex items-center gap-3">
            {msg ? (
              <span
                className={
                  msg.tone === "ok"
                    ? "text-sm text-emerald-700"
                    : "text-sm text-red-600"
                }
              >
                {msg.text}
              </span>
            ) : null}
            <Button type="button" onClick={save} disabled={!dirty || saving}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
