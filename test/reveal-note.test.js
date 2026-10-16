import { describe, it, expect } from "vitest";
import { revealTransition, revealNote, revealKey, safeNoteName } from "../scripts/logic/reveal-note.mjs";
import { noteBadges, noteHtmlSource } from "../scripts/logic/notes.mjs";
import { streamRows, tonightContext } from "../scripts/logic/tonight.mjs";

const none = { users: [], groups: [], all: false };

describe("revealTransition (Review Focus 4)", () => {
  it("nothing -> someone is a reveal", () => {
    expect(revealTransition(none, { users: ["u1"], groups: [], all: false })).toBe("reveal");
    expect(revealTransition(undefined, { users: [], groups: [], all: true })).toBe("reveal");
  });
  it("someone -> someone else is an audience update, not a new reveal", () => {
    expect(revealTransition({ users: ["u1"], groups: [], all: false }, { users: ["u1", "u2"], groups: [], all: false })).toBe("update");
    expect(revealTransition({ users: ["u1"], groups: [], all: false }, { users: [], groups: [], all: true })).toBe("update");
  });
  it("same audience in a different order is none", () => {
    expect(revealTransition({ users: ["u1", "u2"], groups: [], all: false }, { users: ["u2", "u1"], groups: [], all: false })).toBe("none");
  });
  it("someone -> nobody is a retract", () => {
    expect(revealTransition({ users: [], groups: ["g1"], all: false }, none)).toBe("retract");
    expect(revealTransition({ users: [], groups: [], all: true }, none)).toBe("retract");
  });
  it("nobody -> nobody is none", () => expect(revealTransition(none, none)).toBe("none"));
  it("a changed revealedAt alone is none", () => {
    expect(revealTransition({ users: ["u1"], revealedAt: 1 }, { users: ["u1"], revealedAt: 2 })).toBe("none");
  });
});

describe("revealNote", () => {
  const base = { entryUuid: "JournalEntry.e1", entryName: "The Missing Caravan", pageUuid: "JournalEntry.e1.JournalEntryPage.p1", blockId: "secret-1", kind: "block", revealedBy: "gm", at: 1000, sessionUuid: "JournalEntry.s1", label: "Revealed a secret from The Missing Caravan" };
  it("references the block and never copies secret text", () => {
    const note = revealNote({ ...base, audience: { users: ["u1"], groups: [], all: false } });
    expect(note).toEqual({
      text: "Revealed a secret from The Missing Caravan",
      authorId: "gm", at: 1000, worldDate: null, sessionUuid: "JournalEntry.s1",
      mentions: ["JournalEntry.e1"], kind: "reveal",
      audience: { users: ["u1"], groups: [] },
      ref: { pageUuid: "JournalEntry.e1.JournalEntryPage.p1", blockId: "secret-1", kind: "block" }
    });
    expect(JSON.stringify(note)).not.toMatch(/staged/);
  });
  it("Everyone -> audience null (readable by every baseline reader)", () => {
    expect(revealNote({ ...base, audience: { users: [], groups: [], all: true } }).audience).toBeNull();
  });
  it("always carries an explicit audience object for a named reveal, even a groups-only one", () => {
    expect(revealNote({ ...base, audience: { groups: ["g1"] } }).audience).toEqual({ users: [], groups: ["g1"] });
  });
});

describe("revealKey", () => {
  it("builds a flag-safe key per reveal record", () => {
    expect(revealKey("block", "secret-1")).toBe("block-secret-1");
    expect(revealKey("rel", "r.1")).toBe("rel-r_1");
  });
});

describe("safeNoteName (labels hold an entry name, never markup or a live enricher)", () => {
  it("escapes markup", () => {
    const s = safeNoteName(`<img src=x onerror=alert(1)> & "q" 'a'`);
    expect(s).not.toMatch(/[<>"']/);
    expect(s).toContain("&lt;img");
    expect(s).toContain("&amp;");
  });
  it("breaks every enricher trigger, including @UUID and [[", () => {
    const s = safeNoteName("@UUID[JournalEntry.x]{y} [[/r 1d20]]");
    expect(s).not.toMatch(/@/);
    expect(noteHtmlSource(s)).not.toMatch(/@UUID\[/);
    expect(s).not.toMatch(/\[\[/);
  });
  it("is stable through noteHtmlSource (renders as the same text)", () => {
    const s = safeNoteName("Tom & Jerry");
    expect(noteHtmlSource(s)).toBe(s);
  });
  it("non-strings become empty", () => expect(safeNoteName(undefined)).toBe(""));
});

describe("noteBadges (GM-only retracted badge)", () => {
  it("a GM sees retracted on a retracted note", () => {
    expect(noteBadges({ retracted: 5 }, true)).toEqual({ retracted: true });
  });
  it("a player never gets the badge", () => {
    expect(noteBadges({ retracted: 5 }, false)).toEqual({ retracted: false });
  });
  it("a live note has no badge", () => {
    expect(noteBadges({ retracted: null }, true)).toEqual({ retracted: false });
  });
});

describe("retracted flag on rendered rows", () => {
  const notes = [
    { id: "a", at: 1, authorId: "gm", authorName: "GM", text: "x", editedAt: null, retracted: 9, sessionUuid: "S" },
    { id: "b", at: 2, authorId: "gm", authorName: "GM", text: "y", editedAt: null, retracted: null, sessionUuid: "S" }
  ];
  const fmt = (n) => String(n);
  it("streamRows marks retracted rows for a GM only", () => {
    expect(streamRows(notes, { id: "gm", isGM: true }, { formatTime: fmt }).map((r) => r.retracted)).toEqual([true, false]);
    expect(streamRows(notes, { id: "p", isGM: false }, { formatTime: fmt }).map((r) => r.retracted)).toEqual([false, false]);
  });
  it("tonight recent rows carry the same GM-only flag", () => {
    const ctx = tonightContext({ campaign: { name: "C" }, session: { uuid: "S", name: "S1", startedAt: 0 }, notes, user: { id: "gm", isGM: true }, formatTime: fmt, canWrite: true });
    expect(ctx.recent.map((r) => [r.id, r.retracted])).toEqual([["b", false], ["a", true]]);
  });
});
