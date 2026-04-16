// lib/scraper/discover.ts — Descubre links relevantes dentro del mismo dominio.

const KEYWORDS = [
  // Menú / productos
  "menu", "menús", "carta", "platos", "pizzas", "bebidas", "postres", "entrantes",
  "productos", "tienda", "shop", "catálogo", "catalogo", "products", "items",
  "precios", "prices", "tarifas",
  // Servicios
  "servicios", "services", "tratamientos", "cursos", "planes",
  // Negocio
  "about", "sobre", "nosotros", "empresa", "historia",
  "contacto", "contact", "contactar",
  "horario", "horarios", "hours", "opening",
  "ubicación", "ubicacion", "location", "dirección", "direccion",
  "reservas", "reserva", "reservations", "booking",
  // FAQ / políticas
  "faq", "preguntas", "ayuda", "help",
  "alergenos", "alérgenos", "allergens", "ingredientes",
  "delivery", "envíos", "envios", "shipping",
] as const;

export function sameDomain(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

export function normalize(baseUrl: string, href: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    // Quita rastreadores comunes
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach(
      (k) => u.searchParams.delete(k),
    );
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Ordena links por relevancia (keyword match) y devuelve los top N únicos y dentro del dominio.
 */
export function discoverRelevant(
  baseUrl: string,
  links: { href: string; text: string }[],
  maxPages = 15,
): string[] {
  const scored: { url: string; score: number }[] = [];
  const seen = new Set<string>();

  for (const { href, text } of links) {
    const abs = normalize(baseUrl, href);
    if (!abs || !sameDomain(baseUrl, abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);

    const haystack = `${abs.toLowerCase()} ${text.toLowerCase()}`;
    let score = 0;
    for (const kw of KEYWORDS) {
      if (haystack.includes(kw)) score += 3;
    }
    // Penaliza URLs con muchos segmentos (páginas profundas típicamente tienen menos valor general).
    const depth = new URL(abs).pathname.split("/").filter(Boolean).length;
    score -= Math.max(0, depth - 3);
    // Premia texto corto (links tipo "Carta" vs párrafos largos).
    if (text.length > 0 && text.length < 30) score += 1;

    if (score > 0) scored.push({ url: abs, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxPages).map((s) => s.url);
}
