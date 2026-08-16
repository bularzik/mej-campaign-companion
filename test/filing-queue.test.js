import { describe, it, expect, vi, beforeEach } from "vitest";

// The module holds one shared, module-scoped promise chain (by design - see
// its header comment), so re-import it fresh per test via vi.resetModules()
// to keep tests independent of each other's queued state.
async function freshQueueFiling() {
  vi.resetModules();
  const mod = await import("../scripts/logic/filing-queue.mjs");
  return mod.queueFiling;
}

describe("queueFiling", () => {
  let errSpy;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs queued tasks sequentially, even when an earlier one is slow", async () => {
    const queueFiling = await freshQueueFiling();
    const order = [];
    let resolveFirst;
    const first = () => new Promise((resolve) => { resolveFirst = resolve; }).then(() => order.push("first"));
    const second = () => { order.push("second"); };

    const p1 = queueFiling(first);
    const p2 = queueFiling(second);

    // second must not have run yet - it's still waiting behind first.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    resolveFirst();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps the chain usable after a queued task throws (self-healing, doesn't poison later tasks)", async () => {
    const queueFiling = await freshQueueFiling();
    const order = [];
    const failing = () => { throw new Error("boom"); };
    const ok = () => { order.push("ran"); };

    await queueFiling(failing);
    await queueFiling(ok);

    expect(order).toEqual(["ran"]);
    expect(errSpy).toHaveBeenCalledWith("mej-campaign-companion | filing failed", expect.any(Error));
  });

  it("never rejects the returned promise, even for a failing task", async () => {
    const queueFiling = await freshQueueFiling();
    await expect(queueFiling(() => { throw new Error("boom"); })).resolves.toBeUndefined();
  });
});
