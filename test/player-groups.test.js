// test/player-groups.test.js
import { describe, it, expect } from "vitest";
import { normalizeGroups, upsertGroup, deleteGroup } from "../scripts/logic/player-groups.mjs";

describe("normalizeGroups", () => {
  it("drops rows without id or name, coerces members", () => {
    expect(normalizeGroups(null)).toEqual([]);
    expect(normalizeGroups([
      { id: "g1", name: "A", members: ["u1", 5] },
      { id: "", name: "bad" },
      { name: "no-id" },
      { id: "g2", name: "B" }
    ])).toEqual([
      { id: "g1", name: "A", members: ["u1"] },
      { id: "g2", name: "B", members: [] }
    ]);
  });
});

describe("upsertGroup / deleteGroup", () => {
  const base = [{ id: "g1", name: "A", members: ["u1"] }];
  it("replaces by id, immutably", () => {
    const out = upsertGroup(base, { id: "g1", name: "A2", members: ["u2"] });
    expect(out).toEqual([{ id: "g1", name: "A2", members: ["u2"] }]);
    expect(base[0].name).toBe("A");
  });
  it("appends a new id", () => {
    const out = upsertGroup(base, { id: "g9", name: "New", members: [] });
    expect(out).toHaveLength(2);
    expect(out[1].id).toBe("g9");
  });
  it("deleteGroup removes by id and tolerates unknown ids", () => {
    expect(deleteGroup(base, "g1")).toEqual([]);
    expect(deleteGroup(base, "zzz")).toEqual(base);
  });
});
