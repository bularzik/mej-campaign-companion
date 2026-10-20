import { describe, it, expect } from "vitest";
import { noteLinkTarget } from "../scripts/logic/note-link.mjs";

describe("noteLinkTarget", () => {
  it("a media note links to its image", () =>
    expect(noteLinkTarget({ kind: "reveal", mentions: [], ref: { src: "a.webp", kind: "media" } })).toEqual({ kind: "image", src: "a.webp" }));
  it("a reveal note links to its page when it has one", () =>
    expect(noteLinkTarget({ kind: "reveal", mentions: ["JournalEntry.v"], ref: { pageUuid: "JournalEntry.v.JournalEntryPage.p", kind: "block" } }))
      .toEqual({ kind: "entry", uuid: "JournalEntry.v.JournalEntryPage.p" }));
  it("a reveal note without a page links to the mentioned entry", () =>
    expect(noteLinkTarget({ kind: "reveal", mentions: ["JournalEntry.v"], ref: { kind: "block" } })).toEqual({ kind: "entry", uuid: "JournalEntry.v" }));
  it("a player note has no link", () =>
    expect(noteLinkTarget({ kind: "player", mentions: ["JournalEntry.v"] })).toBeNull());
  it("a media ref without a src and a reveal without mentions have no link", () => {
    expect(noteLinkTarget({ kind: "reveal", mentions: [], ref: { kind: "media" } })).toBeNull();
    expect(noteLinkTarget({ kind: "reveal", mentions: [] })).toBeNull();
  });
});
