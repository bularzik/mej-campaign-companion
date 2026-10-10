import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyConnectionOp, handleConnectionRequest, handleConnectionResult, requestConnectionOp, connectionReasonKey,
  allowedRelationshipsOf
} from "../scripts/hooks/player-connections-relay.mjs";
import { ENTITY_RELAY_TIMEOUT_MS } from "../scripts/constants.mjs";

const BASE = "flags.mej-campaign-companion.playerConnections";
const stored = {
  c1: { id: "c1", to: "JournalEntry.mara", authorId: "u1", authorName: "Dana", shared: true, created: 1,
    sides: { from: { notes: { u1: { authorName: "Dana", label: "Sister of", secret: "", revealed: false, updated: 1 } } }, to: { notes: {} } } }
};

function env(over = {}) {
  const page = { flags: { "mej-campaign-companion": { playerConnections: stored } } };
  return {
    page,
    emitted: [],
    emit(msg) { this.emitted.push(msg); },
    users: new Map([
      ["u1", { id: "u1", name: "Dana", isGM: false }], ["u2", { id: "u2", name: "Jo", isGM: false }],
      ["gm", { id: "gm", name: "Gamemaster", isGM: true }]
    ]),
    knownUserIds: () => new Set(["u1", "u2", "gm"]),
    userId: "u1",
    isGM: false,
    activeGM: () => ({ id: "gm" }),
    randomId: () => "new1",
    now: () => 500,
    enabled: () => true,
    resolveSource: vi.fn(async (uuid) => (uuid === "JournalEntry.ilva"
      ? { uuid, page, typed: true, locked: false, allowed: ["person", "place"] } : null)),
    typeOf: (uuid) => ({ "JournalEntry.mara": "person", "JournalEntry.bren": "person", "JournalEntry.ilva": "person" })[uuid] ?? null,
    canAccess: vi.fn(() => true),
    update: vi.fn(async () => {}),
    ...over
  };
}
const addReq = (to = "JournalEntry.bren") => ({ op: "add", fromUuid: "JournalEntry.ilva",
  payload: { to, shared: true, fromNote: { label: "Owes money to", secret: "" } } });

afterEach(() => vi.useRealTimers());

describe("applyConnectionOp (GM side)", () => {
  it("validates against the socket sender and writes keyed paths", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq(), "u2", e)).toEqual({ ok: true, connectionId: "new1" });
    const [page, data] = e.update.mock.calls[0];
    expect(page).toBe(e.page);
    expect(Object.keys(data)).toEqual([`${BASE}.new1`]);
    expect(data[`${BASE}.new1`]).toMatchObject({ authorId: "u2", authorName: "Jo", to: "JournalEntry.bren" });
    expect(e.canAccess).toHaveBeenCalledWith(e.users.get("u2"), "JournalEntry.ilva", "OBSERVER");
  });
  it("rejects an unknown sender without resolving anything", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq(), "ghost", e)).toEqual({ ok: false, reason: "bad-sender" });
    expect(e.resolveSource).not.toHaveBeenCalled();
    expect(e.update).not.toHaveBeenCalled();
  });
  it("passes a rejection through and writes nothing", async () => {
    const e = env();
    expect(await applyConnectionOp(addReq("JournalEntry.mara"), "u1", e)).toEqual({ ok: false, reason: "duplicate" });
    expect(e.update).not.toHaveBeenCalled();
  });
  it("a no-op success writes nothing", async () => {
    const e = env();
    expect(await applyConnectionOp({ op: "delete", fromUuid: "JournalEntry.ilva", connectionId: "gone" }, "u1", e))
      .toEqual({ ok: true, connectionId: "gone", noop: true });
    expect(e.update).not.toHaveBeenCalled();
  });
  it("no-entry when the source doesn't resolve", async () => {
    expect(await applyConnectionOp({ ...addReq(), fromUuid: "JournalEntry.nope" }, "u1", env())).toEqual({ ok: false, reason: "no-entry" });
  });
  it("a failing write reports failed", async () => {
    const e = env({ update: vi.fn(async () => { throw new Error("boom"); }) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await applyConnectionOp(addReq(), "u1", e)).toEqual({ ok: false, reason: "failed" });
    spy.mockRestore();
  });
});

describe("handleConnectionRequest", () => {
  it("replies to the socket sender, ignoring any payload user id", async () => {
    const e = env();
    await handleConnectionRequest({ action: "player-connection", requestId: "r1", userId: "u1", ...addReq() }, "u2", e);
    expect(e.emitted).toEqual([{ action: "player-connection-result", requestId: "r1", recipient: "u2", ok: true, connectionId: "new1" }]);
    expect(e.update.mock.calls[0][1][`${BASE}.new1`].authorId).toBe("u2");
  });
  it("drops malformed messages silently", async () => {
    const e = env();
    await handleConnectionRequest({ requestId: 5 }, "u2", e);
    await handleConnectionRequest({ requestId: "r1" }, undefined, e);
    expect(e.emitted).toEqual([]);
  });
});

describe("requestConnectionOp + handleConnectionResult (requester side)", () => {
  it("GM applies directly, no socket hop", async () => {
    const e = env({ isGM: true, userId: "gm" });
    expect(await requestConnectionOp({ op: "delete", fromUuid: "JournalEntry.ilva", connectionId: "c1" }, e)).toEqual({ ok: true, connectionId: "c1" });
    expect(e.emitted).toEqual([]);
    expect(e.update).toHaveBeenCalledWith(e.page, { [`${BASE}.-=c1`]: null });
  });
  it("no active GM: resolves no-gm at once and emits nothing", async () => {
    const e = env({ activeGM: () => null });
    expect(await requestConnectionOp(addReq(), e)).toEqual({ ok: false, reason: "no-gm" });
    expect(e.emitted).toEqual([]);
  });
  it("emits the request and settles on the GM's correlated result", async () => {
    const e = env({ randomId: () => "req9" });
    const pending = requestConnectionOp(addReq(), e);
    expect(e.emitted[0]).toMatchObject({ action: "player-connection", requestId: "req9", op: "add", fromUuid: "JournalEntry.ilva" });
    handleConnectionResult({ action: "player-connection-result", requestId: "req9", recipient: "u1", ok: true, connectionId: "c7" }, "gm", e);
    expect(await pending).toEqual({ ok: true, connectionId: "c7" });
  });
  it("ignores a result from a non-GM or for someone else", async () => {
    vi.useFakeTimers();
    const e = env({ randomId: () => "req8" });
    const pending = requestConnectionOp(addReq(), e);
    handleConnectionResult({ requestId: "req8", recipient: "u1", ok: true }, "u2", e);
    handleConnectionResult({ requestId: "req8", recipient: "u2", ok: true }, "gm", e);
    vi.advanceTimersByTime(ENTITY_RELAY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("connectionReasonKey", () => {
  it("maps known reasons and falls back to failed", () => {
    expect(connectionReasonKey("duplicate")).toBe("MEJCampaignCompanion.playerConnections.reasons.duplicate");
    expect(connectionReasonKey("weird")).toBe("MEJCampaignCompanion.playerConnections.reasons.failed");
  });
});

describe("allowedRelationshipsOf", () => {
  // MEJ's own sheet getter: a constant list, plus (v14 fork) types keyed by this.constructor.type.
  class PersonSheet {
    static type = "person";
    get allowedRelationships() { return ["person", "place", ...(this.constructor.type === "person" ? ["shop"] : [])]; }
  }

  it("reads the MEJ sheet class for the type, not page.sheet (a text page MEJ never fixType'd on the GM)", () => {
    const page = { get sheet() { return { constructor: { name: "JournalEntryPageProseMirrorSheet" } }; } };
    expect(allowedRelationshipsOf(page, "person", { person: PersonSheet })).toEqual(["person", "place", "shop"]);
  });

  it("falls back to page.sheet when MEJ has no class for the type", () => {
    const page = { sheet: { allowedRelationships: ["person"] } };
    expect(allowedRelationshipsOf(page, "session", { person: PersonSheet })).toEqual(["person"]);
    expect(allowedRelationshipsOf(page, "person", null)).toEqual(["person"]);
  });

  it("is empty when neither resolves, and never throws", () => {
    const throwing = { get sheet() { throw new Error("no sheet"); } };
    expect(allowedRelationshipsOf(throwing, "unknown", {})).toEqual([]);
    class Broken { get allowedRelationships() { throw new Error("boom"); } }
    expect(allowedRelationshipsOf({ sheet: null }, "x", { x: Broken })).toEqual([]);
  });
});
