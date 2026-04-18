// web/app/api/knowledge/faqs/route.ts — CRUD de FAQs del tenant.

import { and, eq, max } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { faqs } from "@/lib/db/schema";
import { regenerateTenantPrompt } from "@/lib/prompt-regen";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const createSchema = z.object({
  question: z.string().min(2).max(300),
  answer: z.string().min(2).max(2000),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(2).max(300).optional(),
  answer: z.string().min(2).max(2000).optional(),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const rows = await db
    .select()
    .from(faqs)
    .where(eq(faqs.tenantId, bundle.tenant.id))
    .orderBy(faqs.orderIndex);
  return NextResponse.json({ faqs: rows });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [last] = await db
    .select({ m: max(faqs.orderIndex) })
    .from(faqs)
    .where(eq(faqs.tenantId, bundle.tenant.id));
  const nextIndex = (last?.m ?? 0) + 1;

  const [row] = await db
    .insert(faqs)
    .values({
      tenantId: bundle.tenant.id,
      question: parsed.data.question.trim(),
      answer: parsed.data.answer.trim(),
      orderIndex: nextIndex,
    })
    .returning();

  await regenerateTenantPrompt(bundle.tenant.id);
  return NextResponse.json({ faq: row });
}

export async function PATCH(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }
  const { id, question, answer } = parsed.data;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (question !== undefined) set.question = question.trim();
  if (answer !== undefined) set.answer = answer.trim();

  await db
    .update(faqs)
    .set(set)
    .where(and(eq(faqs.id, id), eq(faqs.tenantId, bundle.tenant.id)));
  await regenerateTenantPrompt(bundle.tenant.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  await db.delete(faqs).where(and(eq(faqs.id, id), eq(faqs.tenantId, bundle.tenant.id)));
  await regenerateTenantPrompt(bundle.tenant.id);
  return NextResponse.json({ ok: true });
}
