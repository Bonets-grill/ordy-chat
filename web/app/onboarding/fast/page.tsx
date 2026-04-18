// web/app/onboarding/fast/page.tsx — Server component del onboarding fast.
//
// Comportamiento:
//   - Requiere sesión; si no hay, redirect a /signin?next=/onboarding/fast.
//   - Busca el último onboarding_job del user en estado activo
//     (pending/scraping/sources_ready/ready/confirming) y lo pasa al wizard
//     como seed para reanudar.
//   - Si el user ya tiene tenant, redirige al dashboard.

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs, tenantMembers, tenants } from "@/lib/db/schema";
import { FastWizard } from "./fast-wizard";

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

  // Reanudación: buscar último job activo del user.
  const activeStatuses = ["pending", "scraping", "sources_ready", "ready", "confirming"] as const;
  const [activeJob] = await db
    .select({ id: onboardingJobs.id })
    .from(onboardingJobs)
    .where(
      and(
        eq(onboardingJobs.userId, userId),
        inArray(onboardingJobs.status, [...activeStatuses]),
      ),
    )
    .orderBy(onboardingJobs.createdAt)
    .limit(1);

  return <FastWizard resumeJobId={activeJob?.id} />;
}
