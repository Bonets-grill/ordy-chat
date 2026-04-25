// web/lib/employees/scope.ts
//
// Resuelve quién está actuando en el comandero. Acepta dos perfiles:
//   1. Owner del tenant (sesión Auth.js de tenant_admin / super_admin) —
//      cuando el dueño abre /agent/comandero desde el dashboard sin pasar
//      por el keypad.
//   2. Empleado (cookie ordy_employee_session emitida por /api/comandero/login).
//
// Devuelve siempre tenantId del actor. Si ambos están presentes, prevalece
// el empleado (UX: el keypad es el flow principal).

import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { getCurrentEmployee } from "./auth";

export type ComanderoActor =
  | { kind: "employee"; tenantId: string; employeeId: string; name: string; role: "waiter" | "manager" }
  | { kind: "owner"; tenantId: string; userId: string };

export async function getComanderoActor(): Promise<ComanderoActor | null> {
  const employee = await getCurrentEmployee();
  if (employee) {
    return {
      kind: "employee",
      tenantId: employee.tenantId,
      employeeId: employee.id,
      name: employee.name,
      role: employee.role,
    };
  }
  const session = await auth();
  if (!session?.user?.id) return null;
  const bundle = await requireTenant();
  if (!bundle) return null;
  return { kind: "owner", tenantId: bundle.tenant.id, userId: session.user.id };
}
