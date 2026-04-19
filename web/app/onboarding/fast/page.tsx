// web/app/onboarding/fast/page.tsx — Server component del onboarding fast.
//
// Comportamiento:
//   - Requiere sesión; si no hay, redirect a /signin?next=/onboarding/fast.
//   - Busca el último onboarding_job del user en estado activo
//     (pending/scraping/sources_ready/ready/confirming) y lo pasa al wizard
//     como seed para reanudar.
//   - Si el user ya tiene tenant, redirige al dashboard.

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs, tenantMembers, tenants } from "@/lib/db/schema";
import { FastWizard } from "./fast-wizard";

// Solo reanudar jobs creados en los últimos 10 min. Más allá = stale (reap aún
// no los ha marcado failed). Sin este guard, el user entra a /onboarding/fast
// y ve "Leyendo tus URLs…" polleando un job viejo que nunca arrancó.
const RESUME_MAX_AGE = sql`interval '10 minutes'`;

export const dynamic = "force-dynamic";

export default async function OnboardingFastPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin?next=/onboarding/fast");
  }
  const userId = session.user.id;

  // Si el user YA tiene tenant como owner → no re-onboarding.
  const existing = await db
    .select({ id: tenants.id })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenants.ownerUserId, userId)))
    .limit(1);
  if (existing.length > 0) {
    redirect("/dashboard");
  }

  // Reanudación: último job activo del user creado en los últimos 10 min.
  const activeStatuses = ["pending", "scraping", "sources_ready", "ready", "confirming"] as const;
  const [activeJob] = await db
    .select({ id: onboardingJobs.id })
    .from(onboardingJobs)
    .where(
      and(
        eq(onboardingJobs.userId, userId),
        inArray(onboardingJobs.status, [...activeStatuses]),
        gt(onboardingJobs.createdAt, sql`now() - ${RESUME_MAX_AGE}`),
      ),
    )
    .orderBy(onboardingJobs.createdAt)
    .limit(1);

  return <FastWizard resumeJobId={activeJob?.id} />;
}
