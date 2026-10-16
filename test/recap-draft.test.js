import { describe, it, expect } from "vitest";
import { recapDraft } from "../scripts/logic/recap-draft.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

describe("recapDraft", () => {
  const formatTime = (ms) => `T${ms}`;
  it("one paragraph per live note in order, author and time bolded, text kept as stored HTML", () => {
    const notes = normalizeNotes({
      b: { text: "second @UUID[JournalEntry.x]{X}", authorId: "u2", authorName: "Kim", at: 2 },
      a: { text: "first", authorId: "u1", authorName: "Jo", at: 1 },
      r: { text: "gone", authorId: "gm", authorName: "GM", at: 3, kind: "reveal", retracted: 4 }
    });
    expect(recapDraft(notes, { formatTime })).toBe(
      "<p><strong>T1 Jo</strong> first</p><p><strong>T2 Kim</strong> second @UUID[JournalEntry.x]{X}</p>"
    );
  });
  it("empty string for no notes", () => expect(recapDraft([], { formatTime })).toBe(""));
  it("escapes an author name", () => {
    const notes = normalizeNotes({ a: { text: "t", authorId: "u", authorName: "<b>", at: 1 } });
    expect(recapDraft(notes, { formatTime })).toBe("<p><strong>T1 &lt;b&gt;</strong> t</p>");
  });
});
