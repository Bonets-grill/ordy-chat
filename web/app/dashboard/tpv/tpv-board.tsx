// web/app/dashboard/tpv/tpv-board.tsx
//
// Cliente UI para gestionar Stripe Terminal: ver lectores, emparejar uno nuevo,
// desemparejar, ver estado Connect.
//
// Mig 045.

"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Reader = {
  id: string;
  readerId: string;
  label: string | null;
  serialNumber: string | null;
  status: "online" | "offline";
  lastSeenAt: string | null;
};

export function TpvBoard({
  initialReaders,
  connected,
  accountId,
  locationId,
}: {
  initialReaders: Reader[];
  connected: boolean;
  accountId: string | null;
  locationId: string | null;
}) {
  const [readers, setReaders] = React.useState<Reader[]>(initialReaders);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [showPair, setShowPair] = React.useState(false);
  const [registrationCode, setRegistrationCode] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function refreshReaders() {
    try {
      const res = await fetch("/api/stripe/terminal/readers");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(`No se pudieron cargar los lectores: ${body.error ?? res.status}`);
        return;
      }
      const body = (await res.json()) as { readers: Reader[] };
      setReaders(body.readers);
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    }
  }

  async function pairReader(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/stripe/terminal/readers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationCode: registrationCode.trim(),
          label: label.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? body.error ?? `Error ${res.status} al emparejar`);
        return;
      }
      setInfo("Lector emparejado correctamente.");
      setRegistrationCode("");
      setLabel("");
      setShowPair(false);
      await refreshReaders();
    } finally {
      setBusy(false);
    }
  }

  async function unpairReader(reader: Reader) {
    if (!confirm(`Desemparejar "${reader.label ?? reader.readerId}"?`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/stripe/terminal/readers/${reader.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Error ${res.status} al desemparejar`);
        return;
      }
      setInfo("Lector desemparejado.");
      await refreshReaders();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-neutral-900">TPV — Lectores Stripe Terminal</h1>
        <p className="mt-1 text-neutral-500">
          Conecta tu lector físico (BBPOS WisePad 3, etc.) y cobra directo desde el KDS.
          El cobro se confirma automáticamente cuando Stripe procesa la tarjeta.
        </p>
      </header>

      {!connected && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-900">Stripe Connect no configurado</CardTitle>
            <CardDescription className="text-amber-800">
              Para cobrar en TPV físico necesitas una cuenta Stripe Connect Standard
              vinculada a tu negocio. Hoy esto se configura desde el panel de super admin.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-amber-900 space-y-2">
            <p><strong>Pasos:</strong></p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Crea (o inicia sesión en) tu cuenta Stripe en <a href="https://dashboard.stripe.com" target="_blank" rel="noopener" className="underline">dashboard.stripe.com</a>.</li>
              <li>Ve a Connect → Estándar y completa el onboarding (datos fiscales, IBAN, verificación de identidad).</li>
              <li>Stripe te dará un identificador tipo <code className="bg-amber-100 px-1 rounded">acct_1ABC...</code>.</li>
              <li>Pásalo al equipo Ordy para que lo registre en tu tenant (mientras montamos el flujo OAuth).</li>
              <li>Crea una location de Stripe Terminal en el dashboard (Connect &rarr; Terminal &rarr; Locations) — necesario para registrar lectores.</li>
            </ol>
          </CardContent>
        </Card>
      )}

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexión Stripe Connect</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-neutral-700 space-y-1">
            <div>
              <span className="text-neutral-500">Cuenta:</span>{" "}
              <code className="bg-neutral-100 px-1 rounded">{accountId}</code>
            </div>
            {locationId ? (
              <div>
                <span className="text-neutral-500">Location Terminal:</span>{" "}
                <code className="bg-neutral-100 px-1 rounded">{locationId}</code>
              </div>
            ) : (
              <div className="text-amber-700">
                Sin <strong>location</strong> configurada. Crea una en Stripe Dashboard antes de emparejar lectores.
              </div>
            )}
            <div className="pt-2 text-xs text-neutral-500">
              Coste por transacción: <strong>1.4% + 0.25 €</strong> (tarjetas EU).
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {info}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-900">Lectores emparejados</h2>
          {connected && (
            <Button
              type="button"
              onClick={() => setShowPair((v) => !v)}
              disabled={busy}
            >
              {showPair ? "Cancelar" : "+ Emparejar lector"}
            </Button>
          )}
        </div>

        {showPair && connected && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emparejar nuevo lector</CardTitle>
              <CardDescription>
                Pulsa los 3 puntos en el lector físico para mostrar un código de
                registro de 4 palabras (ej. <code>chip-shy-rocky-train</code>) y
                pégalo aquí. Para pruebas usa <code>simulated-wpe</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={pairReader} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-neutral-600">
                    Código de registro
                  </label>
                  <input
                    type="text"
                    value={registrationCode}
                    onChange={(e) => setRegistrationCode(e.target.value)}
                    placeholder="chip-shy-rocky-train"
                    required
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wider text-neutral-600">
                    Alias (opcional)
                  </label>
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Caja principal"
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
                <Button type="submit" disabled={busy || !registrationCode.trim()}>
                  {busy ? "Emparejando…" : "Emparejar"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {readers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            No hay lectores emparejados. {connected ? 'Pulsa "Emparejar lector" para añadir el primero.' : 'Configura Stripe Connect primero.'}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {readers.map((r) => (
              <Card key={r.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{r.label ?? r.readerId}</CardTitle>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        r.status === "online"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-xs text-neutral-600 space-y-1">
                  <div>Reader ID: <code>{r.readerId}</code></div>
                  {r.serialNumber && (
                    <div>Serial: <code>{r.serialNumber}</code></div>
                  )}
                  {r.lastSeenAt && (
                    <div>Última conexión: {new Date(r.lastSeenAt).toLocaleString("es-ES")}</div>
                  )}
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => unpairReader(r)}
                      disabled={busy}
                    >
                      Desemparejar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
        <h3 className="font-semibold text-neutral-900">Cómo cobrar desde el KDS</h3>
        <ol className="mt-2 list-decimal pl-5 space-y-1">
          <li>Ve al KDS (Cocina &amp; Bar).</li>
          <li>Cuando un cliente quiera pagar, en la tarjeta del pedido elige método <strong>Tarjeta</strong>.</li>
          <li>Pulsa <strong>Cobrar en TPV</strong>. El lector pedirá la tarjeta.</li>
          <li>Cuando Stripe confirma el pago, el pedido pasa a <strong>Pagado</strong> automáticamente.</li>
          <li>Si la tarjeta falla, puedes reintentar o caer al cobro manual.</li>
        </ol>
        <div className="mt-3 text-xs text-neutral-500">
          <strong>Limitaciones del MVP:</strong> sin modo offline, sin propinas en el lector, sin
          recibo email automático en el momento (el recibo se genera y envía si el comensal ya
          tiene email registrado en la orden).
        </div>
      </section>
    </div>
  );
}
