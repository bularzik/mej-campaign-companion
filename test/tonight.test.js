import { describe, it, expect } from "vitest";
import { tonightContext, streamRows } from "../scripts/logic/tonight.mjs";
import { normalizeNotes } from "../scripts/logic/notes.mjs";

const S = "JournalEntry.s.JournalEntryPage.p";
const notes = normalizeNotes({
  a: { text: "a", authorId: "u1", authorName: "Jo", at: 1, sessionUuid: S },
  b: { text: "b", authorId: "u1", authorName: "Jo", at: 2, sessionUuid: S },
  c: { text: "c", authorId: "u1", authorName: "Jo", at: 3, sessionUuid: S },
  d: { text: "d", authorId: "u1", authorName: "Jo", at: 4, sessionUuid: S },
  held: { text: "h", authorId: "u1", authorName: "Jo", at: 5 }
});
const base = { campaign: { name: "Vale" }, user: { isGM: false, id: "u1" }, now: 10, formatTime: (ms) => `T${ms}`, nameOf: (id) => id, canWrite: true };

describe("tonightContext", () => {
  it("null without a campaign", () => expect(tonightContext({ ...base, campaign: null, notes, session: null })).toBeNull());
  it("open session: last three notes newest first, counts, player cannot start/end", () => {
    const ctx = tonightContext({ ...base, notes, session: { uuid: S, name: "Session 3", startedAt: 1 } });
    expect(ctx).toMatchObject({ campaignName: "Vale", open: true, sessionName: "Session 3", sessionUuid: S, startedLabel: "T1", noteCount: 4, heldCount: 1, canCapture: true, canStart: false, canEnd: false });
    expect(ctx.recent.map((n) => n.id)).toEqual(["d", "c", "b"]);
    expect(ctx.recent[0]).toEqual({ id: "d", authorName: "Jo", timeLabel: "T4", text: "d", retracted: false });
  });
  it("no session: GM can start; held count shows; capture allowed when writable", () => {
    const ctx = tonightContext({ ...base, user: { isGM: true, id: "gm" }, notes, session: null });
    expect(ctx).toMatchObject({ open: false, canStart: true, canEnd: false, heldCount: 1, canCapture: true, recent: [] });
  });
  it("GM with an open session can end it; a non-writer cannot capture", () => {
    expect(tonightContext({ ...base, user: { isGM: true, id: "gm" }, notes, session: { uuid: S, name: "S", startedAt: 1 } })).toMatchObject({ canEnd: true, canStart: false });
    expect(tonightContext({ ...base, canWrite: false, notes, session: null }).canCapture).toBe(false);
  });
});

describe("streamRows", () => {
  it("rows carry the note's link target", () => {
    const rows = streamRows([
      { id: "r", text: "r", authorId: "u1", at: 1, editedAt: null, kind: "reveal", mentions: ["JournalEntry.v"] },
      { id: "p", text: "p", authorId: "u1", at: 2, editedAt: null }
    ], { isGM: false, id: "u1" }, { formatTime: (ms) => `T${ms}` });
    expect(rows.map((r) => r.link)).toEqual([{ kind: "entry", uuid: "JournalEntry.v" }, null]);
  });
});
