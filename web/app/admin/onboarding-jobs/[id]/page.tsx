// web/app/admin/onboarding-jobs/[id]/page.tsx — Detalle de un onboarding job.

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs, users } from "@/lib/db/schema";
import { ActionsPanel } from "./actions-panel";

export const dynamic = "force-dynamic";

export default async function OnboardingJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin" : "/dashboard");
    }
    throw err;
  }
  const session = await auth();
  if (!session) redirect("/signin");

  const { id } = await params;

  const [job] = await db
    .select({
      id: onboardingJobs.id,
      userEmail: users.email,
      urlsJson: onboardingJobs.urlsJson,
      status: onboardingJobs.status,
      resultJson: onboardingJobs.resultJson,
      error: onboardingJobs.error,
      consentAcceptedAt: onboardingJobs.consentAcceptedAt,
      consentIp: onboardingJobs.consentIp,
      scrapeStartedAt: onboardingJobs.scrapeStartedAt,
      scrapeDeadlineAt: onboardingJobs.scrapeDeadlineAt,
      createdAt: onboardingJobs.createdAt,
      updatedAt: onboardingJobs.updatedAt,
    })
    .from(onboardingJobs)
    .innerJoin(users, eq(users.id, onboardingJobs.userId))
    .where(eq(onboardingJobs.id, id))
    .limit(1);

  if (!job) notFound();

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <header>
          <div className="text-sm">
            <Link className="text-neutral-600 underline" href="/admin/onboarding-jobs">
              ← Volver a la lista
            </Link>
          </div>
          <h1 className="mt-2 font-mono text-xl text-neutral-900">{job.id}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Usuario: <span className="font-mono">{job.userEmail}</span>
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Estado y timestamps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <strong>Status:</strong>{" "}
              <span className="font-mono">{job.status}</span>
            </div>
            <div>
              <strong>Created:</strong> {new Date(job.createdAt).toISOString()}
            </div>
            <div>
              <strong>Updated:</strong> {new Date(job.updatedAt).toISOString()}
            </div>
            {job.scrapeStartedAt ? (
              <div>
                <strong>Scrape started:</strong>{" "}
                {new Date(job.scrapeStartedAt).toISOString()}
              </div>
            ) : null}
            {job.scrapeDeadlineAt ? (
              <div>
                <strong>Scrape deadline:</strong>{" "}
                {new Date(job.scrapeDeadlineAt).toISOString()}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>URLs pegadas</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-auto rounded-lg bg-neutral-50 p-3 text-xs">
              {JSON.stringify(job.urlsJson, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Consentimiento legal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div>
              <strong>Aceptado:</strong>{" "}
              {job.consentAcceptedAt
                ? new Date(job.consentAcceptedAt).toISOString()
                : "(no registrado)"}
            </div>
            <div>
              <strong>IP:</strong>{" "}
              <span className="font-mono">{job.consentIp ?? "(no registrada)"}</span>
            </div>
          </CardContent>
        </Card>

        {job.error ? (
          <Card>
            <CardHeader>
              <CardTitle>Error</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded-lg bg-red-50 p-3 text-sm text-red-900">
                {job.error}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {job.resultJson ? (
          <Card>
            <CardHeader>
              <CardTitle>Result JSON (scrape + merger)</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded-lg bg-neutral-50 p-3 text-xs max-h-[400px]">
                {JSON.stringify(job.resultJson, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Acciones</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionsPanel jobId={job.id} status={job.status} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
