import { describe, it, expect } from "vitest";
import { sessionFlagPatch } from "../scripts/logic/session-flag-stamp.mjs";

const PATCH = { "flags.monks-enhanced-journal.type": "session" };
describe("sessionFlagPatch", () => {
  it("stamps a session page that has no MEJ type flag", () => {
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session" })).toEqual(PATCH);
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: {} })).toEqual(PATCH);
    expect(sessionFlagPatch({ type: "session" })).toEqual(PATCH);
  });
  it("never overwrites an existing MEJ type flag", () => {
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "session" } } })).toBeNull();
    expect(sessionFlagPatch({ type: "mej-campaign-companion.session", flags: { "monks-enhanced-journal": { type: "other" } } })).toBeNull();
  });
  it("ignores other page types and bad input", () => {
    for (const d of [{ type: "text" }, { type: "mej-campaign-companion.campaign" }, {}, null, undefined]) expect(sessionFlagPatch(d)).toBeNull();
  });
});
