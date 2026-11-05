import { describe, expect, it } from "vitest";

import { renderSms, smsMobile, smsSegments, translitGe } from "./sms";

describe("sms helpers", () => {
  it("accepts only Georgian mobiles", () => {
    expect(smsMobile("+995 599 12 34 56")).toBe("995599123456");
    expect(smsMobile("599123456")).toBe("995599123456");
    expect(smsMobile("0322077058")).toBeNull();
    expect(smsMobile(null)).toBeNull();
  });
  it("renders templates and cleans empty vars", () => {
    expect(
      renderSms("{client}, პაკეტი {package}. ხაზი: {hotline}", { client: "ა", package: "" }),
    ).toBe("ა, პაკეტი. ხაზი:");
    expect(renderSms("№{call_no} — {status}", { call_no: 5, status: "გზაში" })).toBe("№5 — გზაში");
  });
  it("transliterates and counts segments", () => {
    expect(translitGe("გამოძახება №5")).toBe("gamodzakheba N5");
    expect(smsSegments("abc").segments).toBe(1);
    expect(smsSegments("ა".repeat(71))).toMatchObject({ unicode: true, segments: 2 });
  });
});
