// test/mej-wraps.test.js
import { describe, it, expect, vi } from "vitest";
import { installWraps, uninstallWraps } from "../scripts/logic/mej-wraps.mjs";

const env = () => ({ libWrapperModule: { active: false }, libWrapper: null, moduleId: "mej-campaign-companion", warn: vi.fn() });

describe("installWraps (manual branch)", () => {
  it("wraps a method so the wrapper sees `this` and a bound original", () => {
    const obj = { n: 2, double(x) { return this.n * x; } };
    const res = installWraps([{ name: "double", object: obj, key: "double",
      wrapper(wrapped, x) { return wrapped(x) + 1; } }], env());
    expect(res.installed).toEqual(["double"]);
    expect(res.failed).toBeNull();
    expect(obj.double(5)).toBe(11);
  });

  it("returns a promise when the wrapped method is async and a value when it is not", async () => {
    const obj = { sync() { return 1; }, async asyncFn() { return 2; } };
    installWraps([
      { name: "sync", object: obj, key: "sync", wrapper(wrapped) { return wrapped(); } },
      { name: "async", object: obj, key: "asyncFn", wrapper(wrapped) { return wrapped(); } }
    ], env());
    expect(obj.sync()).toBe(1);
    const p = obj.asyncFn();
    expect(p).toBeInstanceOf(Promise);
    expect(await p).toBe(2);
  });

  it("uninstalls everything already installed when a later target is missing", () => {
    const obj = { a() { return "a"; } };
    const original = obj.a;
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(wrapped) { return wrapped() + "!"; } },
      { name: "missing", object: obj, key: "nope", wrapper(wrapped) { return wrapped(); } }
    ], env());
    expect(res.installed).toEqual([]);
    expect(res.failed).toBe("missing");
    expect(obj.a).toBe(original);
  });

  it("uninstallWraps restores originals in reverse order", () => {
    const obj = { a() { return "a"; }, b() { return "b"; } };
    const [oa, ob] = [obj.a, obj.b];
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(w) { return w() + "1"; } },
      { name: "b", object: obj, key: "b", wrapper(w) { return w() + "2"; } }
    ], env());
    expect(obj.a()).toBe("a1");
    uninstallWraps(res.records, env());
    expect(obj.a).toBe(oa);
    expect(obj.b).toBe(ob);
  });
});

describe("installWraps (libWrapper branch)", () => {
  it("registers by path when libWrapper is active and a path is given", () => {
    const libWrapper = { register: vi.fn(), unregister: vi.fn() };
    const obj = { f() { return 1; } };
    const res = installWraps([{ name: "f", object: obj, key: "f", path: "game.X.f", wrapper(w) { return w(); } }],
      { ...env(), libWrapperModule: { active: true }, libWrapper });
    expect(libWrapper.register).toHaveBeenCalledWith("mej-campaign-companion", "game.X.f", expect.any(Function), "WRAPPER");
    expect(res.installed).toEqual(["f"]);
    uninstallWraps(res.records, { ...env(), libWrapperModule: { active: true }, libWrapper });
    expect(libWrapper.unregister).toHaveBeenCalledWith("mej-campaign-companion", "game.X.f");
  });

  it("falls back to the manual patch when libWrapper.register throws, and warns", () => {
    const libWrapper = { register: vi.fn(() => { throw new Error("nope"); }), unregister: vi.fn() };
    const e = { ...env(), libWrapperModule: { active: true }, libWrapper };
    const obj = { f() { return 1; } };
    const res = installWraps([{ name: "f", object: obj, key: "f", path: "game.X.f", wrapper(w) { return w() + 1; } }], e);
    expect(res.installed).toEqual(["f"]);
    expect(obj.f()).toBe(2);
    expect(e.warn).toHaveBeenCalled();
  });

  it("tolerates env.warn throwing during rollback when install fails", () => {
    const throwingWarn = vi.fn(() => { throw new Error("warn failed"); });
    const e = { libWrapperModule: { active: false }, libWrapper: null, moduleId: "mej-campaign-companion", warn: throwingWarn };
    const obj = { a() { return "a"; } };
    const original = obj.a;
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(wrapped) { return wrapped() + "!"; } },
      { name: "missing", object: obj, key: "nope", wrapper(wrapped) { return wrapped(); } }
    ], e);
    // Even though warn threw, the rollback should have completed and restored obj.a
    expect(res.installed).toEqual([]);
    expect(res.failed).toBe("missing");
    expect(obj.a).toBe(original);
    expect(throwingWarn).toHaveBeenCalled();
  });

  it("tolerates missing env.warn during rollback when install fails", () => {
    const e = { libWrapperModule: { active: false }, libWrapper: null, moduleId: "mej-campaign-companion" };
    // Note: no warn at all
    const obj = { a() { return "a"; } };
    const original = obj.a;
    const res = installWraps([
      { name: "a", object: obj, key: "a", wrapper(wrapped) { return wrapped() + "!"; } },
      { name: "missing", object: obj, key: "nope", wrapper(wrapped) { return wrapped(); } }
    ], e);
    // Even though env.warn is missing, the rollback should still work and restore obj.a
    expect(res.installed).toEqual([]);
    expect(res.failed).toBe("missing");
    expect(obj.a).toBe(original);
  });

  it("warns when uninstalling a libwrapper record but env.libWrapper is missing", () => {
    const e = { libWrapperModule: { active: false }, libWrapper: null, moduleId: "mej-campaign-companion", warn: vi.fn() };
    const records = [{ name: "f", kind: "libwrapper", path: "game.X.f" }];
    uninstallWraps(records, e);
    expect(e.warn).toHaveBeenCalledWith(expect.stringContaining("game.X.f"), undefined);
  });
});
