import { describe, it, expect } from "vitest";
import { sessionFlagPatch, embeddedPagesPatch } from "../scripts/logic/session-flag-stamp.mjs";

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

describe("embeddedPagesPatch", () => {
  const MEJ = "monks-enhanced-journal";
  it("stamps only the session pages that lack the flag, keeping everything else", () => {
    const text = { _id: "a", name: "t", type: "text" };
    const bare = { _id: "b", name: "s", type: "mej-campaign-companion.session", flags: { other: { x: 1 } } };
    const flagged = { _id: "c", name: "s2", type: "mej-campaign-companion.session", flags: { [MEJ]: { type: "session", keep: 1 } } };
    const out = embeddedPagesPatch({ pages: [text, bare, flagged] });
    expect(out.pages[0]).toBe(text);
    expect(out.pages[2]).toBe(flagged);
    expect(out.pages[1]).toEqual({ ...bare, flags: { other: { x: 1 }, [MEJ]: { type: "session" } } });
    expect(bare.flags[MEJ]).toBeUndefined(); // input not mutated
  });
  it("keeps other MEJ flags on a stamped page", () => {
    const page = { type: "mej-campaign-companion.session", flags: { [MEJ]: { relationships: {} } } };
    expect(embeddedPagesPatch({ pages: [page] }).pages[0].flags[MEJ]).toEqual({ relationships: {}, type: "session" });
  });
  it("returns null when no page needs stamping or there are no pages", () => {
    expect(embeddedPagesPatch({ pages: [{ type: "text" }] })).toBeNull();
    expect(embeddedPagesPatch({ pages: [] })).toBeNull();
    expect(embeddedPagesPatch({})).toBeNull();
    expect(embeddedPagesPatch(null)).toBeNull();
  });
});
