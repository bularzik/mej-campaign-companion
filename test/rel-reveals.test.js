// test/rel-reveals.test.js
import { describe, it, expect } from "vitest";
import { visibleRelRows } from "../scripts/logic/rel-reveals.mjs";

const GROUPS = [{ id: "g1", name: "A", members: ["u2"] }];
const RELS = {
  r1: { id: "r1", uuid: "JournalEntry.aaa", relationship: "Ally", hidden: false },
  r2: { id: "r2", uuid: "JournalEntry.bbb", relationship: "Enemy", hidden: true },
  r3: { id: "r3", uuid: "JournalEntry.ccc", relationship: "", secret: "Secret sibling", revealed: false, hidden: false }
};
const REVEALS = {
  r2: { row: { users: ["u1"], groups: [], all: false } },
  r3: { secret: { users: [], groups: ["g1"], all: false } }
};

describe("visibleRelRows", () => {
  it("GM sees every row with secretText always a string", () => {
    const rows = visibleRelRows(RELS, REVEALS, { userId: "gm", groups: GROUPS, isGM: true });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "r3").secretText).toBe("Secret sibling");
  });
  it("player sees non-hidden rows plus row-revealed hidden rows", () => {
    const u1 = visibleRelRows(RELS, REVEALS, { userId: "u1", groups: GROUPS, isGM: false });
    expect(u1.map((r) => r.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect(u1.find((r) => r.id === "r2").rowRevealedToUser).toBe(true);
    const u3 = visibleRelRows(RELS, REVEALS, { userId: "u3", groups: GROUPS, isGM: false });
    expect(u3.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });
  it("secretText per-viewer: group reveal via live membership; hidden otherwise", () => {
    const u2 = visibleRelRows(RELS, REVEALS, { userId: "u2", groups: GROUPS, isGM: false });
    expect(u2.find((r) => r.id === "r3").secretText).toBe("Secret sibling");
    const u1 = visibleRelRows(RELS, REVEALS, { userId: "u1", groups: GROUPS, isGM: false });
    expect(u1.find((r) => r.id === "r3").secretText).toBe(null);
  });
  it("rel.revealed === true shows secretText to everyone; tolerates array form + missing uuid", () => {
    const rels = [{ id: "x", uuid: "JournalEntry.x", secret: "s", revealed: true }, { id: "bad" }];
    const rows = visibleRelRows(rels, {}, { userId: "u9", groups: [], isGM: false });
    expect(rows).toHaveLength(1);
    expect(rows[0].secretText).toBe("s");
  });
});
