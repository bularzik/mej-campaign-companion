// test/mej-mode.test.js
import { describe, it, expect } from "vitest";
import { resolveMode, MODE_API, MODE_NATIVE, MODE_ABSENT } from "../scripts/logic/mej-mode.mjs";

describe("resolveMode", () => {
  it("is absent whenever MEJ is not active, regardless of anything else", () => {
    expect(resolveMode({ handshakeFired: false, mejActive: false, forceNative: false })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: true, mejActive: false, forceNative: false })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: false, mejActive: false, forceNative: true })).toBe(MODE_ABSENT);
    expect(resolveMode({ handshakeFired: true, mejActive: false, forceNative: true })).toBe(MODE_ABSENT);
  });

  it("is api when the handshake fired and nothing forces native", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true, forceNative: false })).toBe(MODE_API);
  });

  it("is native when MEJ is active but the handshake never fired", () => {
    expect(resolveMode({ handshakeFired: false, mejActive: true, forceNative: false })).toBe(MODE_NATIVE);
  });

  it("forceNative overrides a received API", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true, forceNative: true })).toBe(MODE_NATIVE);
    expect(resolveMode({ handshakeFired: false, mejActive: true, forceNative: true })).toBe(MODE_NATIVE);
  });

  it("defaults forceNative to false when omitted", () => {
    expect(resolveMode({ handshakeFired: true, mejActive: true })).toBe(MODE_API);
  });
});
