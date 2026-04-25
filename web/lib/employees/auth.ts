// web/lib/employees/auth.ts
//
// Auth de empleados (meseros) por PIN. Independiente del Auth.js del owner:
// el comandero corre como app dedicada con cookie propia, sin email/password.
//
// Flujo:
//   1. Owner crea empleado en /agent/empleados con name + PIN (4-6 dígitos).
//      → argon2id hash → employees.pin_hash.
//   2. Empleado abre /agent/comandero, escribe PIN en keypad.
//      → POST /api/comandero/login intenta verificar contra TODOS los
//        empleados activos del tenant del owner que monta el comandero.
//      → Si match: emite JWT firmado con AUTH_SECRET, se guarda en cookie
//        httpOnly "ordy_employee_session" con maxAge 12h.
//   3. Endpoints del comandero (orders, close, …) leen la cookie via
//      getCurrentEmployee(); si no hay o JWT inválido → 401.

import { hash, verify } from "@node-rs/argon2";
import { encode, decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";

const COOKIE_NAME = "ordy_employee_session";
const SALT = "ordy.employee.session";
// 12 h — el comandero suele cubrir un turno largo. Mucho más alto y se
// vuelve un riesgo de sesión olvidada en una tablet compartida.
const MAX_AGE_S = 12 * 60 * 60;

export const COMANDERO_COOKIE_NAME = COOKIE_NAME;

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET no configurada");
  return s;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error("invalid_pin_format");
  return hash(pin, {
    // Defaults razonables — argon2id, ~50 ms en hardware moderno.
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  try {
    return await verify(stored, pin);
  } catch {
    return false;
  }
}

type EmployeeJwt = {
  sub: string; // employee.id
  tid: string; // tenant.id
  rol: "waiter" | "manager";
  name: string;
};

export async function issueEmployeeCookie(payload: EmployeeJwt) {
  const token = await encode({
    token: payload as unknown as Record<string, unknown>,
    secret: getSecret(),
    salt: SALT,
    maxAge: MAX_AGE_S,
  });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearEmployeeCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Devuelve el empleado activo desde la cookie. Re-valida contra DB que el
 * empleado siga existiendo y `active=true`. Si no hay cookie o falla, devuelve null.
 */
export async function getCurrentEmployee(): Promise<{
  id: string;
  tenantId: string;
  name: string;
  role: "waiter" | "manager";
} | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  let decoded: Record<string, unknown> | null;
  try {
    decoded = (await decode({
      token: raw,
      secret: getSecret(),
      salt: SALT,
    })) as Record<string, unknown> | null;
  } catch {
    return null;
  }
  if (!decoded) return null;
  const sub = typeof decoded.sub === "string" ? decoded.sub : null;
  const tid = typeof decoded.tid === "string" ? decoded.tid : null;
  if (!sub || !tid) return null;

  const [row] = await db
    .select({
      id: employees.id,
      tenantId: employees.tenantId,
      name: employees.name,
      role: employees.role,
      active: employees.active,
    })
    .from(employees)
    .where(and(eq(employees.id, sub), eq(employees.tenantId, tid)))
    .limit(1);
  if (!row || !row.active) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    role: row.role === "manager" ? "manager" : "waiter",
  };
}

/**
 * Lookup todos los empleados activos del tenant y verifica el PIN contra
 * cada hash. Devuelve el primero que matchea o null. Constant-time NO se
 * garantiza (argon2 verify no expone timing-leak relevante para PINs de
 * 4-6 dígitos en una lista corta de empleados por tenant).
 */
export async function findEmployeeByPin(
  tenantId: string,
  pin: string,
): Promise<{ id: string; name: string; role: "waiter" | "manager" } | null> {
  if (!isValidPin(pin)) return null;
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      pinHash: employees.pinHash,
    })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.active, true)));
  for (const r of rows) {
    if (await verifyPin(pin, r.pinHash)) {
      return {
        id: r.id,
        name: r.name,
        role: r.role === "manager" ? "manager" : "waiter",
      };
    }
  }
  return null;
}
