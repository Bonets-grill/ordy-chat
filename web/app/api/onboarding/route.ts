// web/app/api/onboarding/route.ts — Crea tenant + agent_config + provider_credentials.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { agentConfigs, providerCredentials, tenantMembers, tenants } from "@/lib/db/schema";
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
  anthropicKey: z.string().startsWith("sk-ant-"),
  provider: z.enum(["whapi", "meta", "twilio"]),
  providerCredentials: z.record(z.string(), z.string()),
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

  const credsPayload = { ...data.providerCredentials, anthropic_api_key: data.anthropicKey };

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

  await db.insert(providerCredentials).values({
    tenantId: tenant.id,
    provider: data.provider,
    credentialsEncrypted: cifrar(JSON.stringify(credsPayload)),
    phoneNumber: data.providerCredentials.phone_number ?? null,
  });

  return NextResponse.json({ slug, tenantId: tenant.id });
}
