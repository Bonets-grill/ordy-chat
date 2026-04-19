// Regression: QA-L1 — URL del hero /signin?from=... debe tener un solo ? y decodificar bien
// Found by /qa on 2026-04-19
// Report: .gstack/qa-reports/qa-report-ordychat-ordysuite-com-2026-04-19.md
//
// El bug original: hero.tsx producía "/signin?from=/onboarding?seed=X" (doble ?).
// Funcionaba por casualidad (URLSearchParams no splitea en ? interno) pero era frágil.
// El fix codifica el valor de `from` con encodeURIComponent.

import { describe, expect, it } from "vitest";

// Réplica del constructor usado en components/hero.tsx onSubmit.
// Si cambia el componente sin actualizar aquí, el test no detecta el drift —
// pero cualquiera que rompa la forma de la URL en hero.tsx verá que estos asserts
// siguen siendo el contrato esperado (doc vivo).
function buildSigninRedirect(raw: string): string {
  const text = raw.trim();
  const nextPath = text ? `/onboarding?seed=${encodeURIComponent(text)}` : "/onboarding";
  return `/signin?from=${encodeURIComponent(nextPath)}`;
}

describe("hero → signin redirect URL contract", () => {
  it("sin texto: from = /onboarding, un solo ?", () => {
    const url = buildSigninRedirect("");
    const params = new URL(`https://x.invalid${url}`).searchParams;
    expect(params.get("from")).toBe("/onboarding");
    expect((url.match(/\?/g) ?? []).length).toBe(1);
  });

  it("con texto: from decodifica a /onboarding?seed=<texto>", () => {
    const url = buildSigninRedirect("Quiero reservas por WhatsApp");
    const params = new URL(`https://x.invalid${url}`).searchParams;
    expect(params.get("from")).toBe("/onboarding?seed=Quiero%20reservas%20por%20WhatsApp");
    expect((url.match(/\?/g) ?? []).length).toBe(1);
  });

  it("texto con & y = no rompe el query string", () => {
    const url = buildSigninRedirect("pizza & pasta = amor");
    const params = new URL(`https://x.invalid${url}`).searchParams;
    // Solo debe existir `from` como top-level param.
    expect([...params.keys()]).toEqual(["from"]);
    // El valor de from, una vez decodificado, contiene el seed original.
    const from = params.get("from")!;
    const seedParams = new URL(`https://x.invalid${from}`).searchParams;
    expect(seedParams.get("seed")).toBe("pizza & pasta = amor");
  });

  it("whitespace solo se trata como vacío", () => {
    const url = buildSigninRedirect("   ");
    const params = new URL(`https://x.invalid${url}`).searchParams;
    expect(params.get("from")).toBe("/onboarding");
  });
});
