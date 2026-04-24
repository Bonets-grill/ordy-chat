import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, providerCredentials } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { AgentEditor } from "./editor";
import { HandoffCard } from "./handoff-card";

export default async function AgentPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent");
  const bundle = await requireTenant();
  if (!bundle?.config) redirect("/onboarding");

  const [creds] = await db
    .select({ provider: providerCredentials.provider, webhookSecret: providerCredentials.webhookSecret })
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, bundle.tenant.id))
    .limit(1);

  const [handoffRow] = await db
    .select({ handoffWhatsappPhone: agentConfigs.handoffWhatsappPhone })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);
  const handoffPhone = handoffRow?.handoffWhatsappPhone ?? null;

  const runtimeBase = process.env.RUNTIME_URL ?? "https://runtime.ordychat.com";
  const secret = creds?.webhookSecret ?? "";
  const providerKey = creds?.provider ?? "whapi";
  const secretQuery = secret ? `?s=${secret}` : "";
  const webhookUrl = `${runtimeBase}/webhook/${providerKey}/${bundle.tenant.slug}${secretQuery}`;

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <PageHeader
        title="Mi agente"
        subtitle="Edita el prompt, tono y estado del agente."
        actions={
          <Badge tone={bundle.config.paused ? "warn" : "success"}>
            {bundle.config.paused ? "Pausado" : "Activo"}
          </Badge>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>URL del webhook</CardTitle>
          <CardDescription>
            Pega esta URL en el dashboard de tu proveedor de WhatsApp ({providerKey}). Incluye un token único que valida que los mensajes vienen de tu número.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block overflow-x-auto rounded-lg bg-ink-900 p-4 font-mono text-[12.5px] text-emerald-300">
            {webhookUrl}
          </code>
          <p className="mt-3 text-[12px] text-ink-500">
            Cualquier request sin el token <code className="rounded bg-black/[0.06] px-1 font-mono">?s=…</code> correcto se rechaza con 403.
          </p>
        </CardContent>
      </Card>

      <AgentEditor
        tenantId={bundle.tenant.id}
        initial={{
          agentName: bundle.config.agentName,
          tone: bundle.config.tone as "professional" | "friendly" | "sales" | "empathetic",
          schedule: bundle.config.schedule,
          systemPrompt: bundle.config.systemPrompt,
          paused: bundle.config.paused,
        }}
      />

      <div className="mt-6">
        <HandoffCard initialPhone={handoffPhone} />
      </div>
    </AppShell>
  );
}
