import { describe, it, expect, beforeEach } from "vitest";
import { addNote, updateNote, readNotes, listNotes, NotesStoreError } from "../scripts/data/notes-store.mjs";

const P = "mej-campaign-companion";
const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function fakeWorld({ isGM = false, userId = "u1" } = {}) {
  const entry = {
    flags: { [P]: { notesEntry: true, notes: {} } },
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
  const folder = { id: "c1", name: "Vale", flags: { [P]: { campaign: { ownershipDefault: "observer" } } }, contents: [entry] };
  globalThis.game = {
    user: { id: userId, name: "Jo", isGM },
    users: { contents: [], filter: () => [] },
    folders: { get: (id) => (id === "c1" ? folder : null) },
    settings: { get: () => [] }
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: LEVELS };
  globalThis.foundry = { utils: { randomID: () => "n1" } };
  return { folder, entry };
}

describe("notes store (Plan C guarantees)", () => {
  beforeEach(() => fakeWorld());

  it("addNote resolves to the created note carrying .id, by Folder or by id, and keeps ref untouched", async () => {
    const ref = { pageUuid: "JournalEntry.a.JournalEntryPage.b", blockId: "s1" };
    const note = await addNote("c1", { text: "hello", kind: "gm", ref });
    expect(note.id).toBe("n1");
    expect(note.ref).toEqual(ref);
    expect(readNotes(game.folders.get("c1"))[0]).toEqual(note);
  });

  it("updateNote with an audience-only patch needs a GM and leaves text alone", async () => {
    await addNote("c1", { text: "t", kind: "reveal", audience: { users: ["u2"] } });
    await expect(updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } })).rejects.toMatchObject({ reason: "noAccess" });
    fakeWorld({ isGM: true, userId: "gm" });
    await addNote("c1", { text: "t", kind: "reveal", audience: { users: ["u2"] } });
    await updateNote("c1", "n1", { audience: { users: ["u2", "u3"] } });
    const [n] = readNotes("c1");
    expect(n.audience).toEqual({ users: ["u2", "u3"], groups: [], all: false });
    expect(n.text).toBe("t");
    expect(n.editedAt).toBeNull();
  });

  it("text patch by a non-author fails; listNotes hides an audienced note from outsiders", async () => {
    await addNote("c1", { text: "mine", authorId: "u9", audience: { users: ["u9"] } });
    await expect(updateNote("c1", "n1", { text: "x" })).rejects.toMatchObject({ reason: "noAccess" });
    expect(listNotes("c1")).toEqual([]);
    expect(() => new NotesStoreError("noEntry").reason).not.toThrow();
  });
});
