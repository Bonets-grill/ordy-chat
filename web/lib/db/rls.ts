// web/lib/db/rls.ts — Helper para activar RLS multi-tenant.
//
// Las policies de RLS (migración 005) filtran por `current_tenant_id()` que
// lee el GUC `app.current_tenant_id`. Mientras la app se conecte como
// superuser `neondb_owner`, RLS NO aplica (Postgres lo bypassea por defecto).
//
// Cuando quieras activar defense-in-depth real:
//   1. Crear role non-superuser en Neon: `CREATE ROLE ordy_app LOGIN PASSWORD '...'`
//      con los GRANT necesarios sobre schema public.
//   2. Cambiar DATABASE_URL en Vercel + Railway a la connection string de ordy_app.
//   3. Envolver CADA request server-side que lea/escriba en tablas multi-tenant
//      con `withTenant(tenantId, fn)` — setea el GUC antes de la query y lo
//      resetea después.
//
// El helper ya está listo. Solo falta (1)+(2) cuando quieras endurecer.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Ejecuta `fn` con `app.current_tenant_id` seteado a `tenantId`. Usa
 * `set_config(..., is_local=true)` de forma que el valor solo vive en la
 * transacción actual (no contamina conexiones del pool).
 *
 * Mientras la app use `neondb_owner` superuser, esto es un no-op efectivo
 * (RLS no aplica). Cuando migres a un role non-superuser, esta función pasa
 * a ser el único punto de acceso seguro a tablas multi-tenant.
 */
export async function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return fn();
  });
}

/**
 * Setea el GUC sin transacción (para uso en API routes sin mutaciones).
 * Solo recomendado cuando estés seguro de usar la misma connection para
 * toda la request (Drizzle con pg-pool NO garantiza eso).
 */
export async function setCurrentTenant(tenantId: string): Promise<void> {
  await db.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`);
}
