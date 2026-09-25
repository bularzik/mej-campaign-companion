import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleEntityRequest, handleEntityResult, requestEntityViaGm } from "../scripts/hooks/entity-from-selection-relay.mjs";

const payload = (p = {}) => ({
  action: "entity-from-selection", requestId: "r1", userId: "SPOOF",
  pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
  type: "person", name: "Elara", linkOthers: true, ...p
});

function gmEnv({ contributor = true, observe = true, owner = false, page: pageOverride } = {}) {
  const page = pageOverride ?? {
    parent: { testUserPermission: vi.fn(() => observe) },
    testUserPermission: vi.fn(() => owner),
    text: { content: "<p>Elara</p>" }
  };
  return {
    emitted: [],
    emit(msg) { this.emitted.push(msg); },
    users: new Map([
      ["u1", { id: "u1", isGM: false }], ["SPOOF", { id: "SPOOF", isGM: false }], ["gm1", { id: "gm1", isGM: true }]
    ]),
    fromUuid: vi.fn(async () => page),
    campaignFlagFor: vi.fn(() => ({ contributors: { userIds: contributor ? ["u1"] : [], groupIds: [] } })),
    groups: [],
    run: vi.fn(async () => ({ ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true })),
    page
  };
}

describe("handleEntityRequest (GM)", () => {
  it("validates against the socket sender, not payload.userId, then runs and replies to the sender", async () => {
    const env = gmEnv();
    await handleEntityRequest(payload(), "u1", env);
    expect(env.page.parent.testUserPermission).toHaveBeenCalledWith(env.users.get("u1"), "OBSERVER");
    expect(env.run).toHaveBeenCalledWith(expect.objectContaining({ pageUuid: "P", name: "Elara" }));
    expect(env.emitted).toEqual([{ action: "entity-from-selection-result", requestId: "r1", recipient: "u1",
      ok: true, entryUuid: "JournalEntry.new", linked: true, retro: true }]);
  });
  it("rejects a non-contributor sender even when payload.userId names a contributor", async () => {
    const env = gmEnv({ contributor: false });
    env.campaignFlagFor = () => ({ contributors: { userIds: ["SPOOF"], groupIds: [] } });
    await handleEntityRequest(payload(), "u1", env);
    expect(env.run).not.toHaveBeenCalled();
    expect(env.emitted[0]).toMatchObject({ recipient: "u1", ok: false, reason: "not-contributor" });
  });
  it("rejects unknown sender, invisible page, bad type, oversized name without writing", async () => {
    for (const [p, s, opts, reason] of [
      [{}, "ghost", {}, "bad-sender"],
      [{}, "u1", { observe: false }, "not-visible"],
      [{ type: "session" }, "u1", {}, "bad-type"],
      [{ name: "x".repeat(5000) }, "u1", {}, "bad-name"]
    ]) {
      const env = gmEnv(opts);
      await handleEntityRequest(payload(p), s, env);
      expect(env.run).not.toHaveBeenCalled();
      expect(env.emitted[0]).toMatchObject({ ok: false, reason });
    }
  });
  it("replies page-missing when the page is gone", async () => {
    const env = gmEnv();
    env.fromUuid = vi.fn(async () => null);
    await handleEntityRequest(payload(), "u1", env);
    expect(env.emitted[0]).toMatchObject({ ok: false, reason: "page-missing" });
  });  it("rejects an unknown or GM sender before resolving the page (no page-existence oracle)", async () => {
    for (const sender of ["ghost", "gm1"]) {
      const env = gmEnv();
      await handleEntityRequest(payload(), sender, env);
      expect(env.fromUuid).not.toHaveBeenCalled();
      expect(env.run).not.toHaveBeenCalled();
      expect(env.emitted).toEqual([expect.objectContaining({ recipient: sender, ok: false, reason: "bad-sender" })]);
    }
  });
  it("never accepts a GM-only field: system.gmNotes on a session page is bad-field", async () => {
    const session = {
      parent: { testUserPermission: vi.fn(() => true) },
      testUserPermission: vi.fn(() => false),
      system: { recap: "<p>Elara</p>", gmNotes: "<p>Elara</p>" }
    };
    const env = gmEnv({ page: session });
    await handleEntityRequest(payload({ fieldKey: "system.gmNotes" }), "u1", env);
    expect(env.run).not.toHaveBeenCalled();
    expect(env.emitted[0]).toMatchObject({ ok: false, reason: "bad-field" });
    // The session body itself stays linkable.
    const ok = gmEnv({ page: session });
    await handleEntityRequest(payload({ fieldKey: "system.recap" }), "u1", ok);
    expect(ok.run).toHaveBeenCalledWith(expect.objectContaining({ fieldKey: "system.recap" }));
  });
  it("replies create-failed (and logs) when the GM-side run throws", async () => {
    const env = gmEnv();
    env.run = vi.fn(async () => { throw new Error("boom"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await handleEntityRequest(payload(), "u1", env);
      expect(env.emitted).toEqual([expect.objectContaining({ recipient: "u1", requestId: "r1", ok: false, reason: "create-failed" })]);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("mej-campaign-companion"), expect.any(Error));
    } finally {
      spy.mockRestore();
    }
  });
  it("masks secret sections for a sender who does not own the page, not for an owner", async () => {
    const nonOwner = gmEnv({ owner: false });
    await handleEntityRequest(payload({ maskSecrets: false }), "u1", nonOwner);
    expect(nonOwner.page.testUserPermission).toHaveBeenCalledWith(nonOwner.users.get("u1"), "OWNER");
    expect(nonOwner.run).toHaveBeenCalledWith(expect.objectContaining({ maskSecrets: true }));
    const owner = gmEnv({ owner: true });
    await handleEntityRequest(payload({ maskSecrets: true }), "u1", owner);
    expect(owner.run).toHaveBeenCalledWith(expect.objectContaining({ maskSecrets: false }));
  });
});

describe("requestEntityViaGm / handleEntityResult (requester)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const clientEnv = () => ({ emitted: [], emit(m) { this.emitted.push(m); }, userId: "u1", randomId: () => "r1", onLate: vi.fn() });

  it("emits the request and resolves on the matching result for this user only", async () => {
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    expect(env.emitted[0]).toMatchObject({ action: "entity-from-selection", requestId: "r1", pageUuid: "P" });
    handleEntityResult({ requestId: "r1", recipient: "someone-else", ok: true }, "gm1", env);
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, "gm1", env);
    await expect(p).resolves.toEqual({ ok: true, entryUuid: "E", linked: true, retro: false });
  });
  it("times out after 15 s with no-gm, and a late result goes to onLate", async () => {
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toEqual({ ok: false, reason: "no-gm" });
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, "gm1", env);
    expect(env.onLate).toHaveBeenCalledWith(expect.objectContaining({ ok: true, entryUuid: "E" }));
  });
  it("regression (fix round 1): tolerates the dispatcher's real call shape - senderId as the 2nd argument, not env", async () => {
    // socket.mjs's dispatcher always calls `handler(payload, senderId)`. A
    // two-parameter `handleEntityResult(payload, env = foundryEnv())` would
    // receive the GM's sender-id STRING as `env` here (since the default
    // only applies to `undefined`), so `env.userId` would be undefined and
    // this would never resolve - it would instead time out at 15s. Driving
    // the call with senderId in the real dispatcher position (2nd) and env
    // in the 3rd catches that regression.
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, "gm1", env);
    await expect(p).resolves.toEqual({ ok: true, entryUuid: "E", linked: true, retro: false });
  });
});
