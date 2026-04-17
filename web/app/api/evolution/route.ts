// web/app/api/evolution/route.ts — Proxy autenticado a Evolution API.
// El tenant actual (derivado del usuario) solo puede actuar sobre SU instancia.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { providerCredentials } from "@/lib/db/schema";
import {
  deleteInstance,
  evolutionConfigured,
  evolutionInstanceName,
  getPairingCode,
  getQR,
  getStatus,
  logoutInstance,
} from "@/lib/evolution";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

async function loadInstance(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, tenantId))
    .limit(1);
  if (!row || row.provider !== "evolution") return null;
  try {
    const creds = JSON.parse(descifrar(row.credentialsEncrypted)) as { instance_name?: string };
    return creds.instance_name ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!evolutionConfigured()) return NextResponse.json({ error: "evolution_not_configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const instance = (await loadInstance(bundle.tenant.id)) ?? evolutionInstanceName(bundle.tenant.slug);

  try {
    switch (action) {
      case "qr": {
        const data = await getQR(instance);
        return NextResponse.json(data);
      }
      case "pair": {
        const phone = String(body?.phoneNumber || "");
        const data = await getPairingCode(instance, phone);
        return NextResponse.json(data);
      }
      case "status": {
        const data = await getStatus(instance);
        return NextResponse.json(data);
      }
      case "logout": {
        const data = await logoutInstance(instance);
        return NextResponse.json(data);
      }
      case "delete": {
        const data = await deleteInstance(instance);
        return NextResponse.json(data);
      }
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
