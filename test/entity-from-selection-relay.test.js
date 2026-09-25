import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleEntityRequest, handleEntityResult, requestEntityViaGm } from "../scripts/hooks/entity-from-selection-relay.mjs";

const payload = (p = {}) => ({
  action: "entity-from-selection", requestId: "r1", userId: "SPOOF",
  pageUuid: "P", fieldKey: "text.content", text: "Elara", occurrence: 0, total: 1,
  type: "person", name: "Elara", linkOthers: true, ...p
});

function gmEnv({ contributor = true, observe = true } = {}) {
  const page = {
    parent: { testUserPermission: vi.fn(() => observe) },
    text: { content: "<p>Elara</p>" }
  };
  return {
    emitted: [],
    emit(msg) { this.emitted.push(msg); },
    users: new Map([["u1", { id: "u1", isGM: false }], ["SPOOF", { id: "SPOOF", isGM: false }]]),
    fromUuid: vi.fn(async () => page),
    campaignFlagFor: vi.fn(() => ({ contributors: { userIds: contributor ? ["u1"] : [], groupIds: [] } })),
    groups: [],
    regionKeys: () => ["text.content"],
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
    handleEntityResult({ requestId: "r1", recipient: "someone-else", ok: true }, env);
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, env);
    await expect(p).resolves.toEqual({ ok: true, entryUuid: "E", linked: true, retro: false });
  });
  it("times out after 15 s with no-gm, and a late result goes to onLate", async () => {
    const env = clientEnv();
    const p = requestEntityViaGm({ pageUuid: "P" }, env);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toEqual({ ok: false, reason: "no-gm" });
    handleEntityResult({ requestId: "r1", recipient: "u1", ok: true, entryUuid: "E", linked: true, retro: false }, env);
    expect(env.onLate).toHaveBeenCalledWith(expect.objectContaining({ ok: true, entryUuid: "E" }));
  });
});
