import { describe, it, expect } from "vitest";
import { parseImageDataUri, imageExtension } from "../scripts/logic/import-images.mjs";

describe("parseImageDataUri", () => {
  it("parses a base64 image data-URI into mime, subtype, and payload", () => {
    const r = parseImageDataUri("data:image/png;base64,AAAB");
    expect(r).toEqual({ mime: "image/png", subtype: "png", base64: "AAAB" });
  });

  it("lower-cases the subtype and handles hyphen/plus subtypes", () => {
    expect(parseImageDataUri("data:image/X-EMF;base64,ZZ").subtype).toBe("x-emf");
    expect(parseImageDataUri("data:image/svg+xml;base64,ZZ").subtype).toBe("svg+xml");
  });

  it("returns null for non-image, non-base64, or malformed URIs", () => {
    expect(parseImageDataUri("data:text/plain;base64,AA")).toBeNull();
    expect(parseImageDataUri("data:image/png,AA")).toBeNull();
    expect(parseImageDataUri("https://x/y.png")).toBeNull();
    expect(parseImageDataUri("")).toBeNull();
    expect(parseImageDataUri(null)).toBeNull();
  });
});

describe("imageExtension", () => {
  it("maps renderable subtypes to extensions (jpeg→jpg, svg+xml→svg)", () => {
    expect(imageExtension("png")).toBe("png");
    expect(imageExtension("jpeg")).toBe("jpg");
    expect(imageExtension("svg+xml")).toBe("svg");
    expect(imageExtension("webp")).toBe("webp");
  });

  it("returns null for types Foundry cannot render", () => {
    expect(imageExtension("x-emf")).toBeNull();
    expect(imageExtension("x-wmf")).toBeNull();
  });
});

import { assignTimepoints } from "../scripts/logic/import-images.mjs";

describe("assignTimepoints", () => {
  it("carries each session's id forward to following non-session pages", () => {
    // pages: [session A][text][session B][text]
    expect(assignTimepoints(["A", null, "B", null])).toEqual(["A", "A", "B", "B"]);
  });

  it("backfills pages before the first session to the first timepoint", () => {
    // pages: [intro][text][session A][text]
    expect(assignTimepoints([null, null, "A", null])).toEqual(["A", "A", "A", "A"]);
  });

  it("returns all null when there are no session pages", () => {
    expect(assignTimepoints([null, null, null])).toEqual([null, null, null]);
  });

  it("assigns a session page's own images to its own timepoint", () => {
    expect(assignTimepoints(["A", "B"])).toEqual(["A", "B"]);
  });

  it("returns an empty array for no pages", () => {
    expect(assignTimepoints([])).toEqual([]);
  });
});
