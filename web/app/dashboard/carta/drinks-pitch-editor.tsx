"use client";

// Editor del pitch de bebidas (mig 031). El tenant escribe qué bebidas
// ofrecer LITERALMENTE en el primer turno del flujo QR-de-mesa. El bot
// las dice tal cual y no inventa.

import { useState, useTransition } from "react";
import { setDrinksGreetingPitchAction } from "./drinks-pitch-action";

export function DrinksPitchEditor({ initialPitch }: { initialPitch: string | null }) {
  const [pitch, setPitch] = useState(initialPitch ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await setDrinksGreetingPitchAction(pitch);
      if (!res.ok) {
        setMsg(`Error: ${res.error}`);
        return;
      }
      setMsg(
        res.pitch
          ? "Guardado — el mesero ofrecerá estas bebidas en cada mesa."
          : "Sin pitch — el mesero preguntará qué bebida les apetece.",
      );
    });
  }

  const charCount = pitch.length;
  const overLimit = charCount > 500;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-base font-semibold text-neutral-900">
        Bebidas para ofrecer en mesa
      </h3>
      <p className="mt-1 text-sm text-neutral-500">
        Cuando un cliente escanea el QR de su mesa y abre el chat, el mesero
        le ofrece bebidas antes que la comida (para que el bar las vaya
        preparando mientras el cliente mira la carta). Escribe aquí qué
        bebidas ofrecer — el mesero las dirá <strong>literalmente</strong>,
        sin inventar. Deja vacío si prefieres que el mesero pregunte
        abiertamente &quot;¿qué os apetece beber?&quot;.
      </p>
      <div className="mt-4">
        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Pitch de bebidas (máx 500 caracteres)
        </label>
        <textarea
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          placeholder="Ej: Tenemos caña Tropical, tinto de verano, mojito de fresa y agua mineral."
          disabled={pending}
          rows={3}
          className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
        />
        <div className="mt-1 flex items-center justify-between">
          <span
            className={`text-[11px] ${overLimit ? "text-rose-600" : "text-neutral-400"}`}
          >
            {charCount} / 500
          </span>
          <button
            onClick={save}
            disabled={pending || overLimit}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-neutral-600">{msg}</p>}
    </div>
  );
}
