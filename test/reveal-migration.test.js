import { describe, it, expect } from "vitest";
import { planNativeRevealMigration, planPageKeyedMigration } from "../scripts/logic/reveal-migration.mjs";

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

  it("requires all === true, not merely a truthy all value", () => {
    // String "yes" is truthy but not `true`
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-a": { all: "yes" } }, sectionIds: ["secret-a"]
    })])).toEqual([]);
    // Number 1 is truthy but not `true`
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-b": { all: 1 } }, sectionIds: ["secret-b"]
    })])).toEqual([]);
    // Empty object is truthy but not `true`
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-c": { all: {} } }, sectionIds: ["secret-c"]
    })])).toEqual([]);
    // Only strict `true` should plan
    expect(planNativeRevealMigration([entry({
      reveals: { "secret-d": { all: true } }, sectionIds: ["secret-d"]
    })]).length).toBe(1);
  });
});

const AUD = { users: ["u1"], groups: [], all: false, revealedAt: 1 };
const pk = (over = {}) => ({ entryUuid: "JournalEntry.e1", reveals: {}, pages: [], ...over });
const pg = (pageUuid, sectionIds = [], existing = {}) => ({ pageUuid, sectionIds, existing });

describe("planPageKeyedMigration", () => {
  it("copies a record to the one page holding its section", () => {
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD }, pages: [pg("P1", ["secret-a"])]
    })])).toEqual({ steps: [{ pageUuid: "P1", reveals: { "secret-a": AUD } }], dropped: [] });
  });

  it("copies a record to EVERY page holding a duplicate id", () => {
    const { steps } = planPageKeyedMigration([pk({
      reveals: { "secret-dup": AUD }, pages: [pg("P1", ["secret-dup"]), pg("P2", ["secret-dup"])]
    })]);
    expect(steps).toEqual([
      { pageUuid: "P1", reveals: { "secret-dup": AUD } },
      { pageUuid: "P2", reveals: { "secret-dup": AUD } }
    ]);
  });

  it("drops an id found on no page, naming entry and id", () => {
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-gone": AUD }, pages: [pg("P1", ["secret-a"])]
    })])).toEqual({ steps: [], dropped: [{ entryUuid: "JournalEntry.e1", sectionId: "secret-gone" }] });
  });

  it("skips ids the page already holds; a second pass plans nothing", () => {
    const first = planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD, "secret-b": AUD },
      pages: [pg("P1", ["secret-a", "secret-b"], { "secret-a": { users: ["u9"], groups: [], all: false, revealedAt: 5 } })]
    })]);
    expect(first.steps).toEqual([{ pageUuid: "P1", reveals: { "secret-b": AUD } }]);
    const second = planPageKeyedMigration([pk({
      reveals: { "secret-a": AUD, "secret-b": AUD },
      pages: [pg("P1", ["secret-a", "secret-b"], { "secret-a": AUD, "secret-b": AUD })]
    })]);
    expect(second).toEqual({ steps: [], dropped: [] });
  });

  it("copies a legacy all:true record verbatim", () => {
    const legacy = { users: [], groups: [], all: true, revealedAt: 2 };
    expect(planPageKeyedMigration([pk({
      reveals: { "secret-a": legacy }, pages: [pg("P1", ["secret-a"])]
    })]).steps[0].reveals["secret-a"]).toEqual(legacy);
  });

  it("plans nothing for an entry without reveals or a page ending empty", () => {
    expect(planPageKeyedMigration([pk({ pages: [pg("P1", ["secret-a"])] }), pk({ entryUuid: "JournalEntry.e2" })]))
      .toEqual({ steps: [], dropped: [] });
  });

  it("tolerates junk without throwing", () => {
    expect(() => planPageKeyedMigration([null, {}, pk({ reveals: "junk", pages: [null, { pageUuid: "P1" }] })])).not.toThrow();
    expect(planPageKeyedMigration(null)).toEqual({ steps: [], dropped: [] });
  });
});
