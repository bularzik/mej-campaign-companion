import { describe, it, expect } from "vitest";
import {
  NOTE_KINDS, validNoteText, normalizeNotes, mentionsOf, noteCreateUpdate, noteEditUpdate, noteDeleteUpdate,
  noteRetractUpdate, noteAudienceUpdate, canEditNote, visibleNotes, notesForSession, notesMentioning, heldNotes, noteCountsBySession
} from "../scripts/logic/notes.mjs";
import { NOTE_TEXT_MAX } from "../scripts/constants.mjs";

const P = "mej-campaign-companion";
const S1 = "JournalEntry.s1.JournalEntryPage.p1";
const E1 = "JournalEntry.e1";
const E2 = "JournalEntry.e2";
const gm = { id: "gm", isGM: true };
const u1 = { id: "u1", isGM: false };
const u2 = { id: "u2", isGM: false };
const groups = [{ id: "g1", name: "Inner", members: ["u1"] }];

describe("validNoteText", () => {
  it("trims and bounds", () => {
    expect(validNoteText("  the duke is lying ")).toBe("the duke is lying");
    expect(validNoteText("   ")).toBeNull();
    expect(validNoteText(null)).toBeNull();
    expect(validNoteText("x".repeat(NOTE_TEXT_MAX + 1))).toBeNull();
    expect(validNoteText("x".repeat(NOTE_TEXT_MAX))).toHaveLength(NOTE_TEXT_MAX);
  });
});

describe("normalizeNotes", () => {
  it("coerces fields, drops malformed, sorts by at", () => {
    const notes = normalizeNotes({
      b: { text: "second", authorId: "u1", at: 20, sessionUuid: S1 },
      a: { text: "first", authorId: "u1", authorName: "Jo", at: 10, mentions: [E1], kind: "gm", audience: { users: ["u2"] } },
      bad1: { authorId: "u1" },
      bad2: "nope"
    });
    expect(notes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(notes[0]).toEqual({
      id: "a", text: "first", authorId: "u1", authorName: "Jo", at: 10, worldDate: null, sessionUuid: null,
      mentions: [E1], audience: { users: ["u2"], groups: [], all: false }, kind: "gm", editedAt: null, retracted: null, ref: null
    });
    expect(notes[1].kind).toBe("player");
    expect(notes[1].audience).toBeNull();
  });
  it("nullish gives []", () => expect(normalizeNotes(undefined)).toEqual([]));
  it("unknown kind falls back to player", () => {
    expect(normalizeNotes({ a: { text: "t", authorId: "u1", at: 1, kind: "weird" } })[0].kind).toBe("player");
    expect(NOTE_KINDS).toEqual(["player", "gm", "reveal"]);
  });
  it("neutralizes stray < and > in stored text so no read path can carry markup (R1)", () => {
    const [note] = normalizeNotes({ a: { text: "<img src=x onerror=alert(1)>hi", authorId: "u1", at: 1 } });
    expect(note.text).toBe("&lt;img src=x onerror=alert(1)&gt;hi");
  });
});

describe("mentionsOf", () => {
  it("collects unique entry uuids, collapsing page uuids", () => {
    const text = `met @UUID[${E1}]{Duke} and @UUID[${E1}.JournalEntryPage.x]{Duke} at @UUID[${E2}]{Inn} @UUID[Actor.a1]{Bob}`;
    expect(mentionsOf(text)).toEqual([E1, E2]);
  });
  it("empty for plain text", () => expect(mentionsOf("nothing here")).toEqual([]));
});

describe("update paths (Review Focus 1: one keyed path per note)", () => {
  it("noteCreateUpdate writes exactly one key", () => {
    const { id, update } = noteCreateUpdate({ id: "n1", text: "hi", authorId: "u1", authorName: "Jo", at: 5, sessionUuid: S1 });
    expect(id).toBe("n1");
    expect(Object.keys(update)).toEqual([`flags.${P}.notes.n1`]);
    expect(update[`flags.${P}.notes.n1`]).toEqual({
      text: "hi", authorId: "u1", authorName: "Jo", at: 5, worldDate: null, sessionUuid: S1,
      mentions: [], audience: null, kind: "player", editedAt: null, retracted: null, ref: null
    });
  });
  it("noteCreateUpdate derives mentions from text when not given", () => {
    const { update } = noteCreateUpdate({ id: "n2", text: `saw @UUID[${E2}]{Inn}`, authorId: "u1", authorName: "Jo", at: 1 });
    expect(update[`flags.${P}.notes.n2`].mentions).toEqual([E2]);
  });
  it("noteEditUpdate touches text, mentions and editedAt only", () => {
    const note = normalizeNotes({ n1: { text: "old", authorId: "u1", at: 1 } })[0];
    expect(noteEditUpdate(note, ` new @UUID[${E1}]{D} `, { now: 9 })).toEqual({
      [`flags.${P}.notes.n1.text`]: `new @UUID[${E1}]{D}`,
      [`flags.${P}.notes.n1.mentions`]: [E1],
      [`flags.${P}.notes.n1.editedAt`]: 9
    });
    expect(noteEditUpdate(note, "   ", { now: 9 })).toBeNull();
  });
  it("delete, retract, audience", () => {
    expect(noteDeleteUpdate("n1")).toEqual({ [`flags.${P}.notes.-=n1`]: null });
    expect(noteRetractUpdate("n1", { now: 4 })).toEqual({ [`flags.${P}.notes.n1.retracted`]: 4 });
    expect(noteAudienceUpdate("n1", { users: ["u1", "u2"] })).toEqual({ [`flags.${P}.notes.n1.audience`]: { users: ["u1", "u2"], groups: [], all: false } });
    expect(noteAudienceUpdate("n1", null)).toEqual({ [`flags.${P}.notes.n1.audience`]: null });
  });
  it("ref is persisted and read back untouched (Plan C)", () => {
    const ref = { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "secret-1" };
    const { update } = noteCreateUpdate({ id: "n3", text: "t", authorId: "gm", at: 1, kind: "reveal", audience: { groups: ["g1"] }, ref });
    expect(update[`flags.${P}.notes.n3`].ref).toEqual(ref);
    expect(normalizeNotes({ n3: update[`flags.${P}.notes.n3`] })[0].ref).toEqual(ref);
  });
});

describe("canEditNote", () => {
  const note = normalizeNotes({ n: { text: "t", authorId: "u1", at: 1 } })[0];
  it("author and GM only", () => {
    expect(canEditNote(note, u1)).toBe(true);
    expect(canEditNote(note, gm)).toBe(true);
    expect(canEditNote(note, u2)).toBe(false);
  });
});

describe("visibleNotes (Review Focus 2)", () => {
  const notes = normalizeNotes({
    open: { text: "a", authorId: "u2", at: 1 },
    grp: { text: "b", authorId: "gm", at: 2, kind: "reveal", audience: { groups: ["g1"] } },
    usr: { text: "c", authorId: "gm", at: 3, kind: "reveal", audience: { users: ["u2"] } },
    gone: { text: "d", authorId: "gm", at: 4, kind: "reveal", audience: { all: true }, retracted: 5 }
  });
  it("GM sees everything including retracted", () => {
    expect(visibleNotes(notes, gm, groups).map((n) => n.id)).toEqual(["open", "grp", "usr", "gone"]);
  });
  it("a group member sees the group note, not the other user's", () => {
    expect(visibleNotes(notes, u1, groups).map((n) => n.id)).toEqual(["open", "grp"]);
  });
  it("a non-member sees only open and their own audience; retracted never", () => {
    expect(visibleNotes(notes, u2, groups).map((n) => n.id)).toEqual(["open", "usr"]);
  });
});

describe("selectors", () => {
  const notes = normalizeNotes({
    a: { text: "a", authorId: "u1", at: 1, sessionUuid: S1, mentions: [E1] },
    b: { text: "b", authorId: "u1", at: 2, sessionUuid: null, mentions: [E1, E2] },
    c: { text: "c", authorId: "u1", at: 3, sessionUuid: "JournalEntry.s2.JournalEntryPage.p2" }
  });
  it("by session, by mention, held", () => {
    expect(notesForSession(notes, S1).map((n) => n.id)).toEqual(["a"]);
    expect(notesMentioning(notes, E2).map((n) => n.id)).toEqual(["b"]);
    expect(heldNotes(notes).map((n) => n.id)).toEqual(["b"]);
  });
  it("counts per session, skipping held", () => {
    const m = noteCountsBySession(notes);
    expect(m.get(S1)).toBe(1);
    expect(m.get("JournalEntry.s2.JournalEntryPage.p2")).toBe(1);
    expect(m.has(null)).toBe(false);
  });
});
