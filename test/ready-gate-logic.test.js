import { describe, it, expect } from "vitest";
import { gatedCall } from "../scripts/logic/ready-gate-logic.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("gatedCall", () => {
  it("does not call wrapped until the gate resolves, then calls it once with the same args and returns its value", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    const wrapped = (...a) => { calls.push(a); return "opened"; };
    const p = gatedCall(gate, wrapped, ["doc", { newtab: true }]);
    await tick();
    expect(calls).toEqual([]);
    release();
    await expect(p).resolves.toBe("opened");
    expect(calls).toEqual([["doc", { newtab: true }]]);
  });

  it("delegates on the next microtask when the gate is already resolved", async () => {
    const calls = [];
    const p = gatedCall(Promise.resolve(), (...a) => { calls.push(a); return 1; }, []);
    expect(calls).toEqual([]);
    await expect(p).resolves.toBe(1);
    expect(calls).toEqual([[]]);
  });

  it("propagates wrapped's rejection", async () => {
    await expect(gatedCall(Promise.resolve(), async () => { throw new Error("mej said no"); }, [])).rejects.toThrow("mej said no");
  });

  it("never calls wrapped when the gate rejects", async () => {
    const calls = [];
    await expect(gatedCall(Promise.reject(new Error("wiring")), () => { calls.push(1); }, [])).rejects.toThrow("wiring");
    expect(calls).toEqual([]);
  });
});
