import { describe, it, expect } from "vitest";
import { isAbsoluteUrl } from "../scripts/logic/url.mjs";

describe("isAbsoluteUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(isAbsoluteUrl("https://example.com/a.pdf")).toBe(true);
    expect(isAbsoluteUrl("http://localhost:30000/x")).toBe(true);
  });
  it("rejects relative paths", () => {
    expect(isAbsoluteUrl("modules/x/y.pdf")).toBe(false);
    expect(isAbsoluteUrl("/modules/x/y.pdf")).toBe(false);
  });
  it("rejects empty and malformed input without throwing", () => {
    expect(isAbsoluteUrl("")).toBe(false);
    expect(isAbsoluteUrl("http://[")).toBe(false);
    expect(isAbsoluteUrl(undefined)).toBe(false);
  });
});
