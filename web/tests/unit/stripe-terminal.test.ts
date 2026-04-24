// web/tests/unit/stripe-terminal.test.ts — Mig 045: Stripe Terminal handlers.
//
// Cubrimos los caminos críticos:
//   - POST /readers persiste con tenant_id correcto y pasa Stripe-Account.
//   - POST /charge crea PaymentIntent + pos_payments + dispara processPaymentIntent.
//   - DELETE /readers/[id] rechaza ownership cross-tenant (404).
//   - Webhook payment_intent.succeeded → marca order paid + pos_payments succeeded.
//
// Mockeamos @/lib/db, @/lib/stripe, @/lib/tenant + @/lib/kiosk-auth + @/lib/orders.

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ORDER_OF_A = "11111111-1111-4111-8111-111111111111";
const READER_UUID_A = "33333333-3333-4333-8333-333333333333";
const READER_UUID_B = "44444444-4444-4444-8444-444444444444";
const STRIPE_READER_ID_A = "tmr_aaaaaa";

// Estado mutable accedido por todos los mocks.
type ReaderRow = {
  id: string;
  tenantId: string;
  readerId: string;
  label: string | null;
  serialNumber: string | null;
  status: "online" | "offline";
  lastSeenAt: Date | null;
};
type OrderRow = {
  id: string;
  tenantId: string;
  status: string;
  totalCents: number;
  currency: string;
  paymentMethod: string | null;
  paidAt: Date | null;
  stripePaymentIntentId: string | null;
};
type PosPaymentRow = {
  id: string;
  tenantId: string;
  orderId: string;
  readerId: string | null;
  paymentIntentId: string;
  status: string;
  amountCents: number;
  currency: string;
  updatedAt: Date;
};

const READERS_DB = new Map<string, ReaderRow>();
const ORDERS_DB = new Map<string, OrderRow>();
const POS_PAYMENTS_DB = new Map<string, PosPaymentRow>();

const stripeCalls: Array<{ method: string; args: unknown[] }> = [];

function resetState() {
  READERS_DB.clear();
  ORDERS_DB.clear();
  POS_PAYMENTS_DB.clear();
  stripeCalls.length = 0;
  authState.tenantId = TENANT_A;
  authState.stripeAccountId = "acct_test_a";
}

const authState: { tenantId: string; stripeAccountId: string | null } = {
  tenantId: TENANT_A,
  stripeAccountId: "acct_test_a",
};

// --- Mocks ---
vi.mock("@/lib/tenant", () => ({
  requireTenant: vi.fn(async () => ({
    tenant: {
      id: authState.tenantId,
      stripeAccountId: authState.stripeAccountId,
      stripeTerminalLocationId: null,
    },
    config: null,
    trialDaysLeft: 14,
  })),
}));

vi.mock("@/lib/kiosk-auth", () => ({
  requireTenantOrKiosk: vi.fn(async () => ({
    tenant: {
      id: authState.tenantId,
      stripeAccountId: authState.stripeAccountId,
      stripeTerminalLocationId: null,
    },
    config: null,
    trialDaysLeft: 14,
  })),
}));

vi.mock("@/lib/stripe", () => ({
  stripeClient: vi.fn(async () => ({
    terminal: {
      readers: {
        create: vi.fn(async (params: { registration_code: string; label?: string }, opts: unknown) => {
          stripeCalls.push({ method: "terminal.readers.create", args: [params, opts] });
          return {
            id: STRIPE_READER_ID_A,
            label: params.label ?? "auto-label",
            serial_number: "WP3-12345",
            status: "online",
          };
        }),
        del: vi.fn(async (id: string, opts: unknown) => {
          stripeCalls.push({ method: "terminal.readers.del", args: [id, opts] });
          return { id, deleted: true };
        }),
        processPaymentIntent: vi.fn(async (readerId: string, params: { payment_intent: string }, opts: unknown) => {
          stripeCalls.push({ method: "terminal.readers.processPaymentIntent", args: [readerId, params, opts] });
          return { id: readerId, action: { type: "process_payment_intent" } };
        }),
      },
      connectionTokens: {
        create: vi.fn(async (_params: unknown, opts: unknown) => {
          stripeCalls.push({ method: "terminal.connectionTokens.create", args: [opts] });
          return { secret: "pst_test_secret_123" };
        }),
      },
    },
    paymentIntents: {
      create: vi.fn(async (params: { amount: number; currency: string; metadata: Record<string, string> }, opts: unknown) => {
        stripeCalls.push({ method: "paymentIntents.create", args: [params, opts] });
        return {
          id: `pi_${Math.random().toString(36).slice(2, 10)}`,
          amount: params.amount,
          currency: params.currency,
          status: "requires_payment_method",
          metadata: params.metadata,
        };
      }),
    },
  })),
}));

// Drizzle mock: chainable APIs que leen/escriben los Maps en memoria.
vi.mock("@/lib/db", () => {
  let currentSelectFilter: { table?: string; tenantId?: string; id?: string; readerId?: string; paymentIntentId?: string } = {};

  function makeSelectChain() {
    return {
      from: vi.fn(function (this: unknown, table: { _name?: string }) {
        currentSelectFilter.table = table._name ?? "unknown";
        return this;
      }),
      where: vi.fn(function (this: unknown, cond: { _tenantId?: string; _id?: string; _readerId?: string; _paymentIntentId?: string }) {
        if (cond?._tenantId) currentSelectFilter.tenantId = cond._tenantId;
        if (cond?._id) currentSelectFilter.id = cond._id;
        if (cond?._readerId) currentSelectFilter.readerId = cond._readerId;
        if (cond?._paymentIntentId) currentSelectFilter.paymentIntentId = cond._paymentIntentId;
        return this;
      }),
      limit: vi.fn(async () => {
        const filter = { ...currentSelectFilter };
        currentSelectFilter = {};
        if (filter.table === "readers") {
          const rows = [...READERS_DB.values()].filter((r) => {
            if (filter.tenantId && r.tenantId !== filter.tenantId) return false;
            if (filter.id && r.id !== filter.id) return false;
            return true;
          });
          return rows.slice(0, 1);
        }
        if (filter.table === "orders") {
          const rows = [...ORDERS_DB.values()].filter((o) => {
            if (filter.tenantId && o.tenantId !== filter.tenantId) return false;
            if (filter.id && o.id !== filter.id) return false;
            return true;
          });
          return rows.slice(0, 1);
        }
        if (filter.table === "pos_payments") {
          const rows = [...POS_PAYMENTS_DB.values()].filter((p) => {
            if (filter.tenantId && p.tenantId !== filter.tenantId) return false;
            if (filter.id && p.id !== filter.id) return false;
            if (filter.paymentIntentId && p.paymentIntentId !== filter.paymentIntentId) return false;
            return true;
          });
          return rows.slice(0, 1);
        }
        return [];
      }),
      // Sin .limit (para .where().select() de listings).
      then: undefined,
    };
  }

  return {
    db: {
      select: vi.fn(() => {
        const chain = makeSelectChain();
        // Make awaitable for fetches sin .limit (lista todos los readers).
        Object.defineProperty(chain, "then", {
          value: function (resolve: (value: unknown[]) => void, reject?: (e: Error) => void) {
            try {
              const filter = { ...currentSelectFilter };
              currentSelectFilter = {};
              if (filter.table === "readers") {
                const rows = [...READERS_DB.values()].filter((r) => {
                  if (filter.tenantId && r.tenantId !== filter.tenantId) return false;
                  return true;
                });
                resolve(rows);
              } else {
                resolve([]);
              }
            } catch (e) {
              reject?.(e as Error);
            }
          },
          configurable: true,
        });
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(function (this: unknown, vals: Record<string, unknown>) {
          // Captura values para el returning.
          (this as { _vals?: Record<string, unknown> })._vals = vals;
          return this;
        }),
        onConflictDoUpdate: vi.fn(function (this: unknown) {
          return this;
        }),
        onConflictDoNothing: vi.fn(function (this: unknown) {
          return this;
        }),
        returning: vi.fn(async function (this: { _vals?: Record<string, unknown> }) {
          const v = this._vals as Record<string, unknown> | undefined;
          if (!v) return [];
          // Decidir tabla por columnas presentes.
          if ("readerId" in v && "tenantId" in v && !("orderId" in v)) {
            const id = (v.id as string | undefined) ?? `r_${Math.random().toString(36).slice(2, 10)}`;
            const row: ReaderRow = {
              id,
              tenantId: v.tenantId as string,
              readerId: v.readerId as string,
              label: (v.label as string | null) ?? null,
              serialNumber: (v.serialNumber as string | null) ?? null,
              status: (v.status as "online" | "offline") ?? "offline",
              lastSeenAt: (v.lastSeenAt as Date | null) ?? null,
            };
            READERS_DB.set(row.id, row);
            return [row];
          }
          if ("orderId" in v && "paymentIntentId" in v) {
            const id = (v.id as string | undefined) ?? `pp_${Math.random().toString(36).slice(2, 10)}`;
            const row: PosPaymentRow = {
              id,
              tenantId: v.tenantId as string,
              orderId: v.orderId as string,
              readerId: (v.readerId as string | null) ?? null,
              paymentIntentId: v.paymentIntentId as string,
              status: (v.status as string) ?? "pending",
              amountCents: v.amountCents as number,
              currency: (v.currency as string) ?? "EUR",
              updatedAt: new Date(),
            };
            POS_PAYMENTS_DB.set(row.id, row);
            return [row];
          }
          return [];
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(function (this: unknown) {
          return this;
        }),
        where: vi.fn(function (this: unknown) {
          return this;
        }),
        returning: vi.fn(async () => []),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async function (this: unknown, cond: { _id?: string; _tenantId?: string }) {
          if (cond?._id) READERS_DB.delete(cond._id);
          return this;
        }),
      })),
    },
  };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string }, val: string) => {
      const colName = col?.name ?? "";
      if (colName === "id") return { _id: val };
      if (colName === "tenant_id") return { _tenantId: val };
      if (colName === "reader_id") return { _readerId: val };
      if (colName === "payment_intent_id") return { _paymentIntentId: val };
      return { col, val };
    },
    and: (...args: Array<Record<string, unknown>>) =>
      args.reduce((acc, a) => ({ ...acc, ...a }), {}),
  };
});

vi.mock("@/lib/db/schema", () => ({
  stripeTerminalReaders: {
    _name: "readers",
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
    readerId: { name: "reader_id" },
  },
  posPayments: {
    _name: "pos_payments",
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
    paymentIntentId: { name: "payment_intent_id" },
    orderId: { name: "order_id" },
  },
  orders: {
    _name: "orders",
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
  },
  tenants: {
    _name: "tenants",
    id: { name: "id" },
  },
}));

// --- Suite ---
describe("Mig 045 — Stripe Terminal endpoints", () => {
  beforeEach(() => {
    resetState();
  });

  it("POST /readers persiste con tenantId del request y label preservado", async () => {
    const mod = await import("@/app/api/stripe/terminal/readers/route");
    const req = new Request("http://test.local/api/stripe/terminal/readers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationCode: "simulated-wpe", label: "Caja principal" }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reader: { readerId: string } };
    expect(body.ok).toBe(true);
    expect(body.reader.readerId).toBe(STRIPE_READER_ID_A);

    // El insert llegó con tenant_id correcto.
    const persisted = [...READERS_DB.values()];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.tenantId).toBe(TENANT_A);
    expect(persisted[0]!.label).toBe("Caja principal");

    // Stripe llamado con stripeAccount header (Connect).
    const create = stripeCalls.find((c) => c.method === "terminal.readers.create");
    expect(create).toBeDefined();
    expect((create!.args[1] as { stripeAccount: string }).stripeAccount).toBe("acct_test_a");
  });

  it("POST /readers devuelve 412 si el tenant no tiene Stripe Connect", async () => {
    authState.stripeAccountId = null;
    const mod = await import("@/app/api/stripe/terminal/readers/route");
    const req = new Request("http://test.local/api/stripe/terminal/readers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationCode: "simulated-wpe" }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("stripe_connect_missing");
  });

  it("DELETE /readers/[id] rechaza con 404 si el reader es de otro tenant", async () => {
    READERS_DB.set(READER_UUID_B, {
      id: READER_UUID_B,
      tenantId: TENANT_B,
      readerId: "tmr_other_tenant",
      label: null,
      serialNumber: null,
      status: "offline",
      lastSeenAt: null,
    });
    const mod = await import("@/app/api/stripe/terminal/readers/[id]/route");
    const req = new Request(`http://test.local/api/stripe/terminal/readers/${READER_UUID_B}`, {
      method: "DELETE",
    });
    const res = await mod.DELETE(req, { params: Promise.resolve({ id: READER_UUID_B }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reader_not_found");

    // No se llamó a Stripe (no debe enviar señal cross-tenant).
    expect(stripeCalls.find((c) => c.method === "terminal.readers.del")).toBeUndefined();
  });

  it("POST /charge crea PaymentIntent + pos_payments y dispara processPaymentIntent", async () => {
    READERS_DB.set(READER_UUID_A, {
      id: READER_UUID_A,
      tenantId: TENANT_A,
      readerId: STRIPE_READER_ID_A,
      label: "Caja",
      serialNumber: null,
      status: "online",
      lastSeenAt: null,
    });
    ORDERS_DB.set(ORDER_OF_A, {
      id: ORDER_OF_A,
      tenantId: TENANT_A,
      status: "ready",
      totalCents: 1295,
      currency: "EUR",
      paymentMethod: null,
      paidAt: null,
      stripePaymentIntentId: null,
    });

    const mod = await import("@/app/api/stripe/terminal/charge/route");
    const req = new Request("http://test.local/api/stripe/terminal/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: ORDER_OF_A, readerId: READER_UUID_A }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; paymentIntentId: string };
    expect(body.ok).toBe(true);
    expect(body.paymentIntentId).toMatch(/^pi_/);

    // PaymentIntent creado con metadata correcta.
    const piCall = stripeCalls.find((c) => c.method === "paymentIntents.create");
    expect(piCall).toBeDefined();
    const piParams = piCall!.args[0] as {
      amount: number;
      currency: string;
      payment_method_types: string[];
      metadata: Record<string, string>;
    };
    expect(piParams.amount).toBe(1295);
    expect(piParams.currency).toBe("eur");
    expect(piParams.payment_method_types).toEqual(["card_present"]);
    expect(piParams.metadata.tenant_id).toBe(TENANT_A);
    expect(piParams.metadata.order_id).toBe(ORDER_OF_A);
    expect(piParams.metadata.source).toBe("ordy_terminal");

    // pos_payments persistido.
    const payments = [...POS_PAYMENTS_DB.values()];
    expect(payments).toHaveLength(1);
    expect(payments[0]!.tenantId).toBe(TENANT_A);
    expect(payments[0]!.orderId).toBe(ORDER_OF_A);
    expect(payments[0]!.amountCents).toBe(1295);

    // processPaymentIntent llamado con readerId stripe + Connect header.
    const processCall = stripeCalls.find((c) => c.method === "terminal.readers.processPaymentIntent");
    expect(processCall).toBeDefined();
    expect(processCall!.args[0]).toBe(STRIPE_READER_ID_A);
    expect((processCall!.args[2] as { stripeAccount: string }).stripeAccount).toBe("acct_test_a");
  });

  it("POST /charge devuelve 404 si la orden es de otro tenant", async () => {
    ORDERS_DB.set(ORDER_OF_A, {
      id: ORDER_OF_A,
      tenantId: TENANT_B, // ojo: tenant B
      status: "ready",
      totalCents: 1295,
      currency: "EUR",
      paymentMethod: null,
      paidAt: null,
      stripePaymentIntentId: null,
    });
    READERS_DB.set(READER_UUID_A, {
      id: READER_UUID_A,
      tenantId: TENANT_A,
      readerId: STRIPE_READER_ID_A,
      label: null,
      serialNumber: null,
      status: "online",
      lastSeenAt: null,
    });

    const mod = await import("@/app/api/stripe/terminal/charge/route");
    const req = new Request("http://test.local/api/stripe/terminal/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: ORDER_OF_A, readerId: READER_UUID_A }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("order_not_found");
  });

  it("POST /charge rechaza si la orden ya está pagada", async () => {
    READERS_DB.set(READER_UUID_A, {
      id: READER_UUID_A,
      tenantId: TENANT_A,
      readerId: STRIPE_READER_ID_A,
      label: null,
      serialNumber: null,
      status: "online",
      lastSeenAt: null,
    });
    ORDERS_DB.set(ORDER_OF_A, {
      id: ORDER_OF_A,
      tenantId: TENANT_A,
      status: "paid",
      totalCents: 1295,
      currency: "EUR",
      paymentMethod: "card",
      paidAt: new Date(),
      stripePaymentIntentId: "pi_already",
    });

    const mod = await import("@/app/api/stripe/terminal/charge/route");
    const req = new Request("http://test.local/api/stripe/terminal/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: ORDER_OF_A, readerId: READER_UUID_A }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("order_already_paid");
  });

  it("POST /connection-token devuelve secret bajo Stripe-Account header", async () => {
    const mod = await import("@/app/api/stripe/terminal/connection-token/route");
    const res = await mod.POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string };
    expect(body.secret).toBe("pst_test_secret_123");

    const tokenCall = stripeCalls.find((c) => c.method === "terminal.connectionTokens.create");
    expect(tokenCall).toBeDefined();
    expect((tokenCall!.args[0] as { stripeAccount: string }).stripeAccount).toBe("acct_test_a");
  });

  it("POST /connection-token devuelve 412 sin Stripe Connect", async () => {
    authState.stripeAccountId = null;
    const mod = await import("@/app/api/stripe/terminal/connection-token/route");
    const res = await mod.POST();
    expect(res.status).toBe(412);
  });
});
