// tests/unit/reseller/consent.test.ts
import { describe, expect, it } from "vitest";
import {
  parseConsentCookie,
  buildConsentCookieHeaders,
  type ConsentChoice,
} from "@/lib/reseller/consent";

describe("parseConsentCookie", () => {
  it("returns null when header is empty", () => {
    expect(parseConsentCookie("")).toBeNull();
    expect(parseConsentCookie(null)).toBeNull();
    expect(parseConsentCookie(undefined)).toBeNull();
  });

  it("returns null when ordy_consent_v1 is absent", () => {
    expect(parseConsentCookie("other=foo; another=bar")).toBeNull();
  });

  it("returns 'accepted' when both cookies set to accepted", () => {
    const h = "ordy_consent_v1=accepted; ordy_consent_attribution=1";
    expect(parseConsentCookie(h)).toEqual({ version: "v1", attribution: true });
  });

  it("returns 'rejected' when v1=rejected and attribution is absent", () => {
    const h = "ordy_consent_v1=rejected";
    expect(parseConsentCookie(h)).toEqual({ version: "v1", attribution: false });
  });

  it("treats attribution as false unless value is exactly '1'", () => {
    const h = "ordy_consent_v1=accepted; ordy_consent_attribution=0";
    expect(parseConsentCookie(h)).toEqual({ version: "v1", attribution: false });
  });

  it("is whitespace tolerant", () => {
    const h = "  ordy_consent_v1=accepted ;  ordy_consent_attribution=1 ";
    expect(parseConsentCookie(h)).toEqual({ version: "v1", attribution: true });
  });
});

describe("buildConsentCookieHeaders", () => {
  const prod = true;
  const dev = false;

  it("accept in prod: both cookies set, Secure flag present", () => {
    const headers = buildConsentCookieHeaders("accepted" as ConsentChoice, prod);
    expect(headers).toHaveLength(2);
    const v1 = headers.find((h) => h.startsWith("ordy_consent_v1="));
    const attr = headers.find((h) => h.startsWith("ordy_consent_attribution="));
    expect(v1).toContain("ordy_consent_v1=accepted");
    expect(v1).toContain("SameSite=Lax");
    expect(v1).toContain("Path=/");
    expect(v1).toContain("Max-Age=15552000"); // 180d
    expect(v1).toContain("Secure");
    expect(attr).toContain("ordy_consent_attribution=1");
    expect(attr).toContain("Secure");
  });

  it("reject in prod: only v1 cookie, no attribution cookie", () => {
    const headers = buildConsentCookieHeaders("rejected" as ConsentChoice, prod);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain("ordy_consent_v1=rejected");
    expect(headers[0]).not.toContain("attribution");
  });

  it("accept in dev: no Secure flag (localhost)", () => {
    const headers = buildConsentCookieHeaders("accepted" as ConsentChoice, dev);
    expect(headers).toHaveLength(2);
    for (const h of headers) {
      expect(h).not.toContain("Secure");
    }
  });

  it("reject in dev: single cookie, no Secure", () => {
    const headers = buildConsentCookieHeaders("rejected" as ConsentChoice, dev);
    expect(headers).toHaveLength(1);
    expect(headers[0]).not.toContain("Secure");
    expect(headers[0]).toContain("ordy_consent_v1=rejected");
  });
});
