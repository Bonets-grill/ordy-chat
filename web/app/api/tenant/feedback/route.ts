// web/app/api/tenant/feedback/route.ts
// El tenant puntúa 👍/👎 cada respuesta del playground. Si 👎:
//   1) INSERT en agent_feedback
//   2) email al SUPER_ADMIN_EMAIL para que Mario lo vea
// 👍 solo se registra en DB (métrica positiva).

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { sendBrandedEmail } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  user_message: z.string().min(1).max(4000),
  bot_response: z.string().min(1).max(8000),
  verdict: z.enum(["up", "down"]),
  reason: z.string().max(2000).optional(),
  source: z.string().max(60).default("free"),
});

export async function POST(req: Request) {
  const session = await auth();
  const bundle = await requireTenant();
  if (!session?.user?.id || !bundle) {
    return NextResponse.json({ error: "no_tenant" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { user_message, bot_response, verdict, reason, source } = parsed.data;

  // INSERT raw SQL (agentFeedback no está en schema.ts Drizzle — tabla
  // creada por migration 022).
  const row = await db.execute(
    sql`INSERT INTO agent_feedback
          (tenant_id, created_by_user_id, user_message, bot_response,
           verdict, reason, source, super_admin_notified)
        VALUES (${bundle.tenant.id}::uuid, ${session.user.id}::uuid,
                ${user_message}, ${bot_response},
                ${verdict}, ${reason ?? null}, ${source}, false)
        RETURNING id`,
  );
  const inserted = (Array.isArray(row) ? row[0] : (row as { rows?: unknown[] }).rows?.[0]) as
    | { id?: string }
    | undefined;
  const feedbackId = inserted?.id ?? null;

  // Si 👎 → email al super admin con el caso literal. Best-effort.
  if (verdict === "down") {
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim();
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com").replace(
      /\/$/,
      "",
    );
    if (superAdminEmail) {
      try {
        await sendBrandedEmail({
          to: superAdminEmail,
          subject: `[Ordy Chat] ${bundle.tenant.name} reporta respuesta mala del agente`,
          title: `${bundle.tenant.name} marcó 👎 una respuesta`,
          paragraphs: [
            `Operador: <strong>${session.user.email ?? "?"}</strong>`,
            `Pregunta del operador al bot:<br/><em>${escapeHtml(user_message)}</em>`,
            `Respuesta del bot:<br/><em>${escapeHtml(bot_response)}</em>`,
            reason
              ? `Qué debería haber dicho:<br/><em>${escapeHtml(reason)}</em>`
              : "<em>(sin comentario adicional)</em>",
          ],
          button: {
            label: "Abrir Ordy Chat admin",
            href: `${appUrl}/admin/tenants`,
          },
          footerNote: `Feedback id ${feedbackId ?? "n/a"} · tenant ${bundle.tenant.slug}`,
        });

        // Marcar como notificado.
        if (feedbackId) {
          await db.execute(
            sql`UPDATE agent_feedback SET super_admin_notified = true
                WHERE id = ${feedbackId}::uuid`,
          );
        }
      } catch (e) {
        console.error("[tenant/feedback] super admin email failed:", e);
      }
    }
  }

  return NextResponse.json({ ok: true, id: feedbackId });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
