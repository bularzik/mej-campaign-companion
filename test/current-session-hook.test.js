import { describe, it, expect } from "vitest";
import { grantForConnectedUser } from "../scripts/hooks/current-session.mjs";

describe("grantForConnectedUser (Review Focus 4)", () => {
  const entry = (ownership) => ({ id: "e", ownership });
  it("grants on sessions whose campaign baseline allows viewing", () => {
    const sessions = [{ campaign: { id: "c1" }, entry: entry({ default: 2 }) }, { campaign: { id: "c2" }, entry: entry({ default: 0 }) }];
    const out = grantForConnectedUser("u1", sessions, { ownerLevel: 3, baselineOf: (c) => (c.id === "c1" ? 2 : 0) });
    expect(out).toEqual([{ entry: sessions[0].entry, update: { "ownership.u1": 3 } }]);
  });
  it("nothing when already an owner", () => {
    const sessions = [{ campaign: { id: "c1" }, entry: entry({ default: 2, u1: 3 }) }];
    expect(grantForConnectedUser("u1", sessions, { ownerLevel: 3, baselineOf: () => 2 })).toEqual([]);
  });
});
