// web/tests/unit/pos-reports.test.ts
// Mig 040: tests del helper de reportes POS.
//
// Cubre:
//   - resolveRecipients: cascada posReportPhones → handoffWhatsappPhone → [].
//   - buildShiftClosedMessage: todos los campos aparecen en el WA.
//   - buildShiftClosedMessage: si cashCents/cardCents son null, degrada a
//     "cobrado total" (retro-compat con mig 039 no mergeada).
//   - buildShiftAutoOpenedMessage + buildDailySummaryMessage: básicos.

import { describe, expect, it, vi } from "vitest";

// Mock DB para evitar el boot-time throw por DATABASE_URL ausente en test
// runner. Estos tests cubren funciones puras — el db real no se toca.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock("@/lib/crypto", () => ({
  cifrar: (s: string) => s,
  descifrar: (s: string) => s,
}));

import {
  buildDailySummaryMessage,
  buildShiftAutoOpenedMessage,
  buildShiftClosedMessage,
  resolveRecipients,
} from "@/lib/pos-reports";

describe("resolveRecipients", () => {
  it("usa posReportPhones cuando tiene al menos 1 entrada válida", () => {
    expect(
      resolveRecipients({
        posReportPhones: ["34604342381", "+34604137535"],
        handoffWhatsappPhone: "34999999999",
      }),
    ).toEqual(["34604342381", "34604137535"]);
  });

  it("cae a handoffWhatsappPhone cuando posReportPhones está vacío", () => {
    expect(
      resolveRecipients({
        posReportPhones: [],
        handoffWhatsappPhone: "34604342381",
      }),
    ).toEqual(["34604342381"]);
  });

  it("cae a handoffWhatsappPhone cuando posReportPhones tiene solo entradas inválidas", () => {
    expect(
      resolveRecipients({
        posReportPhones: ["", "  ", "12"],
        handoffWhatsappPhone: "34604342381",
      }),
    ).toEqual(["34604342381"]);
  });

  it("devuelve array vacío si no hay ninguno", () => {
    expect(
      resolveRecipients({
        posReportPhones: [],
        handoffWhatsappPhone: null,
      }),
    ).toEqual([]);
  });

  it("maneja null/undefined de posReportPhones (retrocompat)", () => {
    expect(
      resolveRecipients({
        posReportPhones: null,
        handoffWhatsappPhone: "34604342381",
      }),
    ).toEqual(["34604342381"]);
  });

  it("normaliza quitando el +", () => {
    expect(
      resolveRecipients({
        posReportPhones: ["+34604342381"],
        handoffWhatsappPhone: null,
      }),
    ).toEqual(["34604342381"]);
  });
});

describe("buildShiftClosedMessage", () => {
  const payloadBase = {
    openedAt: new Date("2026-04-23T07:00:00Z"), // 09:00 Madrid (verano CEST)
    closedAt: new Date("2026-04-23T12:30:00Z"), // 14:30 Madrid
    orderCount: 12,
    totalCents: 45_000, // 450€
    openingCashCents: 10_000, // 100€
    expectedCashCents: 55_000, // 550€
    countedCashCents: 54_800, // 548€
    diffCents: -200, // -2€
    topItems: [
      { name: "Hamburguesa clásica", quantity: 5 },
      { name: "Patatas", quantity: 4 },
      { name: "Coca cola", quantity: 3 },
    ],
  };

  it("incluye todos los campos con breakdown cash/card presente", () => {
    const msg = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: 30_000, // 300€
      cardCents: 15_000, // 150€
      otherCents: 0,
    });
    expect(msg).toContain("✅ Ordy Chat · Turno cerrado");
    expect(msg).toContain("12 pedidos");
    expect(msg).toContain("450 €"); // total
    expect(msg).toContain("100 €"); // opening
    expect(msg).toContain("300 €"); // cash
    expect(msg).toContain("150 €"); // card
    expect(msg).toContain("550 €"); // expected
    expect(msg).toContain("548 €"); // counted
    expect(msg).toContain("Diferencia");
    expect(msg).toContain("Hamburguesa clásica ×5");
    expect(msg).toContain("Patatas ×4");
    expect(msg).toContain("Coca cola ×3");
  });

  it("incluye línea 'Otros' si otherCents > 0", () => {
    const msg = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: 30_000,
      cardCents: 10_000,
      otherCents: 5_000, // 50€ Bizum
    });
    expect(msg).toContain("Otros (transfer/vale)");
    expect(msg).toContain("50 €");
  });

  it("degrada a 'cobrado total' cuando cashCents y cardCents son null (mig 039 no mergeada)", () => {
    const msg = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: null,
      cardCents: null,
      otherCents: null,
    });
    expect(msg).toContain("Cobrado total");
    expect(msg).toContain("450 €");
    expect(msg).not.toContain("Efectivo cobrado:");
    expect(msg).not.toContain("Tarjeta:");
  });

  it("muestra badge correcto según signo de diff", () => {
    const ok = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: 30_000,
      cardCents: 15_000,
      otherCents: 0,
      countedCashCents: 55_000,
      diffCents: 0,
    });
    expect(ok).toContain("✅ Diferencia");

    const neg = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: 30_000,
      cardCents: 15_000,
      otherCents: 0,
      countedCashCents: 54_500,
      diffCents: -500,
    });
    expect(neg).toContain("🔴 Diferencia");

    const pos = buildShiftClosedMessage({
      ...payloadBase,
      cashCents: 30_000,
      cardCents: 15_000,
      otherCents: 0,
      countedCashCents: 55_500,
      diffCents: 500,
    });
    expect(pos).toContain("🟢 Diferencia");
    expect(pos).toContain("+5 €");
  });
});

describe("buildShiftAutoOpenedMessage", () => {
  it("incluye hora y panelUrl", () => {
    const msg = buildShiftAutoOpenedMessage({
      openedAt: new Date("2026-04-23T09:00:00Z"), // 11:00 Madrid en CEST
      panelUrl: "https://ordychat.com/dashboard/turno",
    });
    expect(msg).toContain("🔔 Ordy Chat · Turno auto-abierto");
    expect(msg).toContain("caja inicial 0 €");
    expect(msg).toContain("https://ordychat.com/dashboard/turno");
  });
});

describe("buildDailySummaryMessage", () => {
  const base = {
    date: "23/04/2026",
    orderCount: 32,
    totalCents: 120_000,
    shiftLines: [
      "🕗 09:00-14:30 · 18 pedidos · 65€",
      "🕗 20:00-23:30 · 14 pedidos · 55€",
    ],
    topItems: [
      { name: "Hamburguesa", quantity: 18 },
      { name: "Ensalada", quantity: 8 },
      { name: "Patatas", quantity: 7 },
      { name: "Coca cola", quantity: 6 },
      { name: "Vino tinto", quantity: 3 },
    ],
  };

  it("incluye cabecera, total, líneas por turno, top 5", () => {
    const msg = buildDailySummaryMessage({
      ...base,
      cashCents: 80_000,
      cardCents: 40_000,
    });
    expect(msg).toContain("🌙 Ordy Chat · Resumen del día");
    expect(msg).toContain("23/04/2026");
    expect(msg).toContain("32 pedidos · 1200 €");
    expect(msg).toContain("09:00-14:30");
    expect(msg).toContain("20:00-23:30");
    expect(msg).toContain("Hamburguesa ×18");
    expect(msg).toContain("Vino tinto ×3");
    expect(msg).toContain("800 €"); // cash
    expect(msg).toContain("400 €"); // card
  });

  it("degrada cuando no hay payment_method", () => {
    const msg = buildDailySummaryMessage({
      ...base,
      cashCents: null,
      cardCents: null,
    });
    expect(msg).toContain("Cobrado total");
    expect(msg).not.toContain("Efectivo del día");
  });
});
