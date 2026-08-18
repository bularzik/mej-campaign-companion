// test/session-flag-heal.test.js
import { describe, it, expect } from "vitest";
import { planFlagHeal } from "../scripts/logic/session-flag-heal.mjs";

const page = (uuid, flagType) => ({ uuid, flagType });

describe("planFlagHeal", () => {
  it("selects only pages whose MEJ type flag is missing", () => {
    expect(planFlagHeal([
      page("a", "session"),
      page("b", undefined),
      page("c", "session")
    ])).toEqual(["b"]);
  });

  it("selects pages whose flag holds the wrong value", () => {
    expect(planFlagHeal([page("a", "person"), page("b", "session")])).toEqual(["a"]);
  });

  it("is empty when every page is already stamped", () => {
    expect(planFlagHeal([page("a", "session"), page("b", "session")])).toEqual([]);
  });

  it("handles empty and missing input without throwing", () => {
    expect(planFlagHeal([])).toEqual([]);
    expect(planFlagHeal(undefined)).toEqual([]);
    expect(planFlagHeal(null)).toEqual([]);
  });
});
