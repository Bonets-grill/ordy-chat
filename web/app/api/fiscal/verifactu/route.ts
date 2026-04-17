// web/app/api/fiscal/verifactu/route.ts — Toggle Verifactu + upload certificado.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { cifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { tenantFiscalConfig } from "@/lib/db/schema";
import { InvalidCertificateError, parsePkcs12 } from "@/lib/fiscal/certificate";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 30;

const toggleSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(["sandbox", "production"]).optional(),
});

// Toggle on/off + cambio de entorno (sin tocar certificado).
export async function PATCH(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = toggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const { enabled, environment } = parsed.data;

  const [existing] = await db
    .select()
    .from(tenantFiscalConfig)
    .where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id))
    .limit(1);

  if (enabled && !existing?.certificateEncrypted) {
    return NextResponse.json(
      { error: "missing_certificate", message: "Sube tu certificado digital antes de activar Verifactu." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = { verifactuEnabled: enabled, updatedAt: new Date() };
  if (environment) patch.verifactuEnvironment = environment;

  if (existing) {
    await db
      .update(tenantFiscalConfig)
      .set(patch)
      .where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id));
  } else {
    await db.insert(tenantFiscalConfig).values({
      tenantId: bundle.tenant.id,
      verifactuEnabled: enabled,
      verifactuEnvironment: environment ?? "sandbox",
    });
  }

  return NextResponse.json({ ok: true, verifactuEnabled: enabled });
}

// Upload del certificado .p12 — multipart/form-data con campo "file" + "password".
export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "expected_multipart" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const password = String(form.get("password") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  if (file.size > 512 * 1024) {
    return NextResponse.json({ error: "file_too_large", max: "512KB" }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let info;
  try {
    info = parsePkcs12(bytes, password);
  } catch (err) {
    if (err instanceof InvalidCertificateError) {
      return NextResponse.json({ error: "invalid_certificate", message: err.message }, { status: 400 });
    }
    throw err;
  }

  // Alerta si ya expiró.
  if (info.notAfter.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "certificate_expired", message: `El certificado expiró el ${info.notAfter.toISOString()}.` },
      { status: 400 },
    );
  }

  const certEncrypted = cifrar(bytes.toString("base64"));
  const passwordEncrypted = cifrar(password);

  const [existing] = await db
    .select()
    .from(tenantFiscalConfig)
    .where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id))
    .limit(1);

  const values = {
    certificateEncrypted: certEncrypted,
    certificatePasswordEncrypted: passwordEncrypted,
    certificateFilename: file.name,
    certificateUploadedAt: new Date(),
    certificateExpiresAt: info.notAfter,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(tenantFiscalConfig).set(values).where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id));
  } else {
    await db.insert(tenantFiscalConfig).values({
      tenantId: bundle.tenant.id,
      ...values,
    });
  }

  return NextResponse.json({
    ok: true,
    certificate: {
      subject: info.subjectCommonName,
      issuer: info.issuerCommonName,
      notBefore: info.notBefore,
      notAfter: info.notAfter,
      filename: file.name,
    },
  });
}

// Delete certificado (el tenant puede revocar su upload).
export async function DELETE() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  await db
    .update(tenantFiscalConfig)
    .set({
      verifactuEnabled: false,
      certificateEncrypted: null,
      certificatePasswordEncrypted: null,
      certificateFilename: null,
      certificateUploadedAt: null,
      certificateExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantFiscalConfig.tenantId, bundle.tenant.id));

  return NextResponse.json({ ok: true });
}
