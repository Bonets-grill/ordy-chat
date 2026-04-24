"use client";

// Mig 040. Editor de la lista de teléfonos WA que reciben reportes POS.
// Lista editable: añadir / quitar / guardar. PATCH a /api/agent/pos-reports.

import { useState, useTransition } from "react";

const PHONE_REGEX = /^\+?[0-9]{6,18}$/;

export function PosReportsEditor({
  initialPhones,
  fallback,
}: {
  initialPhones: string[];
  fallback: string | null;
}) {
  const [phones, setPhones] = useState<string[]>(initialPhones);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addPhone() {
    const candidate = draft.trim();
    if (!PHONE_REGEX.test(candidate)) {
      setMsg("Formato inválido. Usa dígitos (6-18), con o sin +.");
      return;
    }
    const normalized = candidate.replace(/^\+/, "");
    if (phones.includes(normalized)) {
      setMsg("Ese número ya está en la lista.");
      return;
    }
    setPhones([...phones, normalized]);
    setDraft("");
    setMsg(null);
  }

  function removePhone(idx: number) {
    setPhones(phones.filter((_, i) => i !== idx));
  }

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/agent/pos-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phones }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        setMsg(`Error: ${err.error ?? "no se pudo guardar"}`);
        return;
      }
      const data = await res.json();
      setPhones(data.phones ?? phones);
      setMsg(
        phones.length === 0
          ? fallback
            ? `Lista vacía — usaremos el teléfono de escalada (${fallback.slice(-4)}) como fallback.`
            : "Lista vacía — los reportes POS NO se enviarán hasta que añadas un número."
          : "Guardado.",
      );
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-base font-semibold text-neutral-900">Teléfonos que reciben los reportes</h3>
      <p className="mt-1 text-sm text-neutral-500">
        Los mensajes llegan desde el número de WhatsApp de tu negocio (el
        mismo que atiende a los clientes). Añade los teléfonos del dueño,
        encargado o contable — los que deban ver el cuadre.
      </p>

      {fallback && phones.length === 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Si dejas la lista vacía, los reportes llegarán al número de
          escalada que ya tienes configurado (…{fallback.slice(-4)}).
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {phones.map((p, idx) => (
          <li
            key={`${p}-${idx}`}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
          >
            <span className="font-mono text-sm text-neutral-800">+{p}</span>
            <button
              onClick={() => removePhone(idx)}
              disabled={pending}
              className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              Quitar
            </button>
          </li>
        ))}
        {phones.length === 0 && (
          <li className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 text-sm text-neutral-500">
            No hay teléfonos configurados.
          </li>
        )}
      </ul>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Añadir teléfono (ej 34604342381)
          </label>
          <input
            type="tel"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="34604342381"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
          />
        </div>
        <button
          onClick={addPhone}
          disabled={pending || draft.trim().length === 0}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
        >
          Añadir
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Máximo 10 teléfonos. Los reportes se envían en secuencia (uno por
          número, best-effort).
        </p>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {msg && <p className="mt-3 text-xs text-neutral-600">{msg}</p>}
    </div>
  );
}
