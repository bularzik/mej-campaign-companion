import { describe, it, expect } from "vitest";
import { filterTrackerRows } from "../scripts/logic/secrets-tracker.mjs";

const GROUPS = [{ id: "g1", name: "A", members: ["u2"] }];
const ROWS = [
  { kind: "block", entryUuid: "U.a", entryName: "A", entryType: "person", secretId: "s1", preview: "p1", audience: { users: ["u1"], groups: [], all: false }, revealedAll: false },
  { kind: "block", entryUuid: "U.a", entryName: "A", entryType: "person", secretId: "s2", preview: "p2", audience: null, revealedAll: true },
  { kind: "session", entryUuid: "U.s", entryName: "S", entryType: "session", secretId: "c1", preview: "clue", audience: { users: [], groups: ["g1"], all: false }, revealedAll: false },
  { kind: "relationship", entryUuid: "U.r", entryName: "R", entryType: "person", secretId: "r1", preview: "rel", audience: null, revealedAll: false }
];

describe("filterTrackerRows", () => {
  it("no filters returns everything", () => {
    expect(filterTrackerRows(ROWS, {})).toHaveLength(4);
  });
  it("type filter matches entryType", () => {
    expect(filterTrackerRows(ROWS, { type: "session" })).toHaveLength(1);
  });
  it("state revealed/unrevealed", () => {
    expect(filterTrackerRows(ROWS, { state: "revealed" }).map((r) => r.secretId).sort()).toEqual(["c1", "s1", "s2"]);
    expect(filterTrackerRows(ROWS, { state: "unrevealed" }).map((r) => r.secretId)).toEqual(["r1"]);
  });
  it("what does player X know: direct, group (live), and revealed-to-all", () => {
    expect(filterTrackerRows(ROWS, { playerId: "u1", groups: GROUPS }).map((r) => r.secretId).sort()).toEqual(["s1", "s2"]);
    expect(filterTrackerRows(ROWS, { playerId: "u2", groups: GROUPS }).map((r) => r.secretId).sort()).toEqual(["c1", "s2"]);
  });
  it("passes a row's pageUuid through untouched", () => {
    const row = { entryType: "place", audience: { users: ["u1"] }, revealedAll: false, pageUuid: "JournalEntry.e.JournalEntryPage.p" };
    expect(filterTrackerRows([row], {})[0].pageUuid).toBe("JournalEntry.e.JournalEntryPage.p");
  });
});
