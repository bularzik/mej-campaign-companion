import { describe, it, expect } from "vitest";
import { linkableRegions, sameLinkScope, scopeBacklinks } from "../scripts/logic/link-targets.mjs";

describe("linkableRegions", () => {
  it("yields text.content for an ordinary page", () => {
    expect(linkableRegions({ text: { content: "<p>Body.</p>" } })).toEqual([
      { key: "text.content", content: "<p>Body.</p>", gmOnly: false }
    ]);
  });

  it("yields recap then gmNotes for a session page, gmNotes marked gmOnly", () => {
    expect(linkableRegions({ system: { recap: "<p>R.</p>", gmNotes: "<p>N.</p>" } })).toEqual([
      { key: "system.recap", content: "<p>R.</p>", gmOnly: false },
      { key: "system.gmNotes", content: "<p>N.</p>", gmOnly: true }
    ]);
  });

  it("returns empty-string content rather than dropping a region", () => {
    expect(linkableRegions({ system: { recap: "" } })).toEqual([
      { key: "system.recap", content: "", gmOnly: false },
      { key: "system.gmNotes", content: "", gmOnly: true }
    ]);
    expect(linkableRegions({ text: {} })).toEqual([
      { key: "text.content", content: "", gmOnly: false }
    ]);
  });

  it("coerces a non-string gmNotes to empty", () => {
    const [, notes] = linkableRegions({ system: { recap: "x", gmNotes: null } });
    expect(notes).toEqual({ key: "system.gmNotes", content: "", gmOnly: true });
  });

  it("tolerates a null page", () => {
    expect(linkableRegions(null)).toEqual([{ key: "text.content", content: "", gmOnly: false }]);
  });
});

describe("sameLinkScope", () => {
  it.each([
    [null, null, true],
    [null, "A", true],
    ["A", null, true],
    ["A", "A", true],
    ["A", "B", false],
    [undefined, "A", true],
    ["", "A", true]
  ])("(%s, %s) -> %s", (a, b, want) => {
    expect(sameLinkScope(a, b)).toBe(want);
  });
});

describe("scopeBacklinks", () => {
  const rows = [{ uuid: "s1", count: 2 }, { uuid: "s2", count: 1 }, { uuid: "s3", count: 1 }];
  const cid = (uuid) => ({ s1: "c1", s2: "c2", s3: null })[uuid];
  it("drops sources from another campaign, keeps same-campaign and unfiled", () => {
    expect(scopeBacklinks(rows, "c1", cid)).toEqual([{ uuid: "s1", count: 2 }, { uuid: "s3", count: 1 }]);
  });
  it("an unfiled target sees everything", () => {
    expect(scopeBacklinks(rows, null, cid)).toEqual(rows);
  });
});
