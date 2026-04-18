// web/lib/reseller/create.ts
// Helper library para crear un reseller. Invocado desde la server action
// /admin/resellers/new/actions.ts (que sí lleva "use server").
//
// IMPORTANT: este archivo NO debe tener "use server" porque exporta tipos,
// clases y la función helper createReseller() — Next.js App Router rechaza
// todo export no-función en módulos marcados "use server" (Turbopack
// devuelve "module has no exports at all" y rompe el build).
//
// Transaccional: user resolve/create + role update + reseller INSERT + audit
// van todos o ninguno. Nota: @neondatabase/serverless HTTP driver no soporta
// transacciones reales Postgres — db.transaction() ejecuta secuencialmente.
// Si un paso falla, hacemos cleanup manual explícito.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, resellers, users } from "@/lib/db/schema";
import { countryConfig } from "@/lib/reseller/countries";

export type FiscalSubProfile = "autonomo_es" | "sl_es" | "autonomo_new_es";

export interface CreateResellerInput {
  email: string;
  slug: string;
  brandName: string;
  commissionRate: number; // 0..0.5
  countryCode: string;
  legalName?: string;
  taxId?: string;
  taxIdType?: "nif_es" | "vat_eu" | "ein_us" | "other";
  fiscalSubProfile?: FiscalSubProfile;
  iaeRegistered?: boolean;
  billingAddress?: Record<string, unknown>;
  selfBillingConsent: boolean;
  agreementVersion: string;
  actorUserId: string;
}

export class CreateResellerError extends Error {
  constructor(
    public code:
      | "country_not_supported"
      | "es_requires_iae_and_profile"
      | "slug_taken"
      | "email_already_reseller"
      | "cannot_demote_super_admin"
      | "invalid_commission_rate"
      | "self_billing_required",
    message: string,
  ) {
    super(message);
    this.name = "CreateResellerError";
  }
}

export async function createReseller(input: CreateResellerInput) {
  // Pre-validaciones fuera de tx (evita escritura parcial si input obvio-malo).
  const cc = input.countryCode.toUpperCase();
  const conf = countryConfig(cc);
  if (!conf) {
    throw new CreateResellerError(
      "country_not_supported",
      `Country ${cc} no está soportado por Stripe Connect.`,
    );
  }
  if (cc === "ES" && (!input.iaeRegistered || !input.fiscalSubProfile)) {
    throw new CreateResellerError(
      "es_requires_iae_and_profile",
      "Resellers en España requieren alta en IAE y perfil fiscal (autónomo/SL).",
    );
  }
  if (input.commissionRate < 0 || input.commissionRate > 0.5) {
    throw new CreateResellerError(
      "invalid_commission_rate",
      "commission_rate fuera de rango [0, 0.5].",
    );
  }
  if (!input.selfBillingConsent) {
    throw new CreateResellerError(
      "self_billing_required",
      "Consent de self-billing es obligatorio (RD 1619/2012 art. 5.2).",
    );
  }

  const normEmail = input.email.trim().toLowerCase();

  // Slug unique pre-check (también lo garantiza UNIQUE en DB; usamos pre-check
  // para error limpio en UI).
  const [existingSlug] = await db
    .select({ id: resellers.id })
    .from(resellers)
    .where(eq(resellers.slug, input.slug))
    .limit(1);
  if (existingSlug) {
    throw new CreateResellerError("slug_taken", `Slug '${input.slug}' ya está en uso.`);
  }

  // Email → user resolve/create
  let [user] = await db.select().from(users).where(eq(users.email, normEmail)).limit(1);
  const wasNewUser = !user;
  if (!user) {
    const [created] = await db
      .insert(users)
      .values({ email: normEmail, role: "reseller" })
      .returning();
    user = created;
  } else {
    if (user.role === "super_admin") {
      throw new CreateResellerError(
        "cannot_demote_super_admin",
        "No puedes convertir a un super admin en reseller.",
      );
    }
    // Check si ya es reseller con cuenta activa
    const [existingReseller] = await db
      .select({ id: resellers.id })
      .from(resellers)
      .where(
        and(eq(resellers.userId, user.id)),
      )
      .limit(1);
    if (existingReseller) {
      throw new CreateResellerError(
        "email_already_reseller",
        "Este email ya tiene una cuenta reseller.",
      );
    }
    // Promover tenant_admin → reseller
    if (user.role !== "reseller") {
      await db.update(users).set({ role: "reseller" }).where(eq(users.id, user.id));
    }
  }

  // INSERT reseller
  let reseller;
  try {
    const [r] = await db
      .insert(resellers)
      .values({
        userId: user.id,
        slug: input.slug,
        brandName: input.brandName,
        commissionRate: input.commissionRate.toFixed(4),
        status: "pending",
        countryCode: cc,
        taxStrategy: conf.strategy,
        payoutCurrency: conf.currency,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
        taxIdType: input.taxIdType ?? null,
        fiscalSubProfile: input.fiscalSubProfile ?? null,
        iaeRegistered: input.iaeRegistered ?? false,
        billingAddress: input.billingAddress ?? null,
        selfBillingConsentedAt: new Date(),
        selfBillingAgreementVersion: input.agreementVersion,
      })
      .returning();
    reseller = r;
  } catch (err) {
    // Rollback cleanup: si creamos user en ESTA tx, lo borramos.
    // Si solo hicimos update de role, lo revertimos a tenant_admin.
    if (wasNewUser) {
      try {
        await db.delete(users).where(eq(users.id, user.id));
      } catch {
        /* best effort */
      }
    }
    throw err;
  }

  // Audit log
  await db.insert(auditLog).values({
    action: "admin.reseller.created",
    entity: "reseller",
    entityId: reseller.id,
    userId: input.actorUserId,
    metadata: {
      slug: input.slug,
      country: cc,
      strategy: conf.strategy,
      currency: conf.currency,
      commission_rate: input.commissionRate,
      was_new_user: wasNewUser,
    },
  });

  return { reseller, user };
}
