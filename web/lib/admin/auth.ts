// web/lib/admin/auth.ts — Gate super admin centralizado.
//
// Usar en PRIMERA LÍNEA de cada server component, server action y API route
// bajo /admin. La session de Auth.js v5 ya inyecta session.user.role via el
// callback (lib/auth.ts), así que NO hacemos query extra a users.

import { auth } from "@/lib/auth";

export class AdminAuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
    this.name = "AdminAuthError";
  }
}

export async function requireSuperAdmin(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AdminAuthError("UNAUTHENTICATED");
  }
  if (session.user.role !== "super_admin") {
    throw new AdminAuthError("FORBIDDEN");
  }
  return {
    userId: session.user.id,
    email: session.user.email ?? "",
  };
}

/**
 * Wrapper para server actions: captura AdminAuthError y errores internos,
 * devuelve shape consistente sin lanzar al client. Uso:
 *
 *   export async function miAction(input: unknown) {
 *     return adminAction(async () => {
 *       const { userId } = await requireSuperAdmin();
 *       // ... lógica ...
 *       return { slug: "..." };
 *     });
 *   }
 */
export async function adminAction<T>(
  fn: () => Promise<T>,
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: string; code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "INTERNAL" }
> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return {
        ok: false,
        error: err.code === "UNAUTHENTICATED" ? "No autenticado" : "Solo super admin",
        code: err.code,
      };
    }
    // Zod-like errors por convención: si el mensaje empieza con "VALIDATION:".
    if (err instanceof Error && err.message.startsWith("VALIDATION:")) {
      return { ok: false, error: err.message.slice("VALIDATION:".length).trim(), code: "VALIDATION" };
    }
    console.error("[admin-action] internal error:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "INTERNAL",
    };
  }
}
