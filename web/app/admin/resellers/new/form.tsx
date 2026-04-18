"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createResellerAction } from "./actions";
import { SUPPORTED_COUNTRIES } from "@/lib/reseller/countries";

const AGREEMENT_VERSION = "2026-04-18";

export function NewResellerForm({ actorUserId }: { actorUserId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [slug, setSlug] = useState("");
  const [brandName, setBrandName] = useState("");
  const [commissionRate, setCommissionRate] = useState(0.25);
  const [countryCode, setCountryCode] = useState("ES");
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [fiscalSubProfile, setFiscalSubProfile] = useState<string>("autonomo_es");
  const [iaeRegistered, setIaeRegistered] = useState(false);
  const [consent, setConsent] = useState(false);

  const isES = countryCode === "ES";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createResellerAction({
        email,
        slug,
        brandName,
        commissionRate,
        countryCode,
        legalName: legalName || undefined,
        taxId: taxId || undefined,
        fiscalSubProfile: isES ? (fiscalSubProfile as "autonomo_es" | "sl_es" | "autonomo_new_es") : undefined,
        iaeRegistered: isES ? iaeRegistered : true,
        selfBillingConsent: consent,
        agreementVersion: AGREEMENT_VERSION,
        actorUserId,
      });
      if (result.ok) {
        router.push(`/admin/resellers/${result.resellerId}`);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-800">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>1. País y fiscal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="country">País</Label>
            <select
              id="country"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
            >
              {SUPPORTED_COUNTRIES.map((cc) => (
                <option key={cc} value={cc}>{cc}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Fuera de los 46 países soportados por Stripe Connect: no se puede crear reseller.
            </p>
          </div>

          {isES && (
            <>
              <div>
                <Label htmlFor="fiscal">Perfil fiscal (España)</Label>
                <select
                  id="fiscal"
                  value={fiscalSubProfile}
                  onChange={(e) => setFiscalSubProfile(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="autonomo_es">Autónomo (IRPF 15%)</option>
                  <option value="autonomo_new_es">Autónomo nuevo (&lt;2y, IRPF 7%)</option>
                  <option value="sl_es">SL (IRPF 0% — confirmar con asesor)</option>
                </select>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={iaeRegistered}
                  onChange={(e) => setIaeRegistered(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Confirmo que el reseller tiene alta en IAE (modelo 036/037).
                  <br />
                  <span className="text-xs text-neutral-500">
                    Sin alta IAE no se puede pagar comisión legalmente en España.
                  </span>
                </span>
              </label>
            </>
          )}

          <div>
            <Label htmlFor="legalName">Razón social / Nombre legal</Label>
            <Input
              id="legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Juan Pérez · Acme SL"
            />
          </div>
          <div>
            <Label htmlFor="taxId">NIF / VAT-ID / Tax ID</Label>
            <Input
              id="taxId"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="12345678A"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Identidad del reseller</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="partner@agencia.com"
            />
            <p className="mt-1 text-xs text-neutral-500">
              Se enviará magic link al primer login.
            </p>
          </div>
          <div>
            <Label htmlFor="slug">Slug (URL de referido)</Label>
            <Input
              id="slug"
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="agencia-pro"
              pattern="[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?"
            />
            <p className="mt-1 text-xs text-neutral-500 font-mono">
              ordychat.ordysuite.com/?ref={slug || "…"}
            </p>
          </div>
          <div>
            <Label htmlFor="brandName">Nombre comercial (para su dashboard)</Label>
            <Input
              id="brandName"
              required
              minLength={2}
              maxLength={60}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="Agencia Pro Marketing"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Comisión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="rate">Comisión (% del neto pre-IVA)</Label>
            <div className="flex items-center gap-3">
              <input
                id="rate"
                type="range"
                min="0.05"
                max="0.50"
                step="0.01"
                value={commissionRate}
                onChange={(e) => setCommissionRate(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-16 tabular-nums text-sm font-medium">
                {(commissionRate * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Default 25%. Rango permitido: 5-50%.
            </p>
          </div>
          <p className="text-xs text-neutral-500">
            Mode de payout: <strong>Stripe Connect</strong> (único rail v1).
            El reseller lo completará desde su panel cuando tenga primer cliente.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Acuerdo de self-billing</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
              className="mt-0.5"
            />
            <span>
              Confirmo que el reseller ha firmado el acuerdo de self-billing
              (factura emitida por el destinatario, RD 1619/2012 art. 5.2).
              <br />
              <span className="text-xs text-neutral-500">
                Versión del acuerdo: {AGREEMENT_VERSION}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creando…" : "Crear reseller"}
        </Button>
      </div>
    </form>
  );
}
