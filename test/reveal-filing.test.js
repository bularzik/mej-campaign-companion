import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  store: {
    ensureNotesEntry: null, addNote: null, updateNote: null, retractNote: null
  },
  session: { value: { uuid: "JournalEntry.s1.JournalEntryPage.sp", startedAt: 1 } },
  campaign: { value: { id: "camp" } }
}));

vi.mock("../scripts/data/notes-store.mjs", () => ({
  ensureNotesEntry: (...a) => h.store.ensureNotesEntry(...a),
  addNote: (...a) => h.store.addNote(...a),
  updateNote: (...a) => h.store.updateNote(...a),
  retractNote: (...a) => h.store.retractNote(...a)
}));
vi.mock("../scripts/logic/current-session.mjs", () => ({ currentSession: () => h.session.value }));
vi.mock("../scripts/logic/campaigns.mjs", () => ({ campaignOf: () => h.campaign.value }));

const { fileRevealChange, fileMediaNote } = await import("../scripts/hooks/reveal-filing.mjs");

const MOD = "mej-campaign-companion";
const gone = (reason) => Object.assign(new Error(reason), { reason });

/** A fake document whose update() applies flat flag paths (incl. "-=key") to its revealNotes map. */
function fakeTarget(initial = {}) {
  const notes = { ...initial };
  return {
    documentName: "JournalEntryPage",
    uuid: "JournalEntry.e1.JournalEntryPage.p1",
    notes,
    getFlag: (mod, key) => (mod === MOD && key === "revealNotes" ? notes : undefined),
    update: vi.fn(async (u) => {
      for (const [path, v] of Object.entries(u)) {
        const k = path.split(".revealNotes.")[1];
        if (k.startsWith("-=")) delete notes[k.slice(2)];
        else notes[k] = v;
      }
    })
  };
}

const entry = { uuid: "JournalEntry.e1", name: "The Missing Caravan" };
const none = { users: [], groups: [], all: false };
const u1 = { users: ["u1"], groups: [], all: false };
const u12 = { users: ["u1", "u2"], groups: [], all: false };
const args = (target, previous, audience) => ({ entry, target, kind: "block", id: "secret-1", previous, audience, label: "Revealed a secret from The Missing Caravan" });

beforeEach(() => {
  globalThis.game = { user: { id: "gm", isGM: true }, i18n: { format: (k, d) => `${k}:${d.name}` } };
  h.store.ensureNotesEntry = vi.fn(async () => ({}));
  h.store.addNote = vi.fn(async () => ({ id: "n1" }));
  h.store.updateNote = vi.fn(async () => {});
  h.store.retractNote = vi.fn(async () => {});
  h.session.value = { uuid: "JournalEntry.s1.JournalEntryPage.sp", startedAt: 1 };
  h.campaign.value = { id: "camp" };
});

describe("fileRevealChange (Review Focus 4, glue)", () => {
  it("first reveal files one note with an explicit audience and records its key", async () => {
    const t = fakeTarget();
    await fileRevealChange(args(t, none, u1));
    expect(h.store.ensureNotesEntry).toHaveBeenCalledBefore(h.store.addNote);
    expect(h.store.addNote).toHaveBeenCalledTimes(1);
    const [camp, payload] = h.store.addNote.mock.calls[0];
    expect(camp).toEqual({ id: "camp" });
    expect(payload).toMatchObject({ kind: "reveal", audience: { users: ["u1"], groups: [] }, sessionUuid: "JournalEntry.s1.JournalEntryPage.sp", mentions: ["JournalEntry.e1"] });
    expect(payload.ref).toEqual({ pageUuid: "JournalEntry.e1.JournalEntryPage.p1", blockId: "secret-1", kind: "block" });
    expect(t.notes).toEqual({ "block-secret-1": "n1" });
  });

  it("widening the audience updates the filed note's audience and files nothing new", async () => {
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, u1, u12));
    expect(h.store.addNote).not.toHaveBeenCalled();
    expect(h.store.updateNote).toHaveBeenCalledWith({ id: "camp" }, "n1", { audience: { users: ["u1", "u2"], groups: [] } });
    expect(t.notes).toEqual({ "block-secret-1": "n1" });
  });

  it("widening to Everyone sets the note audience to null", async () => {
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, u1, { users: [], groups: [], all: true }));
    expect(h.store.updateNote).toHaveBeenCalledWith({ id: "camp" }, "n1", { audience: null });
  });

  it("un-reveal retracts exactly the recorded note and clears the key", async () => {
    const t = fakeTarget({ "block-secret-1": "n1", "block-other": "n9" });
    await fileRevealChange(args(t, u1, none));
    expect(h.store.retractNote).toHaveBeenCalledTimes(1);
    expect(h.store.retractNote).toHaveBeenCalledWith({ id: "camp" }, "n1");
    expect(t.notes).toEqual({ "block-other": "n9" });
  });

  it("a notFound on retract still clears the stale key", async () => {
    h.store.retractNote = vi.fn(async () => { throw gone("notFound"); });
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, u1, none));
    expect(t.notes).toEqual({});
  });

  it("a notFound on update clears the stale key so a later reveal can file again", async () => {
    h.store.updateNote = vi.fn(async () => { throw gone("notFound"); });
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, u1, u12));
    expect(t.notes).toEqual({});
  });

  it("any other store error keeps the key and never throws to the reveal", async () => {
    h.store.retractNote = vi.fn(async () => { throw gone("noAccess"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = fakeTarget({ "block-secret-1": "n1" });
    await expect(fileRevealChange(args(t, u1, none))).resolves.toBeUndefined();
    expect(t.notes).toEqual({ "block-secret-1": "n1" });
    err.mockRestore();
  });

  it("no open session files nothing", async () => {
    h.session.value = null;
    const t = fakeTarget();
    await fileRevealChange(args(t, none, u1));
    expect(h.store.addNote).not.toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
  });

  it("a reveal over a leftover id retracts the orphan before filing the new note", async () => {
    h.store.addNote = vi.fn(async () => ({ id: "n2" }));
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, none, u1));
    expect(h.store.retractNote).toHaveBeenCalledWith({ id: "camp" }, "n1");
    expect(h.store.retractNote).toHaveBeenCalledBefore(h.store.addNote);
    expect(t.notes).toEqual({ "block-secret-1": "n2" });
  });

  it("a leftover id that is already gone does not block the new note", async () => {
    h.store.retractNote = vi.fn(async () => { throw gone("notFound"); });
    h.store.addNote = vi.fn(async () => ({ id: "n2" }));
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, none, u1));
    expect(h.store.addNote).toHaveBeenCalledTimes(1);
    expect(t.notes).toEqual({ "block-secret-1": "n2" });
  });

  it("a reveal over a leftover id with no open session retracts the orphan and clears the key", async () => {
    h.session.value = null;
    const t = fakeTarget({ "block-secret-1": "n1" });
    await fileRevealChange(args(t, none, u1));
    expect(h.store.retractNote).toHaveBeenCalledWith({ id: "camp" }, "n1");
    expect(h.store.addNote).not.toHaveBeenCalled();
    expect(t.notes).toEqual({});
  });

  it("same audience, a player caller, or no campaign does nothing", async () => {
    const t = fakeTarget();
    await fileRevealChange(args(t, u1, { users: ["u1"] }));
    h.campaign.value = null;
    await fileRevealChange(args(t, none, u1));
    h.campaign.value = { id: "camp" };
    game.user.isGM = false;
    await fileRevealChange(args(t, none, u1));
    expect(h.store.addNote).not.toHaveBeenCalled();
    expect(h.store.retractNote).not.toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
  });
});

describe("fileMediaNote", () => {
  it("a share to every player files a note readable by everyone", async () => {
    await fileMediaNote({ campaign: { id: "camp" }, src: "maps/a.png", name: "a.png", users: [] });
    expect(h.store.ensureNotesEntry).toHaveBeenCalledBefore(h.store.addNote);
    expect(h.store.addNote.mock.calls[0][1]).toMatchObject({ kind: "reveal", audience: null, ref: { src: "maps/a.png", kind: "media" } });
  });
  it("a share to selected players files a note only they can read", async () => {
    await fileMediaNote({ campaign: { id: "camp" }, src: "maps/a.png", name: "a.png", users: ["u1", "u2"] });
    expect(h.store.addNote.mock.calls[0][1].audience).toEqual({ users: ["u1", "u2"], groups: [] });
  });
  it("escapes the shown name", async () => {
    await fileMediaNote({ campaign: { id: "camp" }, src: "x.png", name: "<b>@UUID[x]</b>" });
    const text = h.store.addNote.mock.calls[0][1].text;
    expect(text).not.toMatch(/[<>]|@UUID\[/);
  });
  it("no open session files nothing", async () => {
    h.session.value = null;
    await fileMediaNote({ campaign: { id: "camp" }, src: "maps/a.png", name: "a.png", users: ["u1"] });
    expect(h.store.addNote).not.toHaveBeenCalled();
  });
});
