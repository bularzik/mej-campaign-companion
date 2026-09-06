import { describe, it, expect } from "vitest";
import { planCampaignStructure } from "../scripts/logic/campaign-migration.mjs";

const folder = (id, { isCampaign = true, hasTimeline = false } = {}) => ({ id, isCampaign, hasTimeline });
const entry = (id, { pageCount = 1, stray = false, inCampaign = false } = {}) =>
  ({ id, uuid: `JournalEntry.${id}`, pageCount, strayCampaignPage: stray, inCampaign });

describe("planCampaignStructure (spec 2026-09-06 §4)", () => {
  it("backfills a timeline only for campaign folders lacking one", () => {
    const plan = planCampaignStructure({
      folders: [folder("a"), folder("b", { hasTimeline: true }), folder("c", { isCampaign: false })],
      entries: []
    });
    expect(plan.timelineFor).toEqual(["a"]);
  });
  it("upgrades a loose single-page stray", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e1", { stray: true })] });
    expect(plan.upgrade).toEqual(["e1"]);
    expect(plan.skipped).toEqual([]);
  });
  it("skips a multipage stray with reason 'multipage'", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e2", { stray: true, pageCount: 2 })] });
    expect(plan.upgrade).toEqual([]);
    expect(plan.skipped).toEqual([{ uuid: "JournalEntry.e2", reason: "multipage" }]);
  });
  it("skips a stray inside a campaign with reason 'in-campaign' (checked before page count)", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e3", { stray: true, pageCount: 2, inCampaign: true })] });
    expect(plan.skipped).toEqual([{ uuid: "JournalEntry.e3", reason: "in-campaign" }]);
  });
  it("ignores non-stray entries and preserves input order", () => {
    const plan = planCampaignStructure({
      folders: [],
      entries: [entry("x"), entry("e5", { stray: true }), entry("e4", { stray: true })]
    });
    expect(plan.upgrade).toEqual(["e5", "e4"]);
  });
  it("tolerates missing inputs", () => {
    expect(planCampaignStructure({})).toEqual({ timelineFor: [], upgrade: [], skipped: [] });
  });
});
