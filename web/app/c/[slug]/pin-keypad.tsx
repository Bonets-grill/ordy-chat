"use client";

// PIN keypad full-screen. Cada empleado escribe su PIN de 4-6 dígitos.
// Reload tras login para que el server-component renderice el board.

import { useState, useTransition } from "react";
import { Delete, LogIn } from "lucide-react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function PinKeypad({
  tenantSlug,
  tenantName,
}: {
  tenantSlug: string;
  tenantName: string;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function append(d: string) {
    setError(null);
    setPin((p) => (p.length >= 6 ? p : p + d));
  }
  function back() {
    setError(null);
    setPin((p) => p.slice(0, -1));
  }
  function submit() {
    if (pin.length < 4) {
      setError("PIN mínimo 4 dígitos");
      return;
    }
    start(async () => {
      const r = await fetch("/api/comandero/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug, pin }),
      });
      if (!r.ok) {
        setPin("");
        setError("PIN incorrecto");
        return;
      }
      window.location.reload();
    });
  }

  const filled = pin.length;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-950 px-6 py-10 text-white">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-stone-400">
          Comandero
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">
          {tenantName}
        </h1>
        <p className="mt-2 text-sm text-stone-400">Introduce tu PIN para continuar</p>
      </header>

      <div className="mb-8 flex gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border ${
              i < filled
                ? "border-emerald-400 bg-emerald-400"
                : "border-stone-600 bg-transparent"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={pending}
            onClick={() => append(k)}
            className="h-20 w-20 rounded-2xl bg-stone-800 text-2xl font-semibold text-white shadow-md transition active:scale-95 hover:bg-stone-700 disabled:opacity-50"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          disabled={pending || pin.length === 0}
          onClick={back}
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-stone-700 text-stone-200 shadow-md transition active:scale-95 hover:bg-stone-600 disabled:opacity-50"
          aria-label="Borrar"
        >
          <Delete size={22} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => append("0")}
          className="h-20 w-20 rounded-2xl bg-stone-800 text-2xl font-semibold text-white shadow-md transition active:scale-95 hover:bg-stone-700 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          disabled={pending || pin.length < 4}
          onClick={submit}
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md transition active:scale-95 hover:bg-emerald-500 disabled:opacity-30"
          aria-label="Entrar"
        >
          <LogIn size={22} />
        </button>
      </div>

      {error ? (
        <p className="mt-6 text-sm text-red-400">{error}</p>
      ) : (
        <p className="mt-6 text-xs text-stone-500">{pending ? "Verificando…" : ""}</p>
      )}
    </div>
  );
}
