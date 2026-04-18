"use server";

import { auth } from "@/lib/auth";
import {
  createReseller,
  CreateResellerError,
  type CreateResellerInput,
} from "@/lib/reseller/create";

type ActionResult = { ok: true; resellerId: string } | { ok: false; error: string };

export async function createResellerAction(
  input: CreateResellerInput,
): Promise<ActionResult> {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    return { ok: false, error: "No autorizado" };
  }
  // Actor siempre de la sesión, ignora lo que pase el cliente.
  const sanitized: CreateResellerInput = { ...input, actorUserId: session.user.id };

  try {
    const { reseller } = await createReseller(sanitized);
    return { ok: true, resellerId: reseller.id };
  } catch (err) {
    if (err instanceof CreateResellerError) {
      return { ok: false, error: err.message };
    }
    console.error("[createResellerAction] unexpected:", err);
    return { ok: false, error: "Error inesperado creando reseller" };
  }
}
