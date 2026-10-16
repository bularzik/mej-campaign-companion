import { describe, it, expect } from "vitest";
import { applyChecklistAudience, checklistSeed } from "../scripts/logic/checklist-reveal.mjs";

const item = { id: "c1", text: "Who paid the guards?", revealed: false, revealedAt: null };

describe("applyChecklistAudience", () => {
  it("Everyone -> revealed flag carries it; stored audience.all is false", () => {
    const next = applyChecklistAudience(item, { all: true, users: [], groups: [] }, 1000);
    expect(next.revealed).toBe(true);
    expect(next.revealedAt).toBe(1000);
    expect(next.audience.all).toBe(false);
  });
  it("named players only -> not revealed to everyone, audience kept", () => {
    const next = applyChecklistAudience(item, { all: false, users: ["u1"], groups: ["g1"] }, 1000);
    expect(next.revealed).toBe(false);
    expect(next.revealedAt).toBeNull();
    expect(next.audience.users).toEqual(["u1"]);
    expect(next.audience.groups).toEqual(["g1"]);
  });
  it("keeps the original revealedAt when already revealed to everyone", () => {
    const already = { ...item, revealed: true, revealedAt: 5 };
    expect(applyChecklistAudience(already, { all: true, users: [], groups: [] }, 1000).revealedAt).toBe(5);
  });
  it("un-reveal clears revealed and revealedAt", () => {
    const already = { ...item, revealed: true, revealedAt: 5, audience: { users: ["u1"], groups: [], all: false } };
    const next = applyChecklistAudience(already, { all: false, users: [], groups: [] }, 1000);
    expect(next.revealed).toBe(false);
    expect(next.revealedAt).toBeNull();
    expect(next.audience.users).toEqual([]);
  });
  it("never mutates its input", () => {
    const frozen = Object.freeze({ ...item });
    applyChecklistAudience(frozen, { all: true, users: [], groups: [] }, 1);
    expect(frozen.revealed).toBe(false);
  });
});

describe("checklistSeed (Review Focus 1: legacy revealed:true with no audience)", () => {
  it("seeds Everyone from the revealed flag", () => {
    const seed = checklistSeed({ id: "c1", text: "x", revealed: true, revealedAt: 1 });
    expect(seed.all).toBe(true);
    expect(seed.users).toEqual([]);
  });
  it("seeds users/groups from the audience and Everyone from the flag", () => {
    const seed = checklistSeed({ id: "c1", revealed: false, audience: { users: ["u1"], groups: [], all: false } });
    expect(seed.all).toBe(false);
    expect(seed.users).toEqual(["u1"]);
  });
  it("legacy revealed:false with audience.all:true still seeds Everyone", () => {
    const legacy = { id: "c1", text: "x", revealed: false, revealedAt: null, audience: { users: [], groups: [], all: true } };
    expect(checklistSeed(legacy).all).toBe(true);
  });
  it("re-saving a legacy audience.all item as Everyone yields revealed:true", () => {
    const legacy = { id: "c1", text: "x", revealed: false, revealedAt: null, audience: { users: [], groups: [], all: true } };
    const next = applyChecklistAudience(legacy, checklistSeed(legacy), 2000);
    expect(next.revealed).toBe(true);
    expect(next.revealedAt).toBe(2000);
    expect(next.audience.all).toBe(false);
  });
});
