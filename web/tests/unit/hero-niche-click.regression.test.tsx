// @vitest-environment happy-dom
// Regression: QA-M1 — botón de nicho no debe sobrescribir texto del usuario
// Found by /qa on 2026-04-19
// Report: .gstack/qa-reports/qa-report-ordychat-ordysuite-com-2026-04-19.md
//
// El bug: clicar un nicho (Restaurante, Clínica dental, etc.) hacía
// setValue(n.seed) incondicionalmente, destruyendo cualquier texto que el
// usuario ya hubiera escrito en el textarea del hero.
//
// Fix: setValue((v) => v.trim() ? v : n.seed) — solo rellena si vacío.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/hero";

// next/navigation no tiene implementación real en happy-dom — stub mínimo.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => cleanup());

describe("Hero niche button", () => {
  it("rellena el textarea cuando está vacío", () => {
    render(<Hero />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    const restaurante = screen.getByRole("button", { name: "Restaurante" });
    fireEvent.click(restaurante);

    expect(textarea.value).toContain("restaurante");
    expect(textarea.value.length).toBeGreaterThan(0);
  });

  it("NO sobrescribe el texto del usuario", () => {
    render(<Hero />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const miTexto = "Tengo una pizzería en Sevilla y quiero tomar pedidos por WhatsApp";

    fireEvent.change(textarea, { target: { value: miTexto } });
    expect(textarea.value).toBe(miTexto);

    // Ahora cambia de opinión y clica un nicho — el texto debe sobrevivir.
    const dental = screen.getByRole("button", { name: "Clínica dental" });
    fireEvent.click(dental);

    expect(textarea.value).toBe(miTexto);
  });

  it("rellena si el textarea solo tiene whitespace", () => {
    render(<Hero />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "   \n  " } });
    const barberia = screen.getByRole("button", { name: "Barbería" });
    fireEvent.click(barberia);

    expect(textarea.value).toContain("Barbería");
  });
});
