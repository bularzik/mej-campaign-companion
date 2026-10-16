import { describe, it, expect, beforeEach, vi } from "vitest";
import { addNote, updateNote, readNotes, listNotes, NotesStoreError } from "../scripts/data/notes-store.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const NOTE_KEYS = ["at", "audience", "authorId", "authorName", "editedAt", "kind", "mentions", "ref", "retracted", "sessionUuid", "text", "worldDate"];

function fakeWorld({ isGM = false, userId = "u1", withEntry = true, notes = {} } = {}) {
  const entry = {
    flags: { [P]: { notesEntry: true, notes } },
    ownership: { default: 0, u1: 3 },
    isOwner: true,
    testUserPermission: () => true,
    async update(update) {
      // Minimal Foundry merge: "a.b.c" paths and "-=" deletes, enough for the keyed note writes.
      for (const [key, value] of Object.entries(update)) {
        const parts = key.split(".");
        let o = this;
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else o[last] = value;
      }
    }
  };
  const spy = vi.spyOn(entry, "update");
  const folder = { id: "c1", name: "Vale", flags: { [P]: { campaign: { ownershipDefault: "observer" } } }, contents: withEntry ? [entry] : [] };
  globalThis.game = {
    user: { id: userId, name: "Jo", isGM },
    users: { contents: [], filter: () => [] },
    folders: { get: (id) => (id === "c1" ? folder : null) },
    settings: { get: () => [] }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: LEVELS };
  globalThis.foundry = { utils: { randomID: () => "n1" } };
  return { folder, entry, spy };
}

describe("notes store (Plan C guarantees)", () => {
  beforeEach(() => fakeWorld());

  it("addNote resolves to the created note carrying .id, by Folder or by id, and keeps ref untouched", async () => {
    fakeWorld({ isGM: true, userId: "gm" });
    const ref = { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "s1" };
    const note = await addNote("c1", { text: "hello", kind: "gm", ref });
    expect(note.id).toBe("n1");
    expect(note.kind).toBe("gm");
    expect(note.ref).toEqual(ref);
    expect(readNotes(game.folders.get("c1"))[0]).toEqual(note);
  });

  it("updateNote with an audience-only patch needs a GM and leaves text alone", async () => {
    fakeWorld({ isGM: true, userId: "gm" });
    await addNote("c1", { text: "t", kind: "reveal", audience: { users: ["u2"] } });
    game.user.isGM = false;
    await expect(updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } })).rejects.toMatchObject({ reason: "noAccess" });
    game.user.isGM = true;
    await updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } });
    const [n] = readNotes("c1");
    expect(n.audience).toEqual({ users: ["u2", "u3"], groups: [], all: false });
    expect(n.text).toBe("t");
    expect(n.editedAt).toBeNull();
  });

  it("text patch by a non-author fails; listNotes hides an audienced note from outsiders", async () => {
    fakeWorld({ isGM: true, userId: "gm" });
    await addNote("c1", { text: "mine", authorId: "u9", audience: { users: ["u9"] } });
    game.user.isGM = false;
    game.user.id = "u1";
    await expect(updateNote("c1", "n1", { text: "x" })).rejects.toMatchObject({ reason: "noAccess" });
    expect(listNotes("c1")).toEqual([]);
  });
});

describe("addNote writes (Review Focus 1)", () => {
  it("makes one update with exactly one note key and keeps another author's note", async () => {
    const other = { text: "theirs", authorId: "u2", authorName: "Al", at: 1, kind: "player" };
    const { entry, spy } = fakeWorld({ notes: { n0: other } });
    await addNote("c1", { text: "mine" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(spy.mock.calls[0][0])).toEqual([`flags.${P}.notes.n1`]);
    expect(entry.flags[P].notes.n0).toEqual(other);
    expect(readNotes("c1").map((n) => n.id).sort()).toEqual(["n0", "n1"]);
  });
});

describe("addNote errors", () => {
  it("noEntry when the campaign has no notes entry", async () => {
    fakeWorld({ withEntry: false });
    await expect(addNote("c1", { text: "x" })).rejects.toMatchObject({ reason: "noEntry" });
    await expect(addNote("c1", { text: "x" })).rejects.toBeInstanceOf(NotesStoreError);
  });
  it("noAccess when the user does not own the entry", async () => {
    const { entry } = fakeWorld();
    entry.isOwner = false;
    await expect(addNote("c1", { text: "x" })).rejects.toMatchObject({ reason: "noAccess" });
  });
  it("badText for empty, whitespace or overlong text", async () => {
    fakeWorld();
    await expect(addNote("c1", { text: "   " })).rejects.toMatchObject({ reason: "badText" });
    await expect(addNote("c1", { text: "x".repeat(2001) })).rejects.toMatchObject({ reason: "badText" });
  });
});

describe("addNote attribution rules", () => {
  it("a non-GM is forced to a player note by themselves with no audience", async () => {
    fakeWorld({ userId: "u1" });
    const n = await addNote("c1", { text: "x", kind: "reveal", authorId: "gm", authorName: "Boss", audience: { users: ["u2"] } });
    expect(n.kind).toBe("player");
    expect(n.authorId).toBe("u1");
    expect(n.authorName).toBe("Jo");
    expect(n.audience).toBeNull();
  });
  it("a GM may set kind, another author and an audience", async () => {
    fakeWorld({ isGM: true, userId: "gm" });
    const n = await addNote("c1", { text: "x", kind: "reveal", authorId: "u2", authorName: "Al", audience: { users: ["u2"] } });
    expect(n.kind).toBe("reveal");
    expect(n.authorId).toBe("u2");
    expect(n.authorName).toBe("Al");
    expect(n.audience).toEqual({ users: ["u2"], groups: [], all: false });
  });
  it("a reveal note stores only the model fields and never a secret body (R8)", async () => {
    const { entry } = fakeWorld({ isGM: true, userId: "gm" });
    await addNote("c1", {
      text: "Revealed: the vault", kind: "reveal", audience: { users: ["u1"] },
      ref: { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "s1" },
      body: "SECRET", secret: "SECRET", content: "SECRET"
    });
    expect(Object.keys(entry.flags[P].notes.n1).sort()).toEqual(NOTE_KEYS);
    expect(JSON.stringify(entry.flags[P].notes)).not.toContain("SECRET");
  });
});
