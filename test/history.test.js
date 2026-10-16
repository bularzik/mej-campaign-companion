import { describe, it, expect } from "vitest";
import { historyGroups } from "../scripts/logic/history.mjs";
import { noteAboutPrefix, noteMayMention, fitsNoteLimit } from "../scripts/logic/note-about.mjs";

describe("historyGroups", () => {
  const sessions = [
    { uuid: "JournalEntry.s2", name: "Session 2", order: 2 },
    { uuid: "JournalEntry.s1", name: "Session 1", order: 1 }
  ];
  const backlinks = [
    { uuid: "JournalEntry.s2", name: "Session 2", count: 1 },
    { uuid: "JournalEntry.p", name: "Place", count: 2 },
    { uuid: "JournalEntry.s1", name: "Session 1", count: 3 }
  ];
  it("groups session mentions in session order, then the rest", () => {
    expect(historyGroups(backlinks, sessions)).toEqual([
      { session: sessions[1], rows: [backlinks[2]] },
      { session: sessions[0], rows: [backlinks[0]] },
      { session: null, rows: [backlinks[1]] }
    ]);
  });
  it("omits empty groups", () => {
    expect(historyGroups([backlinks[1]], sessions)).toEqual([{ session: null, rows: [backlinks[1]] }]);
    expect(historyGroups([], sessions)).toEqual([]);
  });
});

describe("noteMayMention / fitsNoteLimit", () => {
  it("allows an entry whose viewers contain every notes reader", () => {
    expect(noteMayMention(["a", "b"], ["a", "b", "c"])).toBe(true);
  });
  it("refuses an entry visible to fewer users than the notes readers", () => {
    expect(noteMayMention(["a", "b"], ["a"])).toBe(false);
    expect(noteMayMention(["a"], [])).toBe(false);
  });
  it("checks the final length against the store limit", () => {
    expect(fitsNoteLimit("x".repeat(2000))).toBe(true);
    expect(fitsNoteLimit("x".repeat(2001))).toBe(false);
  });
});

describe("noteAboutPrefix", () => {
  it("builds an @UUID link with the plain name as label", () => {
    expect(noteAboutPrefix("JournalEntry.abc", "Elara")).toBe("@UUID[JournalEntry.abc]{Elara}");
  });
  it("neutralizes characters that could break out of the label or inject shorthand", () => {
    const out = noteAboutPrefix("JournalEntry.abc", 'Bad]}@UUID[X]{<b>"&');
    expect(out).toBe("@UUID[JournalEntry.abc]{Bad&#93;&#125;&#64;UUID&#91;X&#93;{&lt;b&gt;&quot;&amp;}");
    const label = out.slice("@UUID[JournalEntry.abc]{".length, -1);
    expect(label).not.toMatch(/[\]}@[<>"]/);
  });
  it("cannot be broken out of through the uuid either", () => {
    expect(noteAboutPrefix("JournalEntry.a]{x} @UUID[b", "N")).toBe("@UUID[JournalEntry.axUUIDb]{N}");
  });
});
