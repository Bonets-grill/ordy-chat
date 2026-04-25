// web/app/api/account/totp/setup/route.ts
//
// Mig 047 — TOTP 2FA setup.
//
// GET   → Si no hay totp_secret: genera uno, lo persiste cifrado pero deja
//         totp_enabled_at = NULL (setup pendiente). Devuelve secret + URI
//         para que la UI pinte un QR.
//         Si ya hay enabled, devuelve { enabled: true, since }.
// POST  → body { token } → verifica el token contra el secret pendiente.
//         Si ok, setea totp_enabled_at = now(). Si ya estaba enabled, 409.
// DELETE→ body { token } → desactiva TOTP. Requiere token actual válido.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import {
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpToken,
} from "@/lib/totp";

export const dynamic = "force-dynamic";

const TOKEN_BODY = z.object({ token: z.string().regex(/^\d{6}$/) });

async function getMe(userId: string) {
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      totpSecretEncrypted: users.totpSecretEncrypted,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const me = await getMe(session.user.id);
  if (!me) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (me.totpEnabledAt) {
    return NextResponse.json({
      enabled: true,
      since: me.totpEnabledAt.toISOString(),
    });
  }

  // Si ya hay setup pendiente, NO regeneramos — devolvemos el actual descifrando
  // sería inseguro. Le damos al usuario una nueva URI con el secret existente
  // si decide rotar, pero eso implica regenerar. Para simplicidad: si ya hay
  // pending, le damos un nuevo secret (sustituye el anterior).
  const { secretBase32, otpauthUri } = generateTotpSecret(me.email);
  await db
    .update(users)
    .set({ totpSecretEncrypted: encryptTotpSecret(secretBase32) })
    .where(eq(users.id, me.id));

  return NextResponse.json({
    enabled: false,
    secret: secretBase32,
    otpauth_uri: otpauthUri,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = TOKEN_BODY.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_token_format" }, { status: 400 });
  }
  const me = await getMe(session.user.id);
  if (!me) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (me.totpEnabledAt) {
    return NextResponse.json({ error: "already_enabled" }, { status: 409 });
  }
  if (!me.totpSecretEncrypted) {
    return NextResponse.json({ error: "no_setup_pending" }, { status: 400 });
  }
  if (!verifyTotpToken(me.totpSecretEncrypted, body.data.token, me.email)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 422 });
  }
  await db
    .update(users)
    .set({ totpEnabledAt: new Date() })
    .where(eq(users.id, me.id));
  await db.insert(auditLog).values({
    action: "user.totp.enabled",
    entity: "user",
    entityId: me.id,
    userId: me.id,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = TOKEN_BODY.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_token_format" }, { status: 400 });
  }
  const me = await getMe(session.user.id);
  if (!me) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!me.totpEnabledAt || !me.totpSecretEncrypted) {
    return NextResponse.json({ error: "not_enabled" }, { status: 409 });
  }
  if (!verifyTotpToken(me.totpSecretEncrypted, body.data.token, me.email)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 422 });
  }
  await db
    .update(users)
    .set({ totpSecretEncrypted: null, totpEnabledAt: null })
    .where(eq(users.id, me.id));
  await db.insert(auditLog).values({
    action: "user.totp.disabled",
    entity: "user",
    entityId: me.id,
    userId: me.id,
  });
  return NextResponse.json({ ok: true });
}
