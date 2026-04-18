// web/app/api/internal/validator/notify-fail/route.ts
// POST: el runtime llama aquí tras un run FAIL post-autopatch.
// Auth: x-internal-secret (hmac timing-safe). Envía email al owner del tenant.

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, tenants, users } from "@/lib/db/schema";
import { sendValidatorFailureEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  reasons: z.array(z.string().max(200)).min(1).max(20),
});

function timingSafeCheck(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(req: Request) {
  const expected = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  const provided = req.headers.get("x-internal-secret") ?? "";
  if (!expected || !timingSafeCheck(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { run_id, tenant_id, reasons } = parsed.data;

  // Resolver owner email
  const [row] = await db
    .select({
      tenantName: tenants.name,
      ownerEmail: users.email,
    })
    .from(tenants)
    .innerJoin(users, eq(users.id, tenants.ownerUserId))
    .where(eq(tenants.id, tenant_id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com").replace(/\/$/, "");
  const reviewUrl = `${appUrl}/admin/validator/${run_id}`;

  const result = await sendValidatorFailureEmail({
    tenantEmail: row.ownerEmail,
    tenantName: row.tenantName,
    runId: run_id,
    reasons,
    reviewUrl,
  });

  // Audit log — cualquier mutación admin queda trazada.
  try {
    await db.insert(auditLog).values({
      tenantId: tenant_id,
      action: "validator_notify_fail_sent",
      entity: "validator_runs",
      entityId: run_id,
      metadata: {
        email: row.ownerEmail,
        reasons_count: reasons.length,
        ok: result.ok,
        ...(result.ok ? {} : { error: result.error }),
      },
    });
  } catch (e) {
    console.error("[notify-fail] audit_log insert failed:", e);
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: "email_send_failed", detail: result.error },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, email: row.ownerEmail });
}
