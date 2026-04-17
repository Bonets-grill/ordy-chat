"use client";

// WhatsApp connection card — Evolution QR + status polling.
// Solo se renderiza cuando el tenant usa provider="evolution".

import { Loader2, QrCode, RefreshCw, Smartphone, Unplug } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "open" | "connecting" | "close" | "unknown";

type ApiResult = Record<string, unknown>;

async function evoAction(action: string, extra: Record<string, unknown> = {}): Promise<ApiResult> {
  const r = await fetch("/api/evolution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  return data;
}

function extractStatus(data: ApiResult): Status {
  // Evolution devuelve varias formas. Normalizamos.
  const candidates: unknown[] = [
    data?.state,
    data?.instance,
    (data?.instance as ApiResult)?.state,
    data?.status,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const s = c.toLowerCase();
      if (s.includes("open") || s === "connected") return "open";
      if (s.includes("connecting") || s === "qrcode") return "connecting";
      if (s.includes("close") || s === "disconnected") return "close";
    }
  }
  return "unknown";
}

function extractQr(data: ApiResult): string | null {
  const raw = (data?.base64 as string) || (data?.qrcode as ApiResult)?.base64 as string;
  if (!raw) return null;
  return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
}

function extractPairingCode(data: ApiResult): string | null {
  const code = (data?.code as string) || (data?.pairingCode as string) || (data?.qrcode as ApiResult)?.code as string;
  return code && typeof code === "string" ? code : null;
}

export function WhatsappConnection() {
  const [status, setStatus] = React.useState<Status>("unknown");
  const [qr, setQr] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"qr" | "pair">("qr");
  const [phone, setPhone] = React.useState("");

  const refreshStatus = React.useCallback(async () => {
    try {
      const data = await evoAction("status");
      const s = extractStatus(data);
      setStatus(s);
      if (s === "open") {
        setQr(null);
        setCode(null);
      }
    } catch (e) {
      setStatus("unknown");
    }
  }, []);

  React.useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 5000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  async function onGetQR() {
    setBusy(true); setError(null); setCode(null);
    try {
      const data = await evoAction("qr");
      setQr(extractQr(data));
      setStatus("connecting");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onGetPair() {
    setBusy(true); setError(null); setQr(null);
    try {
      const data = await evoAction("pair", { phoneNumber: phone });
      setCode(extractPairingCode(data));
      setStatus("connecting");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    if (!confirm("¿Desvincular WhatsApp? Tendrás que volver a escanear el QR.")) return;
    setBusy(true); setError(null);
    try {
      await evoAction("logout");
      setQr(null); setCode(null);
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Conexión WhatsApp</CardTitle>
            <CardDescription>
              {status === "open" && "Conectado — tu agente recibe y responde mensajes."}
              {status === "connecting" && "Esperando a que escanees el QR…"}
              {status === "close" && "Desconectado — vincula tu WhatsApp para empezar."}
              {status === "unknown" && "Comprobando estado…"}
            </CardDescription>
          </div>
          <StatusPill status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {status !== "open" && (
          <>
            <div className="flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setMode("qr")}
                className={`rounded-md px-3 py-1.5 ${mode === "qr" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}
              >
                <QrCode className="mr-1 inline h-3.5 w-3.5" /> Código QR
              </button>
              <button
                type="button"
                onClick={() => setMode("pair")}
                className={`rounded-md px-3 py-1.5 ${mode === "pair" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}
              >
                <Smartphone className="mr-1 inline h-3.5 w-3.5" /> Código de 8 caracteres
              </button>
            </div>

            {mode === "qr" ? (
              <div className="space-y-3">
                {qr ? (
                  <div className="flex flex-col items-center gap-3">
                    <img src={qr} alt="QR de WhatsApp" className="h-64 w-64 rounded-lg border border-neutral-200 bg-white p-2" />
                    <p className="text-center text-xs text-neutral-500">
                      Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo → escanea este QR.
                    </p>
                  </div>
                ) : (
                  <Button variant="brand" onClick={onGetQR} disabled={busy} className="gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                    Generar código QR
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+34600000000"
                    className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                  <Button variant="brand" onClick={onGetPair} disabled={busy || phone.replace(/\D/g, "").length < 8} className="gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                    Obtener código
                  </Button>
                </div>
                {code && (
                  <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-center">
                    <div className="text-xs font-medium uppercase tracking-wide text-brand-700">Tu código</div>
                    <div className="mt-1 font-mono text-3xl font-bold text-brand-900">{code}</div>
                    <div className="mt-2 text-xs text-brand-700">
                      WhatsApp → Dispositivos vinculados → Vincular con número → pega este código.
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {status === "open" && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={refreshStatus} disabled={busy} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Comprobar estado
            </Button>
            <Button variant="ghost" onClick={onLogout} disabled={busy} className="gap-2 text-red-600 hover:text-red-700">
              <Unplug className="h-4 w-4" /> Desvincular
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map = {
    open: { label: "Conectado", cls: "bg-emerald-100 text-emerald-700" },
    connecting: { label: "Esperando…", cls: "bg-amber-100 text-amber-700" },
    close: { label: "Desconectado", cls: "bg-neutral-200 text-neutral-700" },
    unknown: { label: "—", cls: "bg-neutral-100 text-neutral-500" },
  } as const;
  const { label, cls } = map[status];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{label}</span>;
}
