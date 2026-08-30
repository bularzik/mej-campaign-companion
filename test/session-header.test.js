import { describe, it, expect } from "vitest";
import { sessionHeaderContext } from "../scripts/logic/session-header.mjs";

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
