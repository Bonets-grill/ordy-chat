// web/app/api/onboarding/route.ts — Crea tenant + agent_config + provider_credentials.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { agentConfigs, providerCredentials, tenantMembers, tenants } from "@/lib/db/schema";
import { createInstance, evolutionConfigured, evolutionInstanceName } from "@/lib/evolution";
import { buildSystemPrompt } from "@/lib/prompt-builder";
import { slugify } from "@/lib/utils";

const schema = z.object({
  businessName: z.string().min(2),
  businessDescription: z.string().min(10),
  useCases: z.array(z.string()).min(1),
  agentName: z.string().min(2),
  tone: z.enum(["professional", "friendly", "sales", "empathetic"]),
  schedule: z.string().min(3),
  knowledgeText: z.string().optional(),
  provider: z.enum(["whapi", "meta", "twilio", "evolution"]),
  providerCredentials: z.record(z.string(), z.string()).optional().default({}),
});

async function uniqueSlug(base: string): Promise<string> {
  const cleaned = slugify(base) || "negocio";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? cleaned : `${cleaned}-${i + 1}`;
    const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, candidate)).limit(1);
    if (!existing) return candidate;
  }
  return `${cleaned}-${Date.now()}`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const existing = await db
    .select({ id: tenants.id })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, session.user.id), eq(tenants.ownerUserId, session.user.id)))
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "Ya tienes un tenant. Edita desde el dashboard." }, { status: 409 });
  }

  const slug = await uniqueSlug(data.businessName);
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const systemPrompt = buildSystemPrompt({
    businessName: data.businessName,
    businessDescription: data.businessDescription,
    agentName: data.agentName,
    tone: data.tone,
    schedule: data.schedule,
    useCases: data.useCases,
    knowledgeText: data.knowledgeText,
  });

  // Validación de credenciales por proveedor.
  // Evolution no pide nada al usuario: la plataforma crea la instancia.
  if (data.provider === "evolution" && !evolutionConfigured()) {
    return NextResponse.json(
      { error: "Evolution no está configurado en la plataforma. Contacta al administrador." },
      { status: 503 },
    );
  }
  const credsPayload: Record<string, string> = { ...data.providerCredentials };

  const [tenant] = await db
    .insert(tenants)
    .values({
      slug,
      name: data.businessName,
      ownerUserId: session.user.id,
      trialEndsAt,
    })
    .returning();

  await db.insert(tenantMembers).values({ tenantId: tenant.id, userId: session.user.id, role: "owner" });

  await db.insert(agentConfigs).values({
    tenantId: tenant.id,
    businessName: data.businessName,
    businessDescription: data.businessDescription,
    agentName: data.agentName,
    tone: data.tone,
    schedule: data.schedule,
    useCases: data.useCases,
    systemPrompt,
    fallbackMessage: "Disculpa, no entendí tu mensaje. ¿Podrías reformularlo?",
    errorMessage: "Lo siento, estoy teniendo problemas técnicos. Intenta de nuevo en unos minutos.",
    knowledge: data.knowledgeText ? [{ type: "text", content: data.knowledgeText }] : [],
    onboardingCompleted: true,
  });

  // Shared secret para validar origen del webhook (query param ?s=...).
  // Lo usamos sobre todo con Whapi/Evolution (no firman). Meta/Twilio firman.
  const webhookSecret = crypto.randomBytes(24).toString("base64url");

  // Auto-provisioning para Evolution: crear instancia + setear webhook apuntando al runtime.
  if (data.provider === "evolution") {
    const instanceName = evolutionInstanceName(slug);
    const runtimeUrl = (process.env.RUNTIME_URL || "").replace(/\/$/, "");
    if (!runtimeUrl) {
      return NextResponse.json({ error: "RUNTIME_URL no configurada" }, { status: 503 });
    }
    // Secret va en header X-Ordy-Signature (evita filtrar en access logs).
    // El runtime también acepta ?s= como fallback legacy.
    const webhookUrl = `${runtimeUrl}/webhook/evolution/${slug}`;
    try {
      await createInstance(instanceName, webhookUrl, { webhookSecret });
    } catch (err) {
      console.error("[onboarding] evolution createInstance fail:", err);
      return NextResponse.json(
        { error: `No se pudo crear la instancia de WhatsApp: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }
    credsPayload.instance_name = instanceName;
  }

  await db.insert(providerCredentials).values({
    tenantId: tenant.id,
    provider: data.provider,
    credentialsEncrypted: cifrar(JSON.stringify(credsPayload)),
    phoneNumber: data.providerCredentials.phone_number ?? null,
    webhookSecret,
  });

  return NextResponse.json({ slug, tenantId: tenant.id });
}
