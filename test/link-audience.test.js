// test/link-audience.test.js
import { describe, it, expect } from "vitest";
import {
  viewerIds, audienceContains, audienceViewerIdsForImport, filterCandidatesForAudience
} from "../scripts/logic/link-audience.mjs";

const user = (id, isGM = false) => ({ id, isGM });

describe("viewerIds", () => {
  it("returns non-GM users the predicate accepts, excluding GMs even when visible", () => {
    const users = [user("gm", true), user("a"), user("b")];
    const isVisible = (entry, u) => u.id !== "b";
    expect(viewerIds({ uuid: "e" }, users, isVisible)).toEqual(["a"]);
  });

  it("is empty for a GM-only entry", () => {
    const users = [user("gm", true), user("a")];
    expect(viewerIds({}, users, () => false)).toEqual([]);
  });
});

describe("audienceContains", () => {
  it("true when the page audience is a subset of the target audience", () => {
    expect(audienceContains(["a"], ["a", "b"])).toBe(true);
  });
  it("false when a page viewer cannot see the target", () => {
    expect(audienceContains(["a", "c"], ["a", "b"])).toBe(false);
  });
  it("an empty page audience (GM-only page) accepts any target", () => {
    expect(audienceContains([], [])).toBe(true);
    expect(audienceContains([], ["a"])).toBe(true);
  });
});

describe("audienceViewerIdsForImport", () => {
  const users = [user("gm", true), user("a"), user("b")];
  it("'players' → every non-GM id", () => {
    expect(audienceViewerIdsForImport("players", users)).toEqual(["a", "b"]);
  });
  it("'gm' → empty", () => {
    expect(audienceViewerIdsForImport("gm", users)).toEqual([]);
  });
});

describe("filterCandidatesForAudience", () => {
  it("keeps only candidates whose viewers contain the audience", () => {
    const cands = [
      { name: "Pub", uuid: "u1", viewerIds: ["a", "b"] },
      { name: "Sec", uuid: "u2", viewerIds: [] }
    ];
    expect(filterCandidatesForAudience(cands, ["a"]).map((c) => c.uuid)).toEqual(["u1"]);
    expect(filterCandidatesForAudience(cands, []).map((c) => c.uuid)).toEqual(["u1", "u2"]);
  });
});
