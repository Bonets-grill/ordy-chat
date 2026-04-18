// web/app/api/onboarding/route.ts — Wizard tradicional (legacy).
//
// Delega en lib/onboarding-fast/provision.ts para crear el tenant. El schema de
// entrada es el mismo que antes — NO rompe el wizard existente. El onboarding
// fast usa provision.ts directamente con un CanonicalBusiness más rico.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  createTenantFromCanonical,
  ProvisionError,
} from "@/lib/onboarding-fast/provision";

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

  try {
    const result = await createTenantFromCanonical({
      userId: session.user.id,
      canonical: {
        name: data.businessName,
        description: data.businessDescription,
      },
      tone: data.tone,
      useCases: data.useCases,
      provider: data.provider,
      providerCredentials: data.providerCredentials,
      knowledgeText: data.knowledgeText,
      agentName: data.agentName,
      schedule: data.schedule,
    });
    return NextResponse.json({ slug: result.slug, tenantId: result.tenantId });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[onboarding] unexpected error:", err);
    return NextResponse.json(
      { error: "Error inesperado al crear el tenant" },
      { status: 500 },
    );
  }
}
