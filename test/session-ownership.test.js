import { describe, it, expect } from "vitest";
import { shouldOwnSessionEntry, sessionEntriesNeedingOwnership, campaignSessionTargetLevel } from "../scripts/logic/session-ownership.mjs";
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

describe("sessionEntriesNeedingOwnership", () => {
  const OWNER = 3;
  const sel = { sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, ownerLevel: OWNER };
  const entry = (id, level, pages) => ({ id, ownership: level === undefined ? undefined : { default: level }, pages: { contents: pages } });

  it("keeps a session entry whose default ownership is below OWNER", () => {
    const e = entry("a", 2, [{ type: SESSION_DOCUMENT_TYPE }]);
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
  });
  it("accepts the bare in-memory page type MEJ's fixType leaves behind", () => {
    const e = entry("a", 0, [{ type: SESSION_TYPE }]);
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
  });
  it("drops an entry that is already OWNER", () => {
    expect(sessionEntriesNeedingOwnership([entry("a", 3, [{ type: SESSION_DOCUMENT_TYPE }])], sel)).toEqual([]);
  });
  it("drops entries with no session page", () => {
    expect(sessionEntriesNeedingOwnership([entry("a", 0, [{ type: "text" }]), entry("b", 0, [])], sel)).toEqual([]);
  });
  it("treats missing ownership as 0 and tolerates a plain pages array", () => {
    const e = { id: "a", pages: [{ type: SESSION_DOCUMENT_TYPE }] };
    expect(sessionEntriesNeedingOwnership([e], sel)).toEqual([e]);
    expect(sessionEntriesNeedingOwnership(undefined, sel)).toEqual([]);
  });
});

describe("shouldOwnSessionEntry with a campaign baseline (spec 2026-10-15 item 8)", () => {
  const sessionShape = { pages: [{ type: SESSION_DOCUMENT_TYPE }] };
  const o = (extra) => ({ sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, playersWriteSessions: false, ...extra });
  it("baseline observer or above grants ownership without the setting", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2 }))).toBe(true);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 3 }))).toBe(true);
  });
  it("Review Focus 5: a GM-only campaign (baseline none) never grants it", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 0 }))).toBe(false);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 0, playersWriteSessions: true }))).toBe(false);
  });
  it("outside a campaign the legacy setting still decides", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: null }))).toBe(false);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: null, playersWriteSessions: true }))).toBe(true);
  });
  it("a non-session shape is never owned", () => {
    expect(shouldOwnSessionEntry({ pages: [{ type: "text" }] }, o({ campaignBaseline: 3 }))).toBe(false);
  });
  it("an explicit creation-time default below observer wins inside a campaign (GM-only import)", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2, explicitDefault: 0 }))).toBe(false);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 3, explicitDefault: 0 }))).toBe(false);
  });
  it("an explicit observer-or-above default, or none given, still grants", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2, explicitDefault: 2 }))).toBe(true);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2, explicitDefault: undefined }))).toBe(true);
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: 2, explicitDefault: null }))).toBe(true);
  });
  it("outside a campaign the explicit default is ignored (legacy semantics unchanged)", () => {
    expect(shouldOwnSessionEntry(sessionShape, o({ campaignBaseline: null, playersWriteSessions: true, explicitDefault: 0 }))).toBe(true);
  });
});

describe("campaignSessionTargetLevel (bulk apply / un-hide keep the session grant)", () => {
  const o = { sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, observerLevel: 2, ownerLevel: 3 };
  const session = { flags: { "monks-enhanced-journal": { pagetype: SESSION_TYPE } }, pages: [] };
  const livePages = { flags: {}, pages: { contents: [{ type: SESSION_DOCUMENT_TYPE }] } };
  const person = { flags: { "monks-enhanced-journal": { pagetype: "person" } }, pages: [{ type: "text" }] };
  it("session in an observer campaign -> OWNER", () => {
    expect(campaignSessionTargetLevel(session, 2, o)).toBe(3);
    expect(campaignSessionTargetLevel(livePages, 2, o)).toBe(3);
  });
  it("session in a none campaign -> NONE", () => {
    expect(campaignSessionTargetLevel(session, 0, o)).toBe(0);
  });
  it("editor / owner baselines keep OWNER for sessions", () => {
    expect(campaignSessionTargetLevel(session, 3, o)).toBe(3);
    expect(campaignSessionTargetLevel(session, 4, o)).toBe(3);
  });
  it("non-session entries get the baseline unchanged", () => {
    expect(campaignSessionTargetLevel(person, 2, o)).toBe(2);
    expect(campaignSessionTargetLevel(person, 0, o)).toBe(0);
    expect(campaignSessionTargetLevel(person, 3, o)).toBe(3);
  });
});
