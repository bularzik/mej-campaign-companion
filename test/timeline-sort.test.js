import { describe, it, expect } from "vitest";
import { SORT_GAP, sortKeyBetween, sortTimepoints, orderTimepoints } from "../scripts/logic/timeline-sort.mjs";

describe("sortKeyBetween", () => {
  it("returns 0 for an empty timeline", () => {
    expect(sortKeyBetween(null, null)).toBe(0);
  });

  it("appends after the last key with a full gap", () => {
    expect(sortKeyBetween(300000, null)).toBe(300000 + SORT_GAP);
  });

  it("prepends before the first key with a full gap", () => {
    expect(sortKeyBetween(null, 0)).toBe(-SORT_GAP);
  });

  it("bisects two neighbors", () => {
    expect(sortKeyBetween(0, 100000)).toBe(50000);
    expect(sortKeyBetween(50000, 100000)).toBe(75000);
  });

  it("repeated insertion between the same neighbors keeps strict ordering", () => {
    let low = 0;
    const high = SORT_GAP;
    for (let i = 0; i < 20; i++) {
      const mid = sortKeyBetween(low, high);
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      low = mid;
    }
  });
});

describe("sortTimepoints", () => {
  it("sorts by sort key, then label, without mutating the input", () => {
    const input = [
      { id: "c", label: "Gamma", sort: 200000 },
      { id: "a", label: "Alpha", sort: 100000 },
      { id: "b", label: "Beta", sort: 100000 }
    ];
    const copy = [...input];
    const sorted = sortTimepoints(input);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(input).toEqual(copy);
  });
});

describe("orderTimepoints", () => {
  const tps = [
    { id: "a", label: "A", sort: 300000, createdAt: 30, campaignDate: { year: 1492, month: 6, day: 20, hour: null, minute: null } },
    { id: "b", label: "B", sort: 100000, createdAt: 10, campaignDate: null },
    { id: "c", label: "C", sort: 200000, createdAt: 20, campaignDate: { year: 1492, month: 6, day: 15, hour: null, minute: null } }
  ];

  it("manual mode preserves sort-key order", () => {
    expect(orderTimepoints(tps, "manual").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("created mode orders by createdAt ascending, tie-broken by sort key", () => {
    const tie = [
      { id: "x", label: "X", sort: 200000, createdAt: 5, campaignDate: null },
      { id: "y", label: "Y", sort: 100000, createdAt: 5, campaignDate: null }
    ];
    expect(orderTimepoints(tie, "created").map((t) => t.id)).toEqual(["y", "x"]);
    expect(orderTimepoints(tps, "created").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("campaign mode floats undated to the top (by createdAt), then dated ascending", () => {
    expect(orderTimepoints(tps, "campaign").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate its input", () => {
    const copy = tps.map((t) => ({ ...t }));
    orderTimepoints(tps, "campaign");
    expect(tps).toEqual(copy);
  });

  it("campaign mode orders multiple undated timepoints among themselves by createdAt, before dated ones", () => {
    const mixed = [
      { id: "dated", label: "Dated", sort: 100000, createdAt: 15, campaignDate: { year: 1492, month: 6, day: 20, hour: null, minute: null } },
      { id: "undated-late", label: "Undated Late", sort: 200000, createdAt: 40, campaignDate: null },
      { id: "undated-early", label: "Undated Early", sort: 300000, createdAt: 5, campaignDate: null }
    ];
    expect(orderTimepoints(mixed, "campaign").map((t) => t.id)).toEqual(["undated-early", "undated-late", "dated"]);
  });
});
