// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { targetProblem, eligibleTargets, normalizeConnections } from "../scripts/logic/player-connections.mjs";
import { readConnectionForm, createSubmitHandler } from "../scripts/apps/player-connection-dialog.mjs";

const e = (uuid, name, type, seen = true) => ({ uuid, name, __type: type, __seen: seen });
const existing = normalizeConnections({
  c1: { id: "c1", to: "J.mara", authorId: "u1", sides: {} },
  c2: { id: "c2", to: "J.bren", authorId: "u2", sides: {} }
}, "J.ilva");
const ctx = { sourceUuid: "J.ilva", allowed: ["person", "place"], authorId: "u1", existing,
  typeOf: (x) => x.__type ?? null, canLimited: (x) => x.__seen };

describe("targetProblem (spec §4.6, §7 drop)", () => {
  it("names why a target can't be connected", () => {
    expect(targetProblem(null, ctx)).toBe("not-journal");
    expect(targetProblem(e("J.ilva", "Ilva", "person"), ctx)).toBe("self");
    expect(targetProblem(e("J.hid", "Hid", "person", false), ctx)).toBe("no-access");
    expect(targetProblem(e("J.list", "Ledger", "list"), ctx)).toBe("type-not-allowed");
    expect(targetProblem(e("J.text", "Notes", null), ctx)).toBe("type-not-allowed");
    expect(targetProblem(e("J.mara", "Mara", "person"), ctx)).toBe("duplicate");
    expect(targetProblem(e("J.bren", "Bren", "person"), ctx)).toBeNull();
  });
});

describe("eligibleTargets", () => {
  const entries = [e("J.ilva", "Ilva", "person"), e("J.mara", "Mara", "person"), e("J.bren", "Bren", "person"),
    e("J.town", "aldwick", "place"), e("J.hid", "Hid", "person", false), e("J.list", "Ledger", "list")];
  it("excludes self, invisible, disallowed and already-connected targets; sorted by name", () => {
    expect(eligibleTargets(entries, ctx).map((r) => r.uuid)).toEqual(["J.town", "J.bren"]);
    expect(eligibleTargets(entries, ctx)[0]).toEqual({ uuid: "J.town", name: "aldwick", type: "place" });
  });
  it("filters case-insensitively", () => {
    expect(eligibleTargets(entries, ctx, "  BRE ").map((r) => r.uuid)).toEqual(["J.bren"]);
  });
});

function makeForm(target = "J.bren", label = "Owes money to") {
  const form = document.createElement("form");
  form.innerHTML = `<input type="hidden" name="target" value="${target}">`
    + `<input name="fromLabel" value=" ${label} "><input name="fromSecret" value=" a lot ">`
    + '<input name="toLabel" value=""><input name="toSecret" value="">'
    + '<input type="checkbox" name="shared"><button class="s"></button>';
  return form;
}

describe("readConnectionForm", () => {
  it("reads the target, both sides trimmed, and Share with party", () => {
    expect(readConnectionForm(makeForm())).toEqual({
      to: "J.bren", fromNote: { label: "Owes money to", secret: "a lot" }, toNote: { label: "", secret: "" }, shared: false
    });
  });
});

describe("createSubmitHandler (double-click guard, spec §7)", () => {
  const setup = (save) => {
    const form = makeForm();
    const button = form.querySelector(".s");
    const close = vi.fn(async () => {});
    const warn = vi.fn();
    const submit = createSubmitHandler({ form, button, save, close, warn, messages: { pickTarget: "pick", labelRequired: "label" } });
    return { form, button, close, warn, submit };
  };
  it("ignores a second submit while the first is pending and disables the button", async () => {
    let resolve;
    const save = vi.fn(() => new Promise((r) => { resolve = r; }));
    const { button, close, submit } = setup(save);
    const first = submit();
    expect(button.disabled).toBe(true);
    await submit();
    expect(save).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    expect(await first).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("re-enables and stays open on a rejection", async () => {
    const save = vi.fn(async () => ({ ok: false, reason: "timeout" }));
    const { button, close, submit } = setup(save);
    expect(await submit()).toBe(false);
    expect(button.disabled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    await submit();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("re-enables when save throws", async () => {
    const { button, submit } = setup(vi.fn(async () => { throw new Error("x"); }));
    await expect(submit()).rejects.toThrow("x");
    expect(button.disabled).toBe(false);
  });
  it("warns without saving when no target or label", async () => {
    const save = vi.fn();
    const a = setup(save);
    a.form.querySelector("[name=target]").value = "";
    await a.submit();
    expect(a.warn).toHaveBeenCalledWith("pick");
    const b = setup(save);
    b.form.querySelector("[name=fromLabel]").value = " ";
    await b.submit();
    expect(b.warn).toHaveBeenCalledWith("label");
    expect(save).not.toHaveBeenCalled();
  });
});
