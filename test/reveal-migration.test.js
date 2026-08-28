import { describe, it, expect } from "vitest";
import { planNativeRevealMigration } from "../scripts/logic/reveal-migration.mjs";

const entry = (over = {}) => ({
  entryUuid: "JournalEntry.e1", pageUuid: "JournalEntry.e1.JournalEntryPage.p1",
  bodyKey: "text.content", reveals: {}, sectionIds: [], ...over
});

describe("planNativeRevealMigration", () => {
  it("plans a record revealed to everyone whose section still exists", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: true } }, sectionIds: ["secret-a"]
    })])).toEqual([{
      entryUuid: "JournalEntry.e1", pageUuid: "JournalEntry.e1.JournalEntryPage.p1",
      bodyKey: "text.content", sectionIds: ["secret-a"]
    }]);
  });

  it("ignores per-user and per-group audiences", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { users: ["u1"] }, "secret-b": { groups: ["g1"] } },
      sectionIds: ["secret-a", "secret-b"]
    })])).toEqual([]);
  });

  it("omits ids whose section is no longer in the body, keeping the rest", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: true }, "secret-gone": { all: true } },
      sectionIds: ["secret-a"]
    })])[0].sectionIds).toEqual(["secret-a"]);
  });

  it("plans nothing for an entry whose only all-records are missing sections", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-gone": { all: true } }, sectionIds: ["secret-a"]
    })])).toEqual([]);
  });

  it("plans nothing on a second pass, once all is cleared", () => {
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: false, users: ["u1"] } }, sectionIds: ["secret-a"]
    })])).toEqual([]);
  });

  it("keeps entries separate and skips empty input", () => {
    const plan = planNativeRevealMigration([
      entry({ reveals: { "secret-a": { all: true } }, sectionIds: ["secret-a"] }),
      entry({ entryUuid: "JournalEntry.e2", pageUuid: "JournalEntry.e2.JournalEntryPage.p2",
              bodyKey: "system.recap", reveals: { "secret-b": { all: true } }, sectionIds: ["secret-b"] })
    ]);
    expect(plan).toHaveLength(2);
    expect(plan[1]).toEqual({
      entryUuid: "JournalEntry.e2", pageUuid: "JournalEntry.e2.JournalEntryPage.p2",
      bodyKey: "system.recap", sectionIds: ["secret-b"]
    });
    expect(planNativeRevealMigration([])).toEqual([]);
    expect(planNativeRevealMigration(null)).toEqual([]);
  });

  it("tolerates junk records rather than throwing during a world load", () => {
    expect(planNativeRevealMigration([entry({ reveals: { a: null, b: 7 }, sectionIds: ["a"] })])).toEqual([]);
    expect(planNativeRevealMigration([null, undefined])).toEqual([]);
  });
});
