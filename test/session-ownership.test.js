import { describe, it, expect } from "vitest";
import { shouldOwnSessionEntry } from "../scripts/logic/session-ownership.mjs";

const opts = (playersWriteSessions) => ({ sessionType: "session", playersWriteSessions });

describe("shouldOwnSessionEntry", () => {
  it("is false whenever the setting is off, regardless of shape", () => {
    expect(shouldOwnSessionEntry({ flags: { "monks-enhanced-journal": { pagetype: "session" } } }, opts(false))).toBe(false);
    expect(shouldOwnSessionEntry({ pages: [{ type: "session" }] }, opts(false))).toBe(false);
  });
  it("is true for MEJ's own new-entry pagetype flag when the setting is on", () => {
    expect(shouldOwnSessionEntry({ flags: { "monks-enhanced-journal": { pagetype: "session" } } }, opts(true))).toBe(true);
  });
  it("is true for the docx import wizard's direct pages[] shape when the setting is on", () => {
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }, { type: "session" }] }, opts(true))).toBe(true);
  });
  it("is false for unrelated pagetypes or page types", () => {
    expect(shouldOwnSessionEntry({ flags: { "monks-enhanced-journal": { pagetype: "person" } } }, opts(true))).toBe(false);
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }] }, opts(true))).toBe(false);
  });
  it("tolerates missing flags/pages entirely", () => {
    expect(shouldOwnSessionEntry({}, opts(true))).toBe(false);
    expect(shouldOwnSessionEntry(undefined, opts(true))).toBe(false);
  });
});
