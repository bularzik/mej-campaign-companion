import { describe, it, expect } from "vitest";
import { normalizeConnections, validateRequest, connectionUpdate, OPS } from "../scripts/logic/player-connections.mjs";

const BASE = "flags.mej-campaign-companion.playerConnections";
const note = (over = {}) => ({ authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1, ...over });
const conn = (over = {}) => ({
  id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 1,
  sides: { from: { notes: { u1: note({ secret: "debt" }) } }, to: { notes: { u2: note({ authorName: "Jo", label: "half-sister" }) } } },
  ...over
});
const rows = (flag) => normalizeConnections(flag, "JournalEntry.ilva");
const TYPES = { "JournalEntry.mara": "person", "JournalEntry.ilva": "person", "JournalEntry.ledger": "list" };
const ctx = (over = {}) => ({
  sender: { id: "u1", isGM: false },
  enabled: true,
  source: { uuid: "JournalEntry.ilva", typed: true, locked: false, allowed: ["person", "place"] },
  typeOf: (uuid) => TYPES[uuid] ?? null,
  canAccess: () => true,
  connections: rows({ c1: conn() }),
  ...over
});
const add = (payload = {}) => ({ fromUuid: "JournalEntry.ilva", payload: {
  to: "JournalEntry.bren", shared: true, fromNote: { label: "Owes money to", secret: "" }, ...payload } });
const on = (connectionId = "c1", side = "from", payload = {}) => ({ fromUuid: "JournalEntry.ilva", connectionId, side, payload });
const withBren = (over = {}) => ctx({ typeOf: (u) => ({ ...TYPES, "JournalEntry.bren": "person" })[u] ?? null, ...over });

describe("validateRequest - shared gates (spec §5)", () => {
  it("rejects an unknown op", () => {
    expect(validateRequest("rename", on(), ctx())).toEqual({ ok: false, reason: "bad-request" });
    expect(OPS).toEqual(["add", "setShared", "delete", "setNote", "deleteNote", "setRevealed"]);
  });
  it("no-entry when the source doesn't resolve to a MEJ-typed page, for every op", () => {
    for (const op of OPS) {
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: null }))).toEqual({ ok: false, reason: "no-entry" });
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: { uuid: "x", typed: false, locked: false, allowed: [] } })))
        .toEqual({ ok: false, reason: "no-entry" });
    }
  });
  it("locked compendium, for every op", () => {
    for (const op of OPS) {
      expect(validateRequest(op, op === "add" ? add() : on(), ctx({ source: { uuid: "JournalEntry.ilva", typed: true, locked: true, allowed: ["person"] } })))
        .toEqual({ ok: false, reason: "locked" });
    }
  });
});

describe("validateRequest - add", () => {
  it("accepts a valid request", () => {
    expect(validateRequest("add", add(), withBren())).toEqual({ ok: true });
  });
  it("disabled when the setting is off", () => {
    expect(validateRequest("add", add(), withBren({ enabled: false }))).toEqual({ ok: false, reason: "disabled" });
  });
  it("self", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.ilva" }), ctx())).toEqual({ ok: false, reason: "self" });
  });
  it("no-access: no OBSERVER on the source, no LIMITED on the target, or an unknown target", () => {
    const deny = (uuid, level) => (u, l) => !(u === uuid && l === level);
    expect(validateRequest("add", add(), withBren({ canAccess: deny("JournalEntry.ilva", "OBSERVER") }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("add", add(), withBren({ canAccess: deny("JournalEntry.bren", "LIMITED") }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("add", add({ to: "JournalEntry.nowhere" }), ctx())).toEqual({ ok: false, reason: "no-access" });
  });
  it("type-not-allowed", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.ledger" }), ctx())).toEqual({ ok: false, reason: "type-not-allowed" });
  });
  it("duplicate: this author already connected source to target; another author may", () => {
    expect(validateRequest("add", add({ to: "JournalEntry.mara" }), ctx())).toEqual({ ok: false, reason: "duplicate" });
    expect(validateRequest("add", add({ to: "JournalEntry.mara" }), ctx({ sender: { id: "u2", isGM: false } }))).toEqual({ ok: true });
  });
  it("bad-label: empty, non-string or overlong from label; overlong secret; overlong to label", () => {
    for (const payload of [
      { fromNote: { label: "   " } }, { fromNote: { label: 5 } }, { fromNote: { label: "x".repeat(201) } },
      { fromNote: { label: "ok", secret: "s".repeat(501) } }, { toNote: { label: "x".repeat(201) } }, { fromNote: null }
    ]) {
      expect(validateRequest("add", add(payload), withBren())).toEqual({ ok: false, reason: "bad-label" });
    }
  });
  it("bad-request when `to` is missing", () => {
    expect(validateRequest("add", { fromUuid: "JournalEntry.ilva", payload: { fromNote: { label: "x" } } }, ctx()))
      .toEqual({ ok: false, reason: "bad-request" });
  });
});

describe("validateRequest - connection ops", () => {
  const u2 = { sender: { id: "u2", isGM: false } };
  const gm = { sender: { id: "gm", isGM: true } };
  it("setShared: author only (the GM is not excepted); gone when missing", () => {
    expect(validateRequest("setShared", on(), ctx())).toEqual({ ok: true });
    expect(validateRequest("setShared", on(), ctx(u2))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("setShared", on(), ctx(gm))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("setShared", on("nope"), ctx())).toEqual({ ok: false, reason: "gone" });
  });
  it("delete: author or GM; a missing connection is a no-op success", () => {
    expect(validateRequest("delete", on(), ctx())).toEqual({ ok: true });
    expect(validateRequest("delete", on(), ctx(gm))).toEqual({ ok: true });
    expect(validateRequest("delete", on(), ctx(u2))).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("delete", on("nope"), ctx(u2))).toEqual({ ok: true, noop: true });
  });
  it("setNote: disabled, gone, bad side, invisible, no OBSERVER on that side, bad label", () => {
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx(u2))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, enabled: false }))).toEqual({ ok: false, reason: "disabled" });
    expect(validateRequest("setNote", on("nope", "to", { label: "x" }), ctx(u2))).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("setNote", on("c1", "middle", { label: "x" }), ctx(u2))).toEqual({ ok: false, reason: "bad-request" });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, connections: rows({ c1: conn({ shared: false }) }) })))
      .toEqual({ ok: false, reason: "no-access" });
    const noObserveMara = (u, l) => !(u === "JournalEntry.mara" && l === "OBSERVER");
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...u2, canAccess: noObserveMara }))).toEqual({ ok: false, reason: "no-access" });
    expect(validateRequest("setNote", on("c1", "from", { label: "x" }), ctx({ ...u2, canAccess: noObserveMara }))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x".repeat(201) }), ctx(u2))).toEqual({ ok: false, reason: "bad-label" });
    expect(validateRequest("setNote", on("c1", "to", { label: "", secret: "s".repeat(501) }), ctx(u2))).toEqual({ ok: false, reason: "bad-label" });
    expect(validateRequest("setNote", on("c1", "to", { label: "", secret: "" }), ctx(u2))).toEqual({ ok: true });
  });
  it("setNote on a private connection: only the author or the GM", () => {
    const priv = { connections: rows({ c1: conn({ shared: false }) }) };
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx(priv))).toEqual({ ok: true });
    expect(validateRequest("setNote", on("c1", "to", { label: "x" }), ctx({ ...priv, ...gm }))).toEqual({ ok: true });
  });
  it("deleteNote: writer or GM; missing note or connection is a no-op success; setting off doesn't block it", () => {
    expect(validateRequest("deleteNote", on("c1", "to"), ctx({ ...u2, enabled: false }))).toEqual({ ok: true });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "u2" }), ctx())).toEqual({ ok: false, reason: "not-author" });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "u2" }), ctx(gm))).toEqual({ ok: true });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "nobody" }), ctx(gm))).toEqual({ ok: true, noop: true });
    expect(validateRequest("deleteNote", on("c1", "to", { noteUserId: "constructor" }), ctx(gm))).toEqual({ ok: true, noop: true });
    expect(validateRequest("deleteNote", on("nope", "to"), ctx(u2))).toEqual({ ok: true, noop: true });
  });
  it("setRevealed: own note only (gone otherwise), disabled when off", () => {
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx())).toEqual({ ok: true });
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx(u2))).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("setRevealed", on("c1", "from", { revealed: true }), ctx({ enabled: false }))).toEqual({ ok: false, reason: "disabled" });
  });
  it("a forged connectionId that would walk the flag path never matches a row", () => {
    expect(validateRequest("setShared", on("c1.sides"), ctx())).toEqual({ ok: false, reason: "gone" });
    expect(validateRequest("delete", on("-=c1"), ctx())).toEqual({ ok: true, noop: true });
  });
});

describe("connectionUpdate (spec §5 keyed paths)", () => {
  const opts = { senderId: "u1", senderName: "Dana", now: 99, newId: "n1", connections: rows({ c1: conn() }) };
  it("add writes one keyed connection with the author's notes", () => {
    expect(connectionUpdate("add", add({ to: "JournalEntry.bren", fromNote: { label: " Owes money to ", secret: " x " }, toNote: { label: "Lender to" } }), opts)).toEqual({
      [`${BASE}.n1`]: {
        id: "n1", to: "JournalEntry.bren", authorId: "u1", authorName: "Dana", shared: true, created: 99,
        sides: {
          from: { notes: { u1: { authorName: "Dana", label: "Owes money to", secret: "x", revealed: false, updated: 99 } } },
          to: { notes: { u1: { authorName: "Dana", label: "Lender to", secret: "", revealed: false, updated: 99 } } }
        }
      }
    });
  });
  it("add without a to-side note stores an empty notes map; shared:false sticks", () => {
    const data = connectionUpdate("add", add({ shared: false, toNote: { label: "", secret: "" } }), opts);
    expect(data[`${BASE}.n1`].sides.to).toEqual({ notes: {} });
    expect(data[`${BASE}.n1`].shared).toBe(false);
  });
  it("setShared, delete, setRevealed", () => {
    expect(connectionUpdate("setShared", on("c1", "from", { shared: false }), opts)).toEqual({ [`${BASE}.c1.shared`]: false });
    expect(connectionUpdate("delete", on("c1"), opts)).toEqual({ [`${BASE}.-=c1`]: null });
    expect(connectionUpdate("setRevealed", on("c1", "from", { revealed: true }), opts)).toEqual({ [`${BASE}.c1.sides.from.notes.u1.revealed`]: true });
  });
  it("setNote writes the sender's note, keeps revealed while a secret remains", () => {
    const revealedRows = rows({ c1: conn({ sides: { from: { notes: { u1: note({ secret: "debt", revealed: true }) } } } }) });
    expect(connectionUpdate("setNote", on("c1", "from", { label: " Sister of ", secret: "new debt" }), { ...opts, connections: revealedRows }))
      .toEqual({ [`${BASE}.c1.sides.from.notes.u1`]: { authorName: "Dana", label: "Sister of", secret: "new debt", revealed: true, updated: 99 } });
    expect(connectionUpdate("setNote", on("c1", "from", { label: "Sister of", secret: "" }), { ...opts, connections: revealedRows }))
      .toEqual({ [`${BASE}.c1.sides.from.notes.u1`]: { authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 99 } });
  });
  it("setNote with both fields empty deletes the note instead", () => {
    expect(connectionUpdate("setNote", on("c1", "to", { label: " ", secret: "" }), opts)).toEqual({ [`${BASE}.c1.sides.to.notes.-=u1`]: null });
  });
  it("deleteNote targets the named writer (GM) or the sender", () => {
    expect(connectionUpdate("deleteNote", on("c1", "to", { noteUserId: "u2" }), { ...opts, senderId: "gm" })).toEqual({ [`${BASE}.c1.sides.to.notes.-=u2`]: null });
    expect(connectionUpdate("deleteNote", on("c1", "from"), opts)).toEqual({ [`${BASE}.c1.sides.from.notes.-=u1`]: null });
  });
});
