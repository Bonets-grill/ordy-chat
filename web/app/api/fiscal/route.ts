// web/app/api/fiscal/route.ts — GET/PATCH datos fiscales + branding del tenant.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { tenantFiscalConfig, tenants } from "@/lib/db/schema";
import { regenerateTenantPrompt } from "@/lib/prompt-regen";
import { TAX_PRESETS, VALID_REGIONS, VALID_SYSTEMS, type TaxRegion } from "@/lib/tax/presets";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const patchSchema = z.object({
  legalName: z.string().max(200).optional(),
  taxId: z.string().max(40).optional(),
  billingAddress: z.string().max(300).optional(),
  billingPostalCode: z.string().max(20).optional(),
  billingCity: z.string().max(120).optional(),
  billingCountry: z.string().length(2).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brandLogoUrl: z.string().url().max(500).nullable().optional(),
  defaultVatRate: z.number().min(0).max(100).optional(),
  invoiceSeries: z.string().max(10).optional(),
  // Régimen fiscal (migración 008)
  taxRegion: z.enum(VALID_REGIONS as [TaxRegion, ...TaxRegion[]]).optional(),
  taxSystem: z.enum(VALID_SYSTEMS as [string, ...string[]]).optional(),
  pricesIncludeTax: z.boolean().optional(),
  taxRateStandard: z.number().min(0).max(30).optional(),
  taxRateAlcohol: z.number().min(0).max(30).optional(),
  taxLabel: z.string().max(20).optional(),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const [config] = await db
    .select()
    .from(tenantFiscalConfig)
    .where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id))
    .limit(1);

  return NextResponse.json({
    tenant: {
      legalName: bundle.tenant.legalName,
      taxId: bundle.tenant.taxId,
      billingAddress: bundle.tenant.billingAddress,
      billingPostalCode: bundle.tenant.billingPostalCode,
      billingCity: bundle.tenant.billingCity,
      billingCountry: bundle.tenant.billingCountry,
      brandColor: bundle.tenant.brandColor,
      brandLogoUrl: bundle.tenant.brandLogoUrl,
      defaultVatRate: bundle.tenant.defaultVatRate,
      // Régimen fiscal
      taxRegion: bundle.tenant.taxRegion,
      taxSystem: bundle.tenant.taxSystem,
      pricesIncludeTax: bundle.tenant.pricesIncludeTax,
      taxRateStandard: bundle.tenant.taxRateStandard,
      taxRateAlcohol: bundle.tenant.taxRateAlcohol,
      taxLabel: bundle.tenant.taxLabel,
    },
    fiscalConfig: config
      ? {
          verifactuEnabled: config.verifactuEnabled,
          verifactuEnvironment: config.verifactuEnvironment,
          invoiceSeries: config.invoiceSeries,
          invoiceCounter: config.invoiceCounter,
          certificateFilename: config.certificateFilename,
          certificateUploadedAt: config.certificateUploadedAt,
          certificateExpiresAt: config.certificateExpiresAt,
          hasCertificate: Boolean(config.certificateEncrypted),
        }
      : null,
  });
}

export async function PATCH(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Datos del tenant (branding + dirección).
  const tenantUpdate: Record<string, unknown> = {};
  if (data.legalName !== undefined) tenantUpdate.legalName = data.legalName;
  if (data.taxId !== undefined) tenantUpdate.taxId = data.taxId;
  if (data.billingAddress !== undefined) tenantUpdate.billingAddress = data.billingAddress;
  if (data.billingPostalCode !== undefined) tenantUpdate.billingPostalCode = data.billingPostalCode;
  if (data.billingCity !== undefined) tenantUpdate.billingCity = data.billingCity;
  if (data.billingCountry !== undefined) tenantUpdate.billingCountry = data.billingCountry;
  if (data.brandColor !== undefined) tenantUpdate.brandColor = data.brandColor;
  if (data.brandLogoUrl !== undefined) tenantUpdate.brandLogoUrl = data.brandLogoUrl;
  if (data.defaultVatRate !== undefined) {
    tenantUpdate.defaultVatRate = String(data.defaultVatRate.toFixed(2));
  }

  // Régimen fiscal: si viene taxRegion, aplicamos el preset pero permitimos que
  // los otros campos la sobrescriban (override manual).
  if (data.taxRegion !== undefined) {
    const preset = TAX_PRESETS[data.taxRegion];
    tenantUpdate.taxRegion = data.taxRegion;
    tenantUpdate.taxSystem = data.taxSystem ?? preset.system;
    tenantUpdate.taxLabel = data.taxLabel ?? preset.label;
    tenantUpdate.taxRateStandard = String((data.taxRateStandard ?? preset.standard).toFixed(2));
    tenantUpdate.taxRateAlcohol = String((data.taxRateAlcohol ?? preset.alcohol).toFixed(2));
    tenantUpdate.pricesIncludeTax = data.pricesIncludeTax ?? preset.pricesIncludeTax;
  } else {
    if (data.taxSystem !== undefined) tenantUpdate.taxSystem = data.taxSystem;
    if (data.taxLabel !== undefined) tenantUpdate.taxLabel = data.taxLabel;
    if (data.taxRateStandard !== undefined) tenantUpdate.taxRateStandard = String(data.taxRateStandard.toFixed(2));
    if (data.taxRateAlcohol !== undefined) tenantUpdate.taxRateAlcohol = String(data.taxRateAlcohol.toFixed(2));
    if (data.pricesIncludeTax !== undefined) tenantUpdate.pricesIncludeTax = data.pricesIncludeTax;
  }

  const touchesAgentBehavior =
    data.taxRegion !== undefined || data.taxSystem !== undefined || data.taxLabel !== undefined ||
    data.taxRateStandard !== undefined || data.pricesIncludeTax !== undefined;

  if (Object.keys(tenantUpdate).length > 0) {
    tenantUpdate.updatedAt = new Date();
    await db.update(tenants).set(tenantUpdate).where(eq(tenants.id, bundle.tenant.id));
  }

  // Serie de facturación vive en fiscal_config.
  if (data.invoiceSeries !== undefined) {
    await upsertFiscalConfig(bundle.tenant.id, { invoiceSeries: data.invoiceSeries });
  }

  // Si cambió algo que afecta el comportamiento del agente (impuestos), regeneramos prompt.
  if (touchesAgentBehavior) {
    await regenerateTenantPrompt(bundle.tenant.id);
  }

  return NextResponse.json({ ok: true });
}

async function upsertFiscalConfig(tenantId: string, patch: Record<string, unknown>) {
  const [existing] = await db
    .select()
    .from(tenantFiscalConfig)
    .where(eq(tenantFiscalConfig.tenantId, tenantId))
    .limit(1);
  if (existing) {
    await db
      .update(tenantFiscalConfig)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tenantFiscalConfig.tenantId, tenantId));
  } else {
    await db.insert(tenantFiscalConfig).values({
      tenantId,
      ...patch,
    });
  }
}
