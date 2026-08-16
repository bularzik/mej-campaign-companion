import { describe, it, expect } from "vitest";
import { shouldOwnSessionEntry } from "../scripts/logic/session-ownership.mjs";
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../scripts/constants.mjs";

// Derived from the same constants the production code (campaign-companion.mjs)
// passes in, rather than re-typing the literal strings here, so a future
// rename of either constant can't silently desync the test from what's
// actually being matched.
const opts = (playersWriteSessions) => (
  { sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, playersWriteSessions }
);

describe("shouldOwnSessionEntry", () => {
  it("is false whenever the setting is off, regardless of shape", () => {
    expect(shouldOwnSessionEntry({ flags: { "monks-enhanced-journal": { pagetype: SESSION_TYPE } } }, opts(false))).toBe(false);
    expect(shouldOwnSessionEntry({ pages: [{ type: SESSION_TYPE }] }, opts(false))).toBe(false);
    expect(shouldOwnSessionEntry({ pages: [{ type: SESSION_DOCUMENT_TYPE }] }, opts(false))).toBe(false);
  });
  it("is true for MEJ's own new-entry pagetype flag when the setting is on (always the bare, unprefixed key)", () => {
    expect(shouldOwnSessionEntry({ flags: { "monks-enhanced-journal": { pagetype: SESSION_TYPE } } }, opts(true))).toBe(true);
  });
  it("is true for the docx import wizard's direct pages[] shape, using the real prefixed module-subtype type", () => {
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }, { type: SESSION_DOCUMENT_TYPE }] }, opts(true))).toBe(true);
  });
  it("also matches a bare-typed pages[] entry defensively (a path outside this module's control)", () => {
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }, { type: SESSION_TYPE }] }, opts(true))).toBe(true);
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
