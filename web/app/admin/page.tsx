import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages, tenants, users } from "@/lib/db/schema";

export default async function AdminHome() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const [tenantsCount] = await db.select({ n: count() }).from(tenants);
  const [activeCount] = await db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "active"));
  const [trialingCount] = await db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "trialing"));
  const [usersCount] = await db.select({ n: count() }).from(users);
  const [messagesCount] = await db.select({ n: count() }).from(messages);
  const [convsCount] = await db.select({ n: count() }).from(conversations);

  const recent = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(10);

  return (
    <AppShell session={session}>
      <div className="space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-neutral-900">Super Admin</h1>
            <Badge tone="new">Owner</Badge>
          </div>
          <p className="mt-1 text-neutral-500">Panel global de la plataforma.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Tenants totales" value={tenantsCount?.n ?? 0} />
          <Stat label="Con suscripción activa" value={activeCount?.n ?? 0} />
          <Stat label="En trial" value={trialingCount?.n ?? 0} />
          <Stat label="Usuarios" value={usersCount?.n ?? 0} />
          <Stat label="Conversaciones totales" value={convsCount?.n ?? 0} />
          <Stat label="Mensajes totales" value={messagesCount?.n ?? 0} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tenants recientes</CardTitle>
            <CardDescription>Los últimos 10 tenants creados.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Slug</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Trial vence</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-brand-600">{t.slug}</td>
                    <td>{t.name}</td>
                    <td><Badge tone={t.subscriptionStatus === "active" ? "success" : "warn"}>{t.subscriptionStatus}</Badge></td>
                    <td className="text-xs text-neutral-500">{new Date(t.trialEndsAt).toLocaleDateString("es-ES")}</td>
                    <td className="text-xs text-neutral-500">{new Date(t.createdAt).toLocaleDateString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Link href="/admin/tenants" className="inline-flex h-11 items-center rounded-full bg-neutral-900 px-5 text-sm font-medium text-white hover:bg-neutral-800">
            Ver todos los tenants
          </Link>
          <Link href="/admin/settings" className="inline-flex h-11 items-center rounded-full border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
            Configurar API keys
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
