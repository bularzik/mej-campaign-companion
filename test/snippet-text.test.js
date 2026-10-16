import { describe, it, expect } from "vitest";
import { stripUuidLinks } from "../scripts/logic/snippet-text.mjs";

describe("stripUuidLinks", () => {
  it("replaces a labelled link with its label", () => {
    expect(stripUuidLinks("Met @UUID[JournalEntry.abc]{the Duke} at dawn")).toBe("Met the Duke at dawn");
  });
  it("replaces an unlabelled link with the resolved name, else the id tail", () => {
    expect(stripUuidLinks("See @UUID[JournalEntry.abc]", { nameOf: (u) => (u === "JournalEntry.abc" ? "Barnaby" : null) })).toBe("See Barnaby");
    expect(stripUuidLinks("See @UUID[JournalEntry.abc]")).toBe("See abc");
  });
  it("handles several links and leaves other @ text alone", () => {
    expect(stripUuidLinks("@UUID[A.1]{One} and @UUID[B.2]{Two} at @home")).toBe("One and Two at @home");
  });
  it("a truncated link at the snippet edge is dropped, not left dangling (Review Focus 4)", () => {
    expect(stripUuidLinks("…he arrived @UUID[JournalEntry.ab")).toBe("…he arrived ");
    expect(stripUuidLinks("…he arrived @UUID[JournalEntry.abc]{the Du")).toBe("…he arrived the Du");
  });
  it("non-strings give empty", () => {
    expect(stripUuidLinks(null)).toBe("");
  });
});
