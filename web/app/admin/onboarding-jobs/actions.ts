"use server";

// web/app/admin/onboarding-jobs/actions.ts — Server actions: reset + delete.
// Gate super_admin + Zod + audit_log + revalidatePath + fire-and-forget runtime.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { auditLog, onboardingJobs } from "@/lib/db/schema";

const uuidSchema = z.string().uuid();

export async function resetJobAction(jobId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = uuidSchema.safeParse(jobId);
    if (!parsed.success) throw new Error("VALIDATION: jobId no es UUID");

    const [job] = await db
      .select()
      .from(onboardingJobs)
      .where(eq(onboardingJobs.id, parsed.data))
      .limit(1);
    if (!job) throw new Error("VALIDATION: job no existe");
    if (!["failed", "pending"].includes(job.status) && job.status !== "error") {
      // Solo reset desde estados de fallo o pending.
      if (job.status !== "failed") {
        throw new Error(`VALIDATION: job no reseteable (status=${job.status})`);
      }
    }

    await db
      .update(onboardingJobs)
      .set({
        status: "pending",
        error: null,
        scrapeStartedAt: null,
        scrapeDeadlineAt: null,
        resultJson: null,
        updatedAt: new Date(),
      })
      .where(eq(onboardingJobs.id, parsed.data));

    await db.insert(auditLog).values({
      userId,
      action: "admin_reset_onboarding_job",
      entity: "onboarding_jobs",
      entityId: parsed.data,
      metadata: { previous_status: job.status, urls: job.urlsJson },
    });

    // Fire-and-forget: re-disparar runtime scrape.
    const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
    const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
    if (runtimeUrl && secret) {
      fetch(`${runtimeUrl}/onboarding/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": secret },
        body: JSON.stringify({ job_id: parsed.data, urls: job.urlsJson }),
        signal: AbortSignal.timeout(1500),
      }).catch((err) => {
        console.error("[admin-action] runtime scrape trigger failed:", err);
      });
    } else {
      console.warn("[admin-action] RUNTIME_URL/RUNTIME_INTERNAL_SECRET ausentes; watchdog lo manejará");
    }

    revalidatePath("/admin/onboarding-jobs");
    revalidatePath(`/admin/onboarding-jobs/${parsed.data}`);
    revalidatePath("/admin");
    return { jobId: parsed.data };
  });
}

export async function deleteJobAction(jobId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = uuidSchema.safeParse(jobId);
    if (!parsed.success) throw new Error("VALIDATION: jobId no es UUID");

    const [job] = await db
      .select()
      .from(onboardingJobs)
      .where(eq(onboardingJobs.id, parsed.data))
      .limit(1);
    if (!job) throw new Error("VALIDATION: job no existe");
    if (!["failed", "done"].includes(job.status)) {
      throw new Error(`VALIDATION: solo se puede borrar failed|done (status=${job.status})`);
    }

    await db.insert(auditLog).values({
      userId,
      action: "admin_delete_onboarding_job",
      entity: "onboarding_jobs",
      entityId: parsed.data,
      metadata: { status: job.status, urls: job.urlsJson },
    });

    await db.delete(onboardingJobs).where(eq(onboardingJobs.id, parsed.data));

    revalidatePath("/admin/onboarding-jobs");
    revalidatePath("/admin");
    return { jobId: parsed.data };
  });
}
