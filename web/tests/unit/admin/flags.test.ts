// web/tests/unit/admin/flags.test.ts — Tests de feature flags.
//
// Mock de @/lib/db para evitar depender de Neon. Mock de @/lib/crypto para
// cifrar/descifrar identity (passthrough) — testamos lógica, no cifrado real.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks HOISTED — deben estar antes de imports reales.
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

vi.mock("@/lib/crypto", () => ({
  cifrar: (s: string) => `enc(${s})`,
  descifrar: (s: string) => s.replace(/^enc\(/, "").replace(/\)$/, ""),
}));

import { db } from "@/lib/db";
import {
  FLAG_KEY_PREFIX,
  FLAG_SPECS,
  _resetFlagCacheForTests,
  getFlag,
  invalidateFlagCache,
  listFlagStates,
  setFlag,
} from "@/lib/admin/flags";

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};

function mockSelectReturns(row: { valueEncrypted: string } | null) {
  const chain = (mockDb.select as (...args: unknown[]) => { limit: (n: number) => unknown })();
  chain.limit = vi.fn().mockResolvedValue(row ? [row] : []) as unknown as typeof chain.limit;
}

beforeEach(() => {
  _resetFlagCacheForTests();
  delete process.env.ONBOARDING_FAST_ENABLED;
  mockDb.select.mockClear();
  mockDb.insert.mockClear();
});

describe("FLAG_SPECS estructura", () => {
  it("tiene 3 specs con keys esperadas", () => {
    expect(FLAG_SPECS).toHaveLength(3);
    const keys = FLAG_SPECS.map((s) => s.key).sort();
    expect(keys).toEqual([
      "onboarding_fast_enabled",
      "validation_mode_default",
      "warmup_enforce",
    ]);
  });

  it("prefijo de storage es 'flag.'", () => {
    expect(FLAG_KEY_PREFIX).toBe("flag.");
  });
});

describe("getFlag — precedencia", () => {
  it("usa default si NO hay row NI env var", async () => {
    mockSelectReturns(null);
    const v = await getFlag<boolean>("warmup_enforce");
    expect(v).toBe(true); // default del spec
  });

  it("env var true → bool true (onboarding_fast_enabled)", async () => {
    mockSelectReturns(null);
    process.env.ONBOARDING_FAST_ENABLED = "true";
    const v = await getFlag<boolean>("onboarding_fast_enabled");
    expect(v).toBe(true);
  });

  it("env var 'false' → bool false", async () => {
    mockSelectReturns(null);
    process.env.ONBOARDING_FAST_ENABLED = "false";
    const v = await getFlag<boolean>("onboarding_fast_enabled");
    expect(v).toBe(false);
  });

  it("env var valor raro → default (no true ni false)", async () => {
    mockSelectReturns(null);
    process.env.ONBOARDING_FAST_ENABLED = "maybe";
    const v = await getFlag<boolean>("onboarding_fast_enabled");
    expect(v).toBe(false); // default
  });

  it("platform_settings gana sobre env var", async () => {
    mockSelectReturns({ valueEncrypted: "enc(false)" });
    process.env.ONBOARDING_FAST_ENABLED = "true";
    const v = await getFlag<boolean>("onboarding_fast_enabled");
    expect(v).toBe(false); // el settings dice false, aunque env diga true
  });

  it("validation_mode_default enum desde settings", async () => {
    mockSelectReturns({ valueEncrypted: 'enc("auto")' });
    const v = await getFlag<string>("validation_mode_default");
    expect(v).toBe("auto");
  });

  it("enum inválido en settings → cae a default", async () => {
    mockSelectReturns({ valueEncrypted: 'enc("bogus")' });
    const v = await getFlag<string>("validation_mode_default");
    expect(v).toBe("skip"); // default
  });
});

describe("getFlag — cache", () => {
  it("segunda llamada NO hace db.select de nuevo (cache hit)", async () => {
    mockSelectReturns(null);
    await getFlag("warmup_enforce");
    const firstCalls = mockDb.select.mock.calls.length;

    await getFlag("warmup_enforce");
    const secondCalls = mockDb.select.mock.calls.length;

    expect(secondCalls).toBe(firstCalls); // no increment
  });

  it("invalidateFlagCache fuerza re-lectura", async () => {
    mockSelectReturns(null);
    await getFlag("warmup_enforce");
    const firstCalls = mockDb.select.mock.calls.length;

    invalidateFlagCache("warmup_enforce");
    mockSelectReturns(null);
    await getFlag("warmup_enforce");
    const secondCalls = mockDb.select.mock.calls.length;

    expect(secondCalls).toBeGreaterThan(firstCalls);
  });
});

describe("setFlag — validación + invalidate", () => {
  it("rechaza valor con tipo incorrecto (bool con string)", async () => {
    await expect(
      setFlag("warmup_enforce", "not-a-bool", "u1"),
    ).rejects.toThrow(/VALIDATION/);
  });

  it("rechaza enum con valor fuera de options", async () => {
    await expect(
      setFlag("validation_mode_default", "xxxx", "u1"),
    ).rejects.toThrow(/VALIDATION/);
  });

  it("acepta bool válido → invalida cache", async () => {
    mockSelectReturns(null);
    await getFlag("warmup_enforce"); // puebla cache
    await setFlag("warmup_enforce", false, "u1");
    // Tras setFlag, el próximo getFlag debe ir a DB otra vez.
    mockSelectReturns({ valueEncrypted: "enc(false)" });
    const v = await getFlag<boolean>("warmup_enforce");
    expect(v).toBe(false);
  });
});

describe("listFlagStates", () => {
  it("retorna 3 entradas con source, value, type y description", async () => {
    mockSelectReturns(null);
    const list = await listFlagStates();
    expect(list).toHaveLength(3);
    for (const item of list) {
      expect(item.key).toBeDefined();
      expect(item.source).toBeOneOf(["platform_settings", "env", "default"]);
      expect(item.description).toBeTruthy();
    }
  });
});
