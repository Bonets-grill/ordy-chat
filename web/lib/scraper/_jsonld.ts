// web/lib/scraper/_jsonld.ts — Helpers JSON-LD compartidos entre scrapers.
//
// Schema.org LocalBusiness / Restaurant / Hotel es el formato más estable y
// legible en Google Maps, TripAdvisor, webs corporativas modernas. Este módulo
// extrae y normaliza.

import { sanitizeScrapedObject } from "@/lib/onboarding-fast/sanitize";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

const LOCAL_BUSINESS_TYPES = /^(LocalBusiness|Restaurant|Hotel|Store|FoodEstablishment|CafeOrCoffeeShop|Bakery|BarOrPub|FastFoodRestaurant)$/i;

/**
 * Extrae el primer bloque JSON-LD con @type LocalBusiness/Restaurant/... del HTML.
 * Devuelve null si no encuentra nada utilizable.
 */
export function extractBusinessJsonLd(html: string): Record<string, unknown> | null {
  if (!html) return null;
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const found = findBusinessNode(data);
    if (found) return found;
  }
  return null;
}

function findBusinessNode(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const r = findBusinessNode(child);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(obj["@type"] ?? []);
    if (types.some((t) => typeof t === "string" && LOCAL_BUSINESS_TYPES.test(t))) {
      return obj;
    }
    // Algunas webs envuelven en @graph
    const graph = obj["@graph"];
    if (graph) {
      const r = findBusinessNode(graph);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Normaliza un bloque schema.org LocalBusiness (o variante) a Partial<CanonicalBusiness>.
 * Aplica sanitizeScrapedObject al resultado (strip prompt injection + trunc).
 */
export function normalizeFromJsonLd(data: Record<string, unknown>): Partial<CanonicalBusiness> {
  const out: Partial<CanonicalBusiness> = {};

  if (typeof data.name === "string") out.name = data.name;
  if (typeof data.description === "string") out.description = data.description;
  if (typeof data.telephone === "string") out.phone = data.telephone;
  if (typeof data.email === "string") out.email = data.email;

  const addr = data.address;
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    const a = addr as Record<string, unknown>;
    const parts = [a.streetAddress, a.postalCode, a.addressLocality, a.addressCountry]
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (parts.length > 0) out.address = parts.join(", ");
  }

  if (typeof data.url === "string") out.website = data.url;

  const hours = data.openingHours;
  if (typeof hours === "string") {
    out.hours = hours;
  } else if (Array.isArray(hours)) {
    const parts = hours.filter((h): h is string => typeof h === "string");
    if (parts.length > 0) out.hours = parts.join("; ");
  }

  // sameAs[] suele contener URLs de redes sociales.
  const sameAs = data.sameAs;
  if (Array.isArray(sameAs)) {
    const social: Record<string, string> = {};
    for (const u of sameAs) {
      if (typeof u !== "string") continue;
      if (u.includes("instagram.com")) social.instagram = u;
      else if (u.includes("facebook.com")) social.facebook = u;
      else if (u.includes("twitter.com") || u.includes("x.com")) social.twitter = u;
      else if (u.includes("tiktok.com")) social.tiktok = u;
      else if (u.includes("linkedin.com")) social.linkedin = u;
    }
    if (Object.keys(social).length > 0) out.social = social;
  }

  const agg = data.aggregateRating;
  if (agg && typeof agg === "object" && !Array.isArray(agg)) {
    const a = agg as Record<string, unknown>;
    const rv = Number(a.ratingValue);
    if (Number.isFinite(rv) && rv >= 0 && rv <= 5) out.rating = rv;
    const rc = Number(a.reviewCount ?? a.ratingCount);
    if (Number.isInteger(rc) && rc >= 0) out.reviews_count = rc;
  }

  // paymentAccepted puede ser string coma-separado o array
  const payments = data.paymentAccepted;
  if (typeof payments === "string") {
    const list = payments.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) out.payment_methods = list;
  } else if (Array.isArray(payments)) {
    const list = payments.filter((p): p is string => typeof p === "string");
    if (list.length > 0) out.payment_methods = list;
  }

  const sanitized = sanitizeScrapedObject(out);
  return sanitized.clean;
}
