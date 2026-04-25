"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

type SetupResponse =
  | { enabled: true; since: string }
  | { enabled: false; secret: string; otpauth_uri: string };

export function TotpSetupForm({
  email: _email,
  enabledAt,
}: {
  email: string;
  enabledAt: string | null;
}) {
  const [status, setStatus] = useState<"loading" | "enabled" | "setup" | "error">(
    enabledAt ? "enabled" : "loading",
  );
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (status !== "loading") return;
    fetch("/api/account/totp/setup")
      .then((r) => r.json())
      .then((data: SetupResponse) => {
        if (data.enabled) {
          setStatus("enabled");
        } else {
          setSetup({ secret: data.secret, uri: data.otpauth_uri });
          setStatus("setup");
        }
      })
      .catch(() => {
        setError("No se pudo cargar el setup");
        setStatus("error");
      });
  }, [status]);

  useEffect(() => {
    if (status !== "setup" || !setup || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, setup.uri, { width: 220 });
  }, [status, setup]);

  function activate() {
    setError(null);
    if (!/^\d{6}$/.test(token)) {
      setError("El código debe ser de 6 dígitos");
      return;
    }
    start(async () => {
      const res = await fetch("/api/account/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToken("");
        setStatus("enabled");
      } else {
        setError(data.error ?? `Error ${res.status}`);
      }
    });
  }

  function disable() {
    setError(null);
    if (!/^\d{6}$/.test(token)) {
      setError("Introduce un código actual de tu app para confirmar");
      return;
    }
    start(async () => {
      const res = await fetch("/api/account/totp/setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToken("");
        setStatus("loading"); // recarga setup nuevo
      } else {
        setError(data.error ?? `Error ${res.status}`);
      }
    });
  }

  if (status === "loading") {
    return <p className="text-sm text-neutral-500">Cargando…</p>;
  }

  if (status === "error") {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (status === "enabled") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-emerald-700">
          ✓ 2FA activo
          {enabledAt ? ` desde ${new Date(enabledAt).toLocaleDateString("es-ES")}` : ""}.
        </p>
        <p className="text-sm text-neutral-600">
          Para desactivar, introduce un código actual de tu app:
        </p>
        <div className="flex gap-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg"
          />
          <Button type="button" variant="ghost" onClick={disable} disabled={pending}>
            Desactivar
          </Button>
        </div>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  // status === "setup"
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-700">
        <li>
          Abre tu app autenticadora (Google Authenticator, 1Password, Authy…) y
          escanea este QR.
        </li>
        <li>
          O introduce manualmente el secret:{" "}
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">
            {setup?.secret}
          </code>
        </li>
        <li>Pega aquí el código de 6 dígitos que te muestra para confirmar.</li>
      </ol>
      <canvas ref={canvasRef} className="rounded-md border border-neutral-200" />
      <div className="flex gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-center font-mono text-lg"
        />
        <Button type="button" variant="primary" onClick={activate} disabled={pending}>
          {pending ? "Activando…" : "Activar 2FA"}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
