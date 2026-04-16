import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { stripeClient, stripePriceId } from "@/lib/stripe";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerUserId, session.user.id))
    .limit(1);
  if (!tenant) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const stripe = await stripeClient();
  const priceId = await stripePriceId();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email,
      name: tenant.name,
      metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
    });
    customerId = customer.id;
    await db.update(tenants).set({ stripeCustomerId: customerId }).where(eq(tenants.id, tenant.id));
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/billing?status=success`,
    cancel_url: `${baseUrl}/billing?status=cancel`,
    subscription_data: {
      trial_period_days: Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - Date.now()) / 86400000)),
      metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
    },
    metadata: { tenant_id: tenant.id },
  });

  return NextResponse.json({ url: checkout.url });
}
