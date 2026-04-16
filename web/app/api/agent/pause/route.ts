import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, tenantMembers } from "@/lib/db/schema";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const [membership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, session.user.id))
    .limit(1);
  if (!membership) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const [current] = await db
    .select({ paused: agentConfigs.paused })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, membership.tenantId))
    .limit(1);

  const next = !(current?.paused ?? false);

  await db
    .update(agentConfigs)
    .set({ paused: next, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, membership.tenantId));

  return NextResponse.json({ paused: next });
}
