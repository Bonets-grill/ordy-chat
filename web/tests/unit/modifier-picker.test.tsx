// @vitest-environment happy-dom
//
// web/tests/unit/modifier-picker.test.tsx
//
// Mig 042 — tests del picker visual de modifiers en /m/[slug].
// Cubre los edge-cases pedidos por Mario:
//   - Render con grupos required + opcional.
//   - Validación: confirm deshabilitado hasta que required cumpla.
//   - Cálculo dinámico del precio final (base + deltas).
//   - Item sin grupos → autoconfirm sin UI ni llamada extra al user.
//   - Errores de fetch → empty state visible.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModifierPicker } from "@/app/m/[slug]/modifier-picker";

const ITEM = { id: "item-1", name: "Pizza Margarita", priceCents: 1000 };
const SLUG = "demo";
const BRAND = "#ff7a00";

const LABELS = {
  required: "Obligatorio",
  optional: "Opcional",
  minSelectHint: (m: string) => `Selecciona al menos ${m}`,
  maxSelectHint: (m: string) => `Máx ${m}`,
  confirm: "Confirmar",
  confirmWithTotal: (t: string) => `Confirmar · ${t}`,
  cancel: "Cerrar",
  loading: "Cargando…",
  errorRetry: "No pudimos cargar las opciones.",
};

const FETCH_GROUPS_REQUIRED = {
  groups: [
    {
      id: "g1",
      name: "Tamaño",
      selectionType: "single",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      modifiers: [
        { id: "m1", name: "Mediana", priceDeltaCents: 0 },
        { id: "m2", name: "Grande", priceDeltaCents: 300 },
      ],
    },
    {
      id: "g2",
      name: "Extras",
      selectionType: "multi",
      required: false,
      minSelect: 0,
      maxSelect: 3,
      sortOrder: 1,
      modifiers: [
        { id: "m3", name: "Extra queso", priceDeltaCents: 150 },
        { id: "m4", name: "Bacon", priceDeltaCents: 200 },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetchOk(payload: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => payload,
  });
}

function mockFetchError() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: false,
    json: async () => ({ error: "boom" }),
  });
}

describe("ModifierPicker (mig 042)", () => {
  it("renderiza grupos required y opcionales con sus modifiers", async () => {
    mockFetchOk(FETCH_GROUPS_REQUIRED);
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText("Tamaño")).toBeTruthy());
    expect(screen.getByText("Extras")).toBeTruthy();
    // Required → badge "Obligatorio". Opcional → "Opcional".
    expect(screen.getAllByText("Obligatorio").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Opcional").length).toBeGreaterThan(0);
    // Modifiers visibles.
    expect(screen.getByText("Mediana")).toBeTruthy();
    expect(screen.getByText("Grande")).toBeTruthy();
    expect(screen.getByText("Extra queso")).toBeTruthy();
    expect(screen.getByText("Bacon")).toBeTruthy();
  });

  it("Confirmar deshabilitado hasta que se cumpla required, y se habilita tras seleccionar", async () => {
    mockFetchOk(FETCH_GROUPS_REQUIRED);
    const onConfirm = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText("Tamaño")).toBeTruthy());

    // Antes de seleccionar required: el botón está disabled.
    const confirmBtn = screen.getByRole("button", { name: /confirmar/i }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Seleccionamos "Mediana" (single, priceDelta 0).
    fireEvent.click(screen.getByText("Mediana"));

    // Ahora habilitado.
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /confirmar/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it("calcula precio final dinámicamente sumando deltas", async () => {
    mockFetchOk(FETCH_GROUPS_REQUIRED);
    const onConfirm = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText("Grande")).toBeTruthy());

    // Single required: Grande (+3,00). Multi: Extra queso (+1,50) + Bacon (+2,00).
    fireEvent.click(screen.getByText("Grande"));
    fireEvent.click(screen.getByText("Extra queso"));
    fireEvent.click(screen.getByText("Bacon"));

    // 1000 + 300 + 150 + 200 = 1650 → 16,50 €
    await waitFor(() => {
      expect(screen.getByText(/16,50 €/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [selection, finalPriceCents] = onConfirm.mock.calls[0] as [
      Array<{ name: string; priceDeltaCents: number }>,
      number,
    ];
    expect(finalPriceCents).toBe(1650);
    expect(selection.map((s) => s.name)).toEqual(["Grande", "Extra queso", "Bacon"]);
  });

  it("item sin grupos: auto-confirm con array vacío y precio base, sin UI", async () => {
    mockFetchOk({ groups: [] });
    const onConfirm = vi.fn();
    const { container } = render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith([], 1000);
    // El componente no debe pintar modal (auto-confirm path).
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("error de fetch: muestra mensaje de retry sin auto-confirmar", async () => {
    mockFetchError();
    const onConfirm = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText(LABELS.errorRetry)).toBeTruthy());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("open=false o item=null: no renderiza ni dispara fetch", () => {
    render(
      <ModifierPicker
        open={false}
        item={null}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("cerrar con la X dispara onClose sin confirmar", async () => {
    mockFetchOk(FETCH_GROUPS_REQUIRED);
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText("Tamaño")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Cerrar"));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("multi con maxSelect=2: bloquea seleccionar un 3ro", async () => {
    mockFetchOk({
      groups: [
        {
          id: "g",
          name: "Extras",
          selectionType: "multi",
          required: false,
          minSelect: 0,
          maxSelect: 2,
          sortOrder: 0,
          modifiers: [
            { id: "a", name: "Queso", priceDeltaCents: 100 },
            { id: "b", name: "Bacon", priceDeltaCents: 100 },
            { id: "c", name: "Cebolla", priceDeltaCents: 100 },
          ],
        },
      ],
    });
    const onConfirm = vi.fn();
    render(
      <ModifierPicker
        open={true}
        item={ITEM}
        slug={SLUG}
        brandColor={BRAND}
        labels={LABELS}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => expect(screen.getByText("Queso")).toBeTruthy());
    fireEvent.click(screen.getByText("Queso"));
    fireEvent.click(screen.getByText("Bacon"));
    fireEvent.click(screen.getByText("Cebolla")); // bloqueado: ya hay 2

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [selection] = onConfirm.mock.calls[0] as [Array<{ name: string }>, number];
    // Solo 2 — la 3ra fue ignorada por el guard de maxSelect.
    expect(selection.map((s) => s.name).sort()).toEqual(["Bacon", "Queso"]);
  });
});
