import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { AgentEditor } from "./editor";

export default async function AgentPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent");
  const bundle = await requireTenant();
  if (!bundle?.config) redirect("/onboarding");

  const webhookUrl = `${process.env.RUNTIME_URL ?? "https://runtime.ordychat.com"}/webhook/{provider}/${bundle.tenant.slug}`;

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Mi agente</h1>
          <p className="mt-1 text-neutral-500">Edita el prompt, tono y estado del agente.</p>
        </div>
        <Badge tone={bundle.config.paused ? "warn" : "success"}>
          {bundle.config.paused ? "Pausado" : "Activo"}
        </Badge>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>URL del webhook</CardTitle>
          <CardDescription>
            Configura esta URL en tu proveedor de WhatsApp. Reemplaza {"{provider}"} por{" "}
            <code className="rounded bg-neutral-100 px-1 text-xs">whapi</code>,{" "}
            <code className="rounded bg-neutral-100 px-1 text-xs">meta</code> o{" "}
            <code className="rounded bg-neutral-100 px-1 text-xs">twilio</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block overflow-x-auto rounded-lg bg-neutral-900 p-4 text-sm text-emerald-400">
            {webhookUrl}
          </code>
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
    </AppShell>
  );
}
