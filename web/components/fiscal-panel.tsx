"use client";

import { CheckCircle2, FileKey, Loader2, Shield, Upload } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type FiscalState = {
  tenant: {
    legalName: string | null;
    taxId: string | null;
    billingAddress: string | null;
    billingPostalCode: string | null;
    billingCity: string | null;
    billingCountry: string;
    brandColor: string;
    brandLogoUrl: string | null;
    defaultVatRate: string;
  };
  fiscalConfig: null | {
    verifactuEnabled: boolean;
    verifactuEnvironment: "sandbox" | "production";
    invoiceSeries: string;
    invoiceCounter: number;
    certificateFilename: string | null;
    certificateUploadedAt: string | null;
    certificateExpiresAt: string | null;
    hasCertificate: boolean;
  };
};

type TenantPatch = Partial<Omit<FiscalState["tenant"], "defaultVatRate">> & {
  invoiceSeries?: string;
  defaultVatRate?: number;
};

export function FiscalPanel() {
  const [state, setState] = React.useState<FiscalState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    fetch("/api/fiscal")
      .then((r) => r.json())
      .then(setState)
      .catch(() => setMsg({ type: "error", text: "No se pudo cargar la configuración" }));
  }, []);

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración…
      </div>
    );
  }

  async function saveTenantFields(patch: TenantPatch) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/fiscal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      const fresh = await (await fetch("/api/fiscal")).json();
      setState(fresh);
      setMsg({ type: "success", text: "Guardado" });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleVerifactu(enabled: boolean) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/fiscal/verifactu", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? data.error ?? "Error");
      const fresh = await (await fetch("/api/fiscal")).json();
      setState(fresh);
      setMsg({ type: "success", text: enabled ? "Verifactu activado" : "Verifactu desactivado" });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadCertificate(file: File, password: string) {
    setSaving(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("password", password);
      const r = await fetch("/api/fiscal/verifactu", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message ?? data.error ?? "Error");
      const fresh = await (await fetch("/api/fiscal")).json();
      setState(fresh);
      setMsg({ type: "success", text: `Certificado cargado: ${data.certificate.subject}` });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCertificate() {
    if (!confirm("¿Eliminar certificado digital? Verifactu se desactivará automáticamente.")) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/fiscal/verifactu", { method: "DELETE" });
      if (!r.ok) throw new Error("Error");
      const fresh = await (await fetch("/api/fiscal")).json();
      setState(fresh);
      setMsg({ type: "success", text: "Certificado eliminado" });
    } catch (e) {
      setMsg({ type: "error", text: e instanceof Error ? e.message : "Error" });
    } finally {
      setSaving(false);
    }
  }

  const expired = state.fiscalConfig?.certificateExpiresAt
    ? new Date(state.fiscalConfig.certificateExpiresAt).getTime() < Date.now()
    : false;

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            msg.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ── 1. Datos fiscales ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Datos fiscales</CardTitle>
          <CardDescription>Aparecerán en los recibos y facturas. Obligatorio para operar en España.</CardDescription>
        </CardHeader>
        <CardContent>
          <TenantForm state={state.tenant} onSave={saveTenantFields} saving={saving} />
        </CardContent>
      </Card>

      {/* ── 2. Branding ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Color y logo que aparecerán en recibos y emails a tus comensales.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrandingForm state={state.tenant} onSave={saveTenantFields} saving={saving} />
        </CardContent>
      </Card>

      {/* ── 3. Verifactu ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-brand-600" />
                Verifactu (AEAT)
              </CardTitle>
              <CardDescription className="mt-1">
                Firma y envía cada recibo a la AEAT según RD 1007/2023. Opcional — actívalo cuando quieras emitir facturas con código QR oficial.
              </CardDescription>
            </div>
            <VerifactuStatusBadge enabled={state.fiscalConfig?.verifactuEnabled ?? false} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <CertificateBlock
            filename={state.fiscalConfig?.certificateFilename ?? null}
            uploadedAt={state.fiscalConfig?.certificateUploadedAt ?? null}
            expiresAt={state.fiscalConfig?.certificateExpiresAt ?? null}
            expired={expired}
            onUpload={uploadCertificate}
            onDelete={deleteCertificate}
            saving={saving}
          />
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div>
              <div className="font-medium text-neutral-900">Activar envío a AEAT</div>
              <p className="text-sm text-neutral-500">
                {state.fiscalConfig?.hasCertificate
                  ? `Entorno: ${state.fiscalConfig.verifactuEnvironment === "production" ? "Producción (real)" : "Sandbox (pruebas)"}`
                  : "Sube primero tu certificado digital para activar."}
              </p>
            </div>
            <Toggle
              checked={state.fiscalConfig?.verifactuEnabled ?? false}
              disabled={saving || !state.fiscalConfig?.hasCertificate || expired}
              onChange={(v) => toggleVerifactu(v)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TenantForm({
  state,
  onSave,
  saving,
}: {
  state: FiscalState["tenant"];
  onSave: (patch: TenantPatch) => void;
  saving: boolean;
}) {
  const [legalName, setLegalName] = React.useState(state.legalName ?? "");
  const [taxId, setTaxId] = React.useState(state.taxId ?? "");
  const [billingAddress, setBillingAddress] = React.useState(state.billingAddress ?? "");
  const [billingPostalCode, setBillingPostalCode] = React.useState(state.billingPostalCode ?? "");
  const [billingCity, setBillingCity] = React.useState(state.billingCity ?? "");
  const [billingCountry, setBillingCountry] = React.useState(state.billingCountry);
  const [defaultVatRate, setDefaultVatRate] = React.useState(parseFloat(state.defaultVatRate));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ legalName, taxId, billingAddress, billingPostalCode, billingCity, billingCountry, defaultVatRate });
      }}
      className="space-y-4"
    >
      <Field label="Razón social" value={legalName} onChange={setLegalName} placeholder="Ej: Restaurante Bonets S.L." />
      <Field label="NIF / CIF" value={taxId} onChange={setTaxId} placeholder="B12345678" />
      <Field label="Dirección" value={billingAddress} onChange={setBillingAddress} placeholder="Calle Mayor, 10" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código postal" value={billingPostalCode} onChange={setBillingPostalCode} placeholder="38000" />
        <Field label="Ciudad" value={billingCity} onChange={setBillingCity} placeholder="Santa Cruz de Tenerife" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="País (ISO 2)" value={billingCountry} onChange={(v) => setBillingCountry(v.toUpperCase().slice(0, 2))} placeholder="ES" />
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-neutral-700">IVA por defecto (%)</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={String(defaultVatRate)}
            onChange={(e) => setDefaultVatRate(parseFloat(e.target.value) || 0)}
          />
          <p className="text-xs text-neutral-500">Hostelería 10% estándar · Alcohol 21%</p>
        </div>
      </div>
      <Button type="submit" variant="brand" disabled={saving}>
        {saving ? "Guardando…" : "Guardar datos fiscales"}
      </Button>
    </form>
  );
}

function BrandingForm({
  state,
  onSave,
  saving,
}: {
  state: FiscalState["tenant"];
  onSave: (patch: TenantPatch) => void;
  saving: boolean;
}) {
  const [brandColor, setBrandColor] = React.useState(state.brandColor);
  const [brandLogoUrl, setBrandLogoUrl] = React.useState(state.brandLogoUrl ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ brandColor, brandLogoUrl: brandLogoUrl.trim() || null });
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">Color principal</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={brandColor}
            onChange={(e) => setBrandColor(e.target.value)}
            className="h-11 w-20 cursor-pointer rounded-md border border-neutral-200"
          />
          <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} placeholder="#7c3aed" className="flex-1" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-neutral-700">URL del logo (PNG, fondo transparente)</label>
        <Input
          type="url"
          value={brandLogoUrl}
          onChange={(e) => setBrandLogoUrl(e.target.value)}
          placeholder="https://cdn.tudominio.com/logo.png"
        />
        <p className="text-xs text-neutral-500">Sube el logo a tu propio alojamiento (Cloudinary, imgur, tu web) y pega la URL aquí.</p>
      </div>
      {brandLogoUrl && (
        <div className="rounded-lg border border-dashed border-neutral-200 bg-white p-4">
          <div className="mb-2 text-xs font-medium text-neutral-500">Vista previa</div>
          <img src={brandLogoUrl} alt="Logo" className="max-h-16" onError={(e) => (e.currentTarget.style.display = "none")} />
        </div>
      )}
      <Button type="submit" variant="brand" disabled={saving}>
        {saving ? "Guardando…" : "Guardar branding"}
      </Button>
    </form>
  );
}

function CertificateBlock({
  filename,
  uploadedAt,
  expiresAt,
  expired,
  onUpload,
  onDelete,
  saving,
}: {
  filename: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  onUpload: (file: File, password: string) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [password, setPassword] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (filename) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileKey className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <div className="font-medium text-emerald-900">{filename}</div>
              <div className="mt-0.5 text-xs text-emerald-700">
                Subido {uploadedAt ? new Date(uploadedAt).toLocaleDateString("es-ES") : ""} ·
                {expired ? (
                  <strong className="ml-1 text-red-700">EXPIRADO</strong>
                ) : expiresAt ? (
                  <span className="ml-1">Expira {new Date(expiresAt).toLocaleDateString("es-ES")}</span>
                ) : null}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={onDelete} disabled={saving} className="text-red-600 hover:text-red-700">
            Eliminar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-neutral-700">Certificado digital (.p12 / .pfx)</label>
        <p className="text-xs text-neutral-500">La firma digital es responsabilidad del tenant. Subida segura: el archivo se cifra antes de guardarse.</p>
      </div>
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".p12,.pfx"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button variant="secondary" type="button" onClick={() => inputRef.current?.click()} className="gap-2">
          <Upload className="h-4 w-4" />
          {file ? file.name : "Elegir archivo"}
        </Button>
        {file && <span className="text-xs text-neutral-500">{Math.round(file.size / 1024)} KB</span>}
      </div>
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña del certificado"
        disabled={!file}
      />
      <Button
        variant="brand"
        disabled={!file || !password || saving}
        onClick={() => file && password && onUpload(file, password)}
        className="gap-2"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Subir certificado
      </Button>
    </div>
  );
}

function VerifactuStatusBadge({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Activo
      </span>
    );
  }
  return <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-600">Inactivo</span>;
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-brand-600" : "bg-neutral-300"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`}
      />
    </button>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
