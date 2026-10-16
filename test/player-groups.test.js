// test/player-groups.test.js
import { describe, it, expect } from "vitest";
import { normalizeGroups, upsertGroup, deleteGroup, groupsSummary, mergeGroupTicks } from "../scripts/logic/player-groups.mjs";

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

describe("groupsSummary", () => {
  const users = [{ id: "u1", name: "Zed" }, { id: "u2", name: "Ann" }];
  it("joins member names in group-member order and sorts groups by name", () => {
    const out = groupsSummary(
      [{ id: "g2", name: "Outer", members: ["u2"] }, { id: "g1", name: "Inner", members: ["u1", "u2", "gone"] }],
      users
    );
    expect(out).toEqual([
      { id: "g1", name: "Inner", memberNames: "Zed, Ann" },
      { id: "g2", name: "Outer", memberNames: "Ann" }
    ]);
  });
  it("empty input gives []", () => expect(groupsSummary(undefined, users)).toEqual([]));
});

describe("mergeGroupTicks", () => {
  const fresh = [
    { id: "a", name: "A", checked: true },
    { id: "b", name: "B", checked: false },
    { id: "n", name: "New", checked: false }
  ];
  it("a rendered group the GM unticked stays unticked even if saved as checked", () => {
    expect(mergeGroupTicks(fresh, ["a", "b"], []).find((c) => c.id === "a").checked).toBe(false);
  });
  it("a rendered group the GM ticked stays ticked even if saved as unchecked", () => {
    expect(mergeGroupTicks(fresh, ["a", "b"], ["b"]).find((c) => c.id === "b").checked).toBe(true);
  });
  it("a new group (not rendered before) uses its saved state", () => {
    expect(mergeGroupTicks(fresh, ["a", "b"], ["a"]).find((c) => c.id === "n").checked).toBe(false);
    expect(mergeGroupTicks([{ id: "n", name: "New", checked: true }], [], [])[0].checked).toBe(true);
  });
  it("a deleted group is dropped", () => {
    const out = mergeGroupTicks(fresh.filter((c) => c.id !== "a"), ["a", "b"], ["a", "b"]);
    expect(out.map((c) => c.id)).toEqual(["b", "n"]);
  });
});
