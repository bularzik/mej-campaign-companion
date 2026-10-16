import { describe, it, expect } from "vitest";
import { streamRows } from "../scripts/logic/tonight.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

describe("streamRows", () => {
  const notes = normalizeNotes({
    a: { text: "a", authorId: "u1", authorName: "Jo", at: 1, editedAt: 2 },
    b: { text: "b", authorId: "u2", authorName: "Kim", at: 3 }
  });
  it("in order, with edit stamps and per-user canEdit", () => {
    const rows = streamRows(notes, { id: "u1", isGM: false }, { formatTime: (ms) => `T${ms}` });
    expect(rows).toEqual([
      { id: "a", authorName: "Jo", timeLabel: "T1", text: "a", edited: true, canEdit: true, retracted: false },
      { id: "b", authorName: "Kim", timeLabel: "T3", text: "b", edited: false, canEdit: false, retracted: false }
    ]);
  });
  it("GM can edit all", () => {
    expect(streamRows(notes, { id: "gm", isGM: true }, { formatTime: () => "" }).every((r) => r.canEdit)).toBe(true);
  });
});
