import { describe, it, expect } from "vitest";
import { sessionHeaderContext, headerMode } from "../scripts/logic/session-header.mjs";

describe("sessionHeaderContext", () => {
  it("empties fields so MEJ's shared partial never iterates the raw page schema", () => {
    const schemaShaped = { name: {}, type: {}, src: {}, category: {}, sort: {} };
    expect(sessionHeaderContext({ src: null, fields: schemaShaped }).fields).toEqual([]);
  });
  it("suppresses the header when there is no image and no populated field", () => {
    expect(sessionHeaderContext({ src: null }).showHeader).toBe(false);
    expect(sessionHeaderContext({ src: "" }).showHeader).toBe(false);
  });
  it("renders the header when the page has an image", () => {
    expect(sessionHeaderContext({ src: "worlds/a/session.webp" }).showHeader).toBe(true);
  });
  it("renders the header when a fieldlist-shaped field carries a value", () => {
    const ctx = sessionHeaderContext({ src: null, fields: [{ id: "sessionNumber", name: "Session", value: "12" }] });
    expect(ctx.fields).toEqual([{ id: "sessionNumber", name: "Session", value: "12" }]);
    expect(ctx.showHeader).toBe(true);
  });
});

describe("headerMode", () => {
  it("is 'full' whenever the page has an image, editable or not", () => {
    expect(headerMode({ src: "worlds/a/session.webp", editable: true })).toBe("full");
    expect(headerMode({ src: "worlds/a/session.webp", editable: false })).toBe("full");
  });
  it("is 'full' when a fieldlist-shaped field carries a value", () => {
    expect(headerMode({ src: null, fields: [{ id: "n", value: "12" }], editable: false })).toBe("full");
  });
  it("is 'compact' for an editor with no image and no populated field - the rename input and the add-image control still have to exist somewhere", () => {
    expect(headerMode({ src: null, editable: true })).toBe("compact");
    expect(headerMode({ src: "", fields: [], editable: true })).toBe("compact");
    expect(headerMode({ src: null, fields: [{ id: "n", value: "" }], editable: true })).toBe("compact");
  });
  it("is 'none' for a viewer who cannot edit and has no image to look at", () => {
    expect(headerMode({ src: null, editable: false })).toBe("none");
    expect(headerMode({ src: "", fields: [], editable: false })).toBe("none");
  });
  it("defaults to the read-only decision when editability is not stated", () => {
    expect(headerMode({ src: null })).toBe("none");
  });
});

describe("sessionHeaderContext mode flags", () => {
  it("exposes exactly one of the two template switches per mode", () => {
    const full = sessionHeaderContext({ src: "worlds/a/s.webp", editable: true });
    expect([full.headerMode, full.showHeader, full.showCompactHeader]).toEqual(["full", true, false]);
    const compact = sessionHeaderContext({ src: null, editable: true });
    expect([compact.headerMode, compact.showHeader, compact.showCompactHeader]).toEqual(["compact", false, true]);
    const none = sessionHeaderContext({ src: null, editable: false });
    expect([none.headerMode, none.showHeader, none.showCompactHeader]).toEqual(["none", false, false]);
  });
});
