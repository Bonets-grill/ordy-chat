"use client";

import { useState, useTransition } from "react";
import { setHandoffPhoneAction } from "./handoff-action";

export function HandoffCard({ initialPhone }: { initialPhone: string | null }) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await setHandoffPhoneAction(phone);
      if (!res.ok) {
        setMsg(`Error: ${res.error}`);
        return;
      }
      setMsg(res.phone ? "Guardado — avisos llegarán a ese WhatsApp." : "Avisos WA desactivados.");
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-base font-semibold text-neutral-900">
        Escalada a humano — WhatsApp
      </h3>
      <p className="mt-1 text-sm text-neutral-500">
        Cuando el bot no pueda ayudar a un cliente ("necesito hablar con una
        persona", alergia grave, queja, etc.) escalará y avisaremos a este
        número por WhatsApp con el nombre del cliente y el motivo. Deja
        vacío si no quieres avisos WA (los handoffs seguirán quedando
        registrados en el dashboard).
      </p>
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Teléfono (con código país, ej 34604342381)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="34604342381"
            disabled={pending}
            className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
          />
        </div>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs text-neutral-600">{msg}</p>}
    </div>
  );
}
