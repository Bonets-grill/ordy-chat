// web/app/api/auth/register/route.ts
// POST /api/auth/register — alta con email + password (013_password_login).
//
// Defensas (en orden):
// 1. Zod body validation (email válido, password 8-256, name 1-120)
// 2. Rate-limit por IP (5/h) — anti-spam cuenta nueva
// 3. Email único (409 si ya existe) — no enumeración porque el signin falla
//    igual con credenciales inválidas; aquí el usuario legítimo necesita el 409
//    para saber "ya estoy registrado, prueba login"
// 4. Hash argon2id (web/lib/auth/password.ts)
// 5. Insert user con emailVerified=now (el usuario eligió password, equivale
//    a demostrar intención; la verificación de identidad la da el login posterior)
//
// El tenant se crea DESPUÉS en /onboarding/fast — mantenemos la separación
// user↔tenant que ya existe, sin duplicar lógica de creación.

import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { limitByIpRegister } from "@/lib/rate-limit";

const BODY_SCHEMA = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(8).max(256),
  name: z.string().min(1).max(120).transform((s) => s.trim()),
});

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { email, password, name } = parsed.data;

  const ip = getClientIp(req);
  const rl = await limitByIpRegister(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", resetAt: rl.reset },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    email,
    name,
    emailVerified: new Date(),
    passwordHash,
    // role se queda con default "tenant_admin"; la promoción a super_admin
    // sigue ocurriendo en el callback signIn si SUPER_ADMIN_EMAIL coincide.
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
