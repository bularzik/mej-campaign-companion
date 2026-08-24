import { describe, it, expect } from "vitest";
import { orderTimelines, resolveDefaultTimelineId, partitionTimelines } from "../scripts/logic/timelines.mjs";

const tl = (id, name) => ({ id, name });

describe("orderTimelines", () => {
  it("puts the default first, then name-sorts the rest", () => {
    const list = [tl("a", "Zed"), tl("b", "Mid"), tl("c", "Apex")];
    expect(orderTimelines(list, "b").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
  it("name-sorts everything when the default is absent or unknown", () => {
    const list = [tl("a", "Zed"), tl("c", "Apex")];
    expect(orderTimelines(list, null).map((t) => t.id)).toEqual(["c", "a"]);
    expect(orderTimelines(list, "gone").map((t) => t.id)).toEqual(["c", "a"]);
  });
  it("returns a new array and tolerates empty/nullish input", () => {
    const list = [tl("a", "A")];
    expect(orderTimelines(list, "a")).not.toBe(list);
    expect(orderTimelines([], "x")).toEqual([]);
    expect(orderTimelines(null, null)).toEqual([]);
  });
});

describe("resolveDefaultTimelineId", () => {
  const list = [tl("first", "Zed"), tl("second", "Apex")];
  it("honors a flag id that names one of the timelines", () => {
    expect(resolveDefaultTimelineId(list, "second")).toBe("second");
  });
  it("falls back to the FIRST element as given (creation order), not name order", () => {
    expect(resolveDefaultTimelineId(list, null)).toBe("first");
    expect(resolveDefaultTimelineId(list, "stale")).toBe("first");
  });
  it("returns null for an empty or nullish list", () => {
    expect(resolveDefaultTimelineId([], "x")).toBe(null);
    expect(resolveDefaultTimelineId(null, null)).toBe(null);
  });
});

describe("partitionTimelines", () => {
  const campaignIdOf = (e) => e.campaignId ?? null;
  const entry = (id, campaignId) => ({ id, name: id, campaignId });
  it("groups by campaign and buckets campaign-less timelines as world", () => {
    const { byCampaign, world } = partitionTimelines(
      [entry("t1", "c1"), entry("t2", "c1"), entry("t3", null), entry("t4", "c2")], campaignIdOf);
    expect(byCampaign.get("c1").map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(byCampaign.get("c2").map((t) => t.id)).toEqual(["t4"]);
    expect(world.map((t) => t.id)).toEqual(["t3"]);
  });
  it("returns empty structures for no input", () => {
    const { byCampaign, world } = partitionTimelines([], campaignIdOf);
    expect(byCampaign.size).toBe(0);
    expect(world).toEqual([]);
  });
  it("preserves input order within each bucket", () => {
    const { byCampaign } = partitionTimelines([entry("b", "c1"), entry("a", "c1")], campaignIdOf);
    expect(byCampaign.get("c1").map((t) => t.id)).toEqual(["b", "a"]);
  });
});
