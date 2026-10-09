import { describe, it, expect } from "vitest";
import {
  LABEL_MAX, SECRET_MAX, cleanText, normalizeConnections, canSeeConnection, visibleNote, sideView, countOtherNotes
} from "../scripts/logic/player-connections.mjs";

const note = (over = {}) => ({ authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1, ...over });
const raw = (over = {}) => ({
  id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 5,
  sides: { from: { notes: { u1: note({ secret: "owes her a debt" }) } }, to: { notes: { u1: note({ label: "Brother of" }) } } },
  ...over
});

describe("cleanText", () => {
  it("trims, accepts empty and nullish, rejects non-strings and overlong text", () => {
    expect(cleanText("  Sister of ", LABEL_MAX)).toBe("Sister of");
    expect(cleanText(undefined, LABEL_MAX)).toBe("");
    expect(cleanText(null, LABEL_MAX)).toBe("");
    expect(cleanText(42, LABEL_MAX)).toBeNull();
    expect(cleanText("x".repeat(LABEL_MAX), LABEL_MAX)).toBe("x".repeat(LABEL_MAX));
    expect(cleanText(` ${"x".repeat(LABEL_MAX + 1)} `, LABEL_MAX)).toBeNull();
    expect(cleanText("y".repeat(SECRET_MAX + 1), SECRET_MAX)).toBeNull();
  });
});

describe("normalizeConnections (spec §2 defensive parse)", () => {
  it("returns [] for an absent or non-object flag", () => {
    expect(normalizeConnections(undefined)).toEqual([]);
    expect(normalizeConnections(null)).toEqual([]);
    expect(normalizeConnections("x")).toEqual([]);
    expect(normalizeConnections([raw()])).toEqual([]);
  });
  it("parses a well-formed row and stamps the from uuid", () => {
    const [row] = normalizeConnections({ c1: raw() }, "JournalEntry.ilva");
    expect(row).toEqual({
      id: "c1", from: "JournalEntry.ilva", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana",
      shared: true, created: 5,
      sides: {
        from: { notes: { u1: { authorName: "Dana", label: "Sister of", secret: "owes her a debt", revealed: false, updated: 1 } } },
        to: { notes: { u1: { authorName: "Dana", label: "Brother of", secret: "", revealed: false, updated: 1 } } }
      }
    });
  });
  it("skips rows without a string id/to, rows whose id differs from their key, and non-object rows", () => {
    const rows = normalizeConnections({
      a: raw({ id: "a", to: 7 }), b: raw({ id: undefined }), c: raw({ id: "other" }), d: "junk", e: null,
      f: raw({ id: "f" })
    }, "X");
    expect(rows.map((r) => r.id)).toEqual(["f"]);
  });
  it("defaults shared to true unless strictly false, revealed to false unless strictly true", () => {
    const rows = normalizeConnections({
      a: raw({ id: "a", shared: undefined }), b: raw({ id: "b", shared: "no" }), c: raw({ id: "c", shared: false }),
      d: raw({ id: "d", sides: { from: { notes: { u1: note({ revealed: "yes" }), u2: note({ revealed: true }) } } } })
    });
    expect(rows.map((r) => r.shared)).toEqual([true, true, false, true]);
    expect(rows[3].sides.from.notes.u1.revealed).toBe(false);
    expect(rows[3].sides.from.notes.u2.revealed).toBe(true);
  });
  it("coerces label/secret/authorName to strings, skips non-object notes, tolerates missing sides", () => {
    const [row] = normalizeConnections({
      c1: raw({ authorName: 9, sides: { from: { notes: { u1: { label: 12, secret: null, authorName: undefined }, u2: "junk", u3: [1] } } } })
    });
    expect(row.authorName).toBe("9");
    expect(row.sides.from.notes).toEqual({ u1: { authorName: "", label: "12", secret: "", revealed: false, updated: 0 } });
    expect(row.sides.to.notes).toEqual({});
  });
});

describe("canSeeConnection (spec §3)", () => {
  const [shared] = normalizeConnections({ c1: raw() }, "JournalEntry.ilva");
  const [priv] = normalizeConnections({ c1: raw({ shared: false }) }, "JournalEntry.ilva");
  const all = () => true;
  it("GM sees everything, including unresolved targets", () => {
    expect(canSeeConnection(priv, { userId: "gm", isGM: true, canSeeEntry: () => false })).toBe(true);
  });
  it("author sees their private connection; others don't", () => {
    expect(canSeeConnection(priv, { userId: "u1", isGM: false, canSeeEntry: all })).toBe(true);
    expect(canSeeConnection(priv, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(false);
  });
  it("shared connections are party-visible", () => {
    expect(canSeeConnection(shared, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(true);
  });
  it("needs LIMITED+ on both endpoints; an unresolved target hides the row from players", () => {
    const only = (uuid) => (u) => u === uuid;
    expect(canSeeConnection(shared, { userId: "u2", isGM: false, canSeeEntry: only("JournalEntry.ilva") })).toBe(false);
    expect(canSeeConnection(shared, { userId: "u1", isGM: false, canSeeEntry: only("JournalEntry.mara") })).toBe(false);
  });
  it("a foreign author's private connection is GM-only; a shared one stays visible", () => {
    const [foreignPriv] = normalizeConnections({ c1: raw({ authorId: "ghost", shared: false }) }, "JournalEntry.ilva");
    const [foreignShared] = normalizeConnections({ c1: raw({ authorId: "ghost" }) }, "JournalEntry.ilva");
    expect(canSeeConnection(foreignPriv, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(false);
    expect(canSeeConnection(foreignShared, { userId: "u2", isGM: false, canSeeEntry: all })).toBe(true);
  });
  it("a row with no from uuid is hidden from players", () => {
    const [row] = normalizeConnections({ c1: raw() });
    expect(canSeeConnection(row, { userId: "u2", isGM: false, canSeeEntry: (u) => typeof u === "string" })).toBe(false);
  });
});

describe("visibleNote (spec §3 secrets)", () => {
  const n = note({ secret: "owes her a debt" });
  it("writer and GM see the secret; others only once revealed", () => {
    expect(visibleNote(n, "u1", { userId: "u1", isGM: false })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
    expect(visibleNote(n, "u1", { userId: "gm", isGM: true })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
    expect(visibleNote(n, "u1", { userId: "u2", isGM: false })).toMatchObject({ secretVisible: false, secret: "" });
    expect(visibleNote({ ...n, revealed: true }, "u1", { userId: "u2", isGM: false })).toMatchObject({ secretVisible: true, secret: "owes her a debt" });
  });
  it("labels are always visible", () => {
    expect(visibleNote(n, "u1", { userId: "u2", isGM: false }).label).toBe("Sister of");
  });
});

describe("sideView (spec §3, §4.5)", () => {
  const known = new Set(["u1", "u2", "gm"]);
  const rowWith = (over = {}) => normalizeConnections({ c1: raw({
    sides: {
      from: { notes: { u1: note({ secret: "debt" }), u2: note({ authorName: "Jo", label: "half-sister", secret: "jealous" }) } },
      to: { notes: { u1: note({ label: "Brother of" }) } }
    }, ...over }) }, "JournalEntry.ilva")[0];
  const viewer = (over = {}) => ({ userId: "u1", isGM: false, enabled: true, knownUserIds: known, canObserveSide: true, ...over });

  it("the author's note is the main label; others list beneath, attributed", () => {
    const v = sideView(rowWith(), "from", viewer());
    expect(v.main).toMatchObject({ writerId: "u1", label: "Sister of", secret: "debt", editable: true, canReveal: true });
    expect(v.others).toEqual([expect.objectContaining({ writerId: "u2", authorName: "Jo", label: "half-sister", secret: "", editable: false, canDelete: false })]);
    expect(v).toMatchObject({ otherUuid: "JournalEntry.mara", reverse: false, isAuthor: true, showAuthor: false, viewerId: "u1", canToggleShare: true, canDelete: true, canAddNote: false });
  });
  it("the reverse side points back at the from entry and shows the author to others", () => {
    const v = sideView(rowWith(), "to", viewer({ userId: "u2" }));
    expect(v).toMatchObject({ otherUuid: "JournalEntry.ilva", reverse: true, showAuthor: true, isAuthor: false, canToggleShare: false, canDelete: false, canAddNote: true });
    expect(v.main).toMatchObject({ label: "Brother of", editable: false });
  });
  it("GM: author shown, every note deletable, nothing editable that isn't theirs", () => {
    const v = sideView(rowWith(), "from", viewer({ userId: "gm", isGM: true }));
    expect(v.showAuthor).toBe(true);
    expect(v.canDelete).toBe(true);
    expect(v.others[0]).toMatchObject({ canDelete: true, editable: false, secret: "jealous" });
  });
  it("setting off: nothing editable, no Add a note, writers can still delete their own note", () => {
    const v = sideView(rowWith(), "from", viewer({ userId: "u2", enabled: false }));
    expect(v.canAddNote).toBe(false);
    expect(v.others[0]).toMatchObject({ editable: false, canReveal: false, canDelete: true });
  });
  it("Add a note needs OBSERVER on this side and, on a private connection, authorship", () => {
    expect(sideView(rowWith(), "to", viewer({ userId: "u2", canObserveSide: false })).canAddNote).toBe(false);
    expect(sideView(rowWith({ shared: false }), "to", viewer({ userId: "u2" })).canAddNote).toBe(false);
    expect(sideView(rowWith({ shared: false }), "to", viewer({ userId: "gm", isGM: true })).canAddNote).toBe(true);
  });
  it("a foreign writer's note is never editable", () => {
    const row = rowWith({ sides: { from: { notes: { ghost: note({ authorName: "Old Friend" }) } } } });
    const v = sideView(row, "from", viewer({ userId: "ghost", knownUserIds: known }));
    expect(v.others[0].editable).toBe(false);
  });
  it("no main note when the author wrote none on this side", () => {
    const row = rowWith({ sides: { from: { notes: { u1: note() } }, to: { notes: {} } } });
    expect(sideView(row, "to", viewer()).main).toBeNull();
    expect(sideView(row, "to", viewer()).canAddNote).toBe(true);
  });
});

describe("countOtherNotes", () => {
  it("counts notes on both sides not written by the connection author", () => {
    const [row] = normalizeConnections({ c1: raw({ sides: {
      from: { notes: { u1: note(), u2: note() } }, to: { notes: { u1: note(), u3: note(), u2: note() } }
    } }) });
    expect(countOtherNotes(row)).toBe(3);
  });
});
