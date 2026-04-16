// scripts/create-super-admin.ts — Fuerza role='super_admin' sobre un usuario existente.
// Uso: pnpm tsx scripts/create-super-admin.ts email@ejemplo.com

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../web/lib/db";
import { users } from "../web/lib/db/schema";

const email = process.argv[2];
if (!email) {
  console.error("Uso: pnpm tsx scripts/create-super-admin.ts <email>");
  process.exit(1);
}

const [updated] = await db.update(users).set({ role: "super_admin" }).where(eq(users.email, email)).returning();
if (!updated) {
  console.error(`No existe user con email=${email}. El usuario debe registrarse primero (magic link).`);
  process.exit(1);
}
console.log(`✅ ${updated.email} ahora es super_admin.`);
