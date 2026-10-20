import { describe, it, expect } from "vitest";
import { groundTone } from "../scripts/logic/sheet-ground.mjs";

describe("groundTone", () => {
  it("a parchment image is light even in a dark scheme", () =>
    expect(groundTone({ backgroundImage: 'url("/ui/parchment.jpg")', isDarkScheme: true })).toBe("light"));
  it("no image in a dark scheme is dark", () =>
    expect(groundTone({ backgroundImage: "none", isDarkScheme: true })).toBe("dark"));
  it("no image in a light scheme is light", () =>
    expect(groundTone({ backgroundImage: "none", isDarkScheme: false })).toBe("light"));
});
