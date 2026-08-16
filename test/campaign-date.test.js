import { describe, it, expect } from "vitest";
import {
  campaignSortKey, parseCampaignDateInput, formatComponentsFallback, formatCreateDate
} from "../scripts/logic/campaign-date.mjs";

const BOUNDS = { monthCount: 12, monthDayCounts: [31,28,31,30,31,30,31,31,30,31,30,31], hoursPerDay: 24, minutesPerHour: 60 };

describe("campaignSortKey", () => {
  it("returns null when the campaign date is unset", () => {
    expect(campaignSortKey(null)).toBe(null);
    expect(campaignSortKey(undefined)).toBe(null);
  });

  it("orders by year, then month, then day, then time", () => {
    const k = (d) => campaignSortKey(d);
    const base = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    expect(k({ ...base, year: 1491 })).toBeLessThan(k(base));
    expect(k({ ...base, month: 5 })).toBeLessThan(k(base));
    expect(k({ ...base, day: 14 })).toBeLessThan(k(base));
    expect(k({ ...base, hour: 9, minute: 0 })).toBeGreaterThan(k(base));
    expect(k({ ...base, hour: 9, minute: 5 })).toBeGreaterThan(k({ ...base, hour: 9, minute: 0 }));
  });

  it("treats missing time as midnight for ordering", () => {
    const noTime = { year: 1492, month: 6, day: 15, hour: null, minute: null };
    const midnight = { year: 1492, month: 6, day: 15, hour: 0, minute: 0 };
    expect(campaignSortKey(noTime)).toBe(campaignSortKey(midnight));
  });

  it("handles negative (pre-epoch) years monotonically", () => {
    const a = { year: -5, month: 0, day: 1, hour: null, minute: null };
    const b = { year: -4, month: 0, day: 1, hour: null, minute: null };
    expect(campaignSortKey(a)).toBeLessThan(campaignSortKey(b));
  });
});

describe("parseCampaignDateInput", () => {
  it("returns unset (null components, no error) when year/month/day all blank", () => {
    expect(parseCampaignDateInput({ year: "", month: "", day: "", time: "" }, BOUNDS))
      .toEqual({ components: null, error: null });
  });

  it("errors when the date is partially filled", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "6", day: "", time: "" }, BOUNDS);
    expect(r.components).toBe(null);
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDatePartial");
  });

  it("parses a full date with no time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "6", day: "15", time: "" }, BOUNDS))
      .toEqual({ components: { year: 1492, month: 6, day: 15, hour: null, minute: null }, error: null });
  });

  it("parses a full date with time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "6", day: "15", time: "14:30" }, BOUNDS))
      .toEqual({ components: { year: 1492, month: 6, day: 15, hour: 14, minute: 30 }, error: null });
  });

  it("rejects a day beyond the selected month's length", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "1", day: "30", time: "" }, BOUNDS); // Feb=28
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDateBadDay");
  });

  it("rejects an out-of-range month", () => {
    const r = parseCampaignDateInput({ year: "1492", month: "12", day: "1", time: "" }, BOUNDS);
    expect(r.error).toBe("CAMPAIGNRECORD.Hub.CampaignDateBadMonth");
  });

  it("rejects malformed or out-of-range time", () => {
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "9am" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "24:00" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
    expect(parseCampaignDateInput({ year: "1492", month: "0", day: "1", time: "12:60" }, BOUNDS).error)
      .toBe("CAMPAIGNRECORD.Hub.CampaignDateBadTime");
  });
});

describe("formatComponentsFallback", () => {
  it("builds a name/day/year string, appending time when set", () => {
    expect(formatComponentsFallback({ year: 1492, month: 6, day: 15, hour: null, minute: null }, "Flamerule"))
      .toBe("Flamerule 15, 1492");
    expect(formatComponentsFallback({ year: 1492, month: 6, day: 15, hour: 14, minute: 5 }, "Flamerule"))
      .toBe("Flamerule 15, 1492 14:05");
  });
});

describe("formatCreateDate", () => {
  it("returns a non-empty string for a timestamp and empty for non-numbers", () => {
    expect(formatCreateDate(1_700_000_000_000)).not.toBe("");
    expect(formatCreateDate(null)).toBe("");
    expect(formatCreateDate(undefined)).toBe("");
  });
});
