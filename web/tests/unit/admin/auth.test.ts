// web/tests/unit/admin/auth.test.ts — Tests del gate super admin.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de @/lib/auth antes de importar auth.ts.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { AdminAuthError, adminAction, requireSuperAdmin } from "@/lib/admin/auth";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

describe("requireSuperAdmin", () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it("lanza UNAUTHENTICATED si no hay sesión", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("lanza UNAUTHENTICATED si user.id ausente", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("lanza FORBIDDEN si role != 'super_admin'", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "x@y.z", role: "tenant_admin" },
    });
    await expect(requireSuperAdmin()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("retorna {userId,email} si role='super_admin'", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", email: "mario@ordy.com", role: "super_admin" },
    });
    const r = await requireSuperAdmin();
    expect(r).toEqual({ userId: "u1", email: "mario@ordy.com" });
  });

  it("email vacío si session no lo tiene (no crashea)", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "u1", role: "super_admin" },
    });
    const r = await requireSuperAdmin();
    expect(r.email).toBe("");
  });
});

describe("adminAction wrapper", () => {
  it("propaga shape {ok:true, data} si todo bien", async () => {
    const r = await adminAction(async () => ({ slug: "xyz" }));
    expect(r).toEqual({ ok: true, data: { slug: "xyz" } });
  });

  it("captura AdminAuthError UNAUTHENTICATED → shape correcto", async () => {
    const r = await adminAction(async () => {
      throw new AdminAuthError("UNAUTHENTICATED");
    });
    expect(r).toEqual({
      ok: false,
      error: "No autenticado",
      code: "UNAUTHENTICATED",
    });
  });

  it("captura AdminAuthError FORBIDDEN → shape correcto", async () => {
    const r = await adminAction(async () => {
      throw new AdminAuthError("FORBIDDEN");
    });
    expect(r).toEqual({
      ok: false,
      error: "Solo super admin",
      code: "FORBIDDEN",
    });
  });

  it("detecta VALIDATION: prefix como error de validación", async () => {
    const r = await adminAction(async () => {
      throw new Error("VALIDATION: campo X inválido");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("VALIDATION");
      expect(r.error).toBe("campo X inválido");
    }
  });

  it("error inesperado → code='INTERNAL'", async () => {
    const r = await adminAction(async () => {
      throw new Error("boom");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("INTERNAL");
      expect(r.error).toBe("boom");
    }
  });
});
