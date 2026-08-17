// test/reveal-state.test.js
import { describe, it, expect } from "vitest";
import {
  normalizeAudience, canSee, isRevealed, toggleUser, toggleGroup, setAll,
  resolveRecipients, pruneReveals
} from "../scripts/logic/reveal-state.mjs";

const GROUPS = [
  { id: "g1", name: "Party A", members: ["u1", "u2"] },
  { id: "g2", name: "Traitors", members: ["u3"] }
];

describe("normalizeAudience", () => {
  it("fills defaults for missing/garbage input", () => {
    expect(normalizeAudience(null)).toEqual({ users: [], groups: [], all: false, revealedAt: null });
    expect(normalizeAudience({ users: "x", groups: null, all: "yes" }))
      .toEqual({ users: [], groups: [], all: false, revealedAt: null });
  });
  it("keeps valid fields and drops non-string ids", () => {
    expect(normalizeAudience({ users: ["u1", 7], groups: ["g1"], all: true, revealedAt: 123 }))
      .toEqual({ users: ["u1"], groups: ["g1"], all: true, revealedAt: 123 });
  });
});

describe("canSee", () => {
  it("all wins regardless of membership", () => {
    expect(canSee({ users: [], groups: [], all: true }, "anyone", [])).toBe(true);
  });
  it("direct user membership", () => {
    const a = { users: ["u1"], groups: [], all: false };
    expect(canSee(a, "u1", GROUPS)).toBe(true);
    expect(canSee(a, "u2", GROUPS)).toBe(false);
  });
  it("live group membership: joining grants, leaving revokes", () => {
    const a = { users: [], groups: ["g1"], all: false };
    expect(canSee(a, "u2", GROUPS)).toBe(true);
    const after = [{ id: "g1", name: "Party A", members: ["u1"] }]; // u2 left
    expect(canSee(a, "u2", after)).toBe(false);
    const joined = [{ id: "g1", name: "Party A", members: ["u1", "u2", "u9"] }];
    expect(canSee(a, "u9", joined)).toBe(true);
  });
  it("unknown group id resolves to no members", () => {
    expect(canSee({ users: [], groups: ["nope"], all: false }, "u1", GROUPS)).toBe(false);
  });
});

describe("toggle helpers (immutable)", () => {
  it("toggleUser adds then removes, stamping revealedAt on add", () => {
    const a0 = normalizeAudience(null);
    const a1 = toggleUser(a0, "u1", 111);
    expect(a1.users).toEqual(["u1"]);
    expect(a1.revealedAt).toBe(111);
    expect(a0.users).toEqual([]); // unchanged
    const a2 = toggleUser(a1, "u1", 222);
    expect(a2.users).toEqual([]);
  });
  it("toggleGroup and setAll behave the same way", () => {
    const a1 = toggleGroup(normalizeAudience(null), "g1", 5);
    expect(a1.groups).toEqual(["g1"]);
    const a2 = setAll(a1, true, 9);
    expect(a2.all).toBe(true);
    expect(setAll(a2, false, 9).all).toBe(false);
  });
});

describe("isRevealed / resolveRecipients", () => {
  it("isRevealed true when any target exists", () => {
    expect(isRevealed({ users: [], groups: [], all: false })).toBe(false);
    expect(isRevealed({ users: ["u1"], groups: [], all: false })).toBe(true);
    expect(isRevealed({ users: [], groups: ["g1"], all: false })).toBe(true);
    expect(isRevealed({ users: [], groups: [], all: true })).toBe(true);
  });
  it("resolveRecipients unions users and group members, deduped", () => {
    const a = { users: ["u1", "u3"], groups: ["g1"], all: false };
    expect(resolveRecipients(a, GROUPS).sort()).toEqual(["u1", "u2", "u3"]);
  });
  it("resolveRecipients with all=true returns empty (callers whisper all players themselves)", () => {
    expect(resolveRecipients({ users: ["u1"], groups: [], all: true }, GROUPS)).toEqual([]);
  });
});

describe("pruneReveals", () => {
  it("drops records whose key is gone, reports changed", () => {
    const map = { "secret-a": { users: ["u1"], groups: [], all: false, revealedAt: 1 }, "secret-b": { users: [], groups: ["g1"], all: false, revealedAt: 2 } };
    const { map: out, changed } = pruneReveals(map, ["secret-a"]);
    expect(Object.keys(out)).toEqual(["secret-a"]);
    expect(changed).toBe(true);
    const same = pruneReveals(map, ["secret-a", "secret-b"]);
    expect(same.changed).toBe(false);
  });
});
