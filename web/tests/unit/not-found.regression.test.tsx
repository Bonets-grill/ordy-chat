// @vitest-environment happy-dom
// Regression: QA-M2 — página 404 debe estar branded y en español
// Found by /qa on 2026-04-19
// Report: .gstack/qa-reports/qa-report-ordychat-ordysuite-com-2026-04-19.md
//
// El bug: Next.js servía su 404 default en inglés ("This page could not be found")
// sin branding ni ruta de vuelta. Hecho en contexto de un SaaS en español para
// pymes españolas = mala primera impresión.
//
// Fix: web/app/not-found.tsx con Navbar + copy en español + CTAs volver/pricing.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";

afterEach(() => cleanup());

describe("404 not-found page", () => {
  it("muestra el código 404 y título en español", () => {
    render(<NotFound />);
    expect(screen.getByText("Error 404")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/no existe/i);
  });

  it("incluye CTA para volver al inicio", () => {
    render(<NotFound />);
    const volver = screen.getByRole("link", { name: /volver al inicio/i });
    expect(volver.getAttribute("href")).toBe("/");
  });

  it("incluye CTA secundario a pricing", () => {
    render(<NotFound />);
    const pricing = screen.getByRole("link", { name: /ver precio/i });
    expect(pricing.getAttribute("href")).toBe("/pricing");
  });

  it("no contiene la copy default de Next.js en inglés", () => {
    const { container } = render(<NotFound />);
    expect(container.textContent).not.toMatch(/this page could not be found/i);
  });
});
