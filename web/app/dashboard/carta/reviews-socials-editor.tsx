"use client";

// Editor de enlaces de reseña + redes sociales (mig 033). El agente los
// comparte en el flujo post-cuenta (cuando status de la mesa pasa a
// billing/paid). Todos opcionales.

import { useState, useTransition } from "react";
import { setReviewsSocialsAction } from "./reviews-socials-action";

type Props = {
  initial: {
    reviewGoogleUrl: string | null;
    reviewTripadvisorUrl: string | null;
    socialInstagramUrl: string | null;
    socialFacebookUrl: string | null;
    socialTiktokUrl: string | null;
  };
};

const FIELDS: Array<{
  key: keyof Props["initial"];
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    key: "reviewGoogleUrl",
    label: "Google (reseña)",
    placeholder: "https://g.page/r/...",
    hint: "El enlace de tu Google Business para que los clientes dejen reseña.",
  },
  {
    key: "reviewTripadvisorUrl",
    label: "TripAdvisor (reseña)",
    placeholder: "https://www.tripadvisor.com/...",
    hint: "Si prefieres que la reseña vaya a TripAdvisor.",
  },
  {
    key: "socialInstagramUrl",
    label: "Instagram",
    placeholder: "https://instagram.com/tu_cuenta",
    hint: "El agente lo comparte tras cobrar para que os sigan.",
  },
  {
    key: "socialFacebookUrl",
    label: "Facebook",
    placeholder: "https://facebook.com/tu-pagina",
    hint: "",
  },
  {
    key: "socialTiktokUrl",
    label: "TikTok",
    placeholder: "https://www.tiktok.com/@tu_cuenta",
    hint: "",
  },
];

export function ReviewsSocialsEditor({ initial }: Props) {
  const [state, setState] = useState({
    reviewGoogleUrl: initial.reviewGoogleUrl ?? "",
    reviewTripadvisorUrl: initial.reviewTripadvisorUrl ?? "",
    socialInstagramUrl: initial.socialInstagramUrl ?? "",
    socialFacebookUrl: initial.socialFacebookUrl ?? "",
    socialTiktokUrl: initial.socialTiktokUrl ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await setReviewsSocialsAction(state);
      if (!res.ok) {
        setMsg(`Error: ${res.error}`);
        return;
      }
      setMsg("Guardado. El mesero los compartirá tras cobrar.");
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="text-base font-semibold text-neutral-900">
        Reseñas y redes sociales
      </h3>
      <p className="mt-1 text-sm text-neutral-500">
        El mesero los comparte educadamente tras cobrar la mesa, para pedir
        reseña y que los clientes os sigan. Todos opcionales — deja vacío
        lo que no uses.
      </p>
      <div className="mt-4 space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500">
              {f.label}
            </label>
            <input
              type="url"
              inputMode="url"
              value={state[f.key]}
              onChange={(e) =>
                setState((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              placeholder={f.placeholder}
              disabled={pending}
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
            />
            {f.hint && <p className="mt-1 text-[11px] text-neutral-400">{f.hint}</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-neutral-500">{msg ?? ""}</span>
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
