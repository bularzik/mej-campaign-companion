import { describe, it, expect } from "vitest";
import { sessionStatus, startStamp, endStamp, sessionButton, elapsedLabel, hasEnteredDate } from "../scripts/logic/session-state.mjs";

const P = "flags.mej-campaign-companion.session.";

describe("sessionStatus", () => {
  it("current wins over everything", () => expect(sessionStatus({ isCurrent: true, endedAt: 5 })).toBe("live"));
  it("stamped pages", () => expect(sessionStatus({ startedAt: 1, endedAt: null, isCurrent: false })).toBe("ended"));
  it("legacy page with table talk or recap is ended", () => {
    expect(sessionStatus({ hasTableTalk: true })).toBe("ended");
    expect(sessionStatus({ recap: "<p>Trapped in Vega's cavern</p>" })).toBe("ended");
  });
  it("an image-only recap counts as a recap", () => expect(sessionStatus({ recap: '<p><img src="a.webp"></p>' })).toBe("ended"));
  it("empty recap markup is not a recap", () => expect(sessionStatus({ recap: "<p></p>" })).toBe("notStarted"));
  it("nothing at all is notStarted", () => expect(sessionStatus({})).toBe("notStarted"));
});

describe("startStamp", () => {
  it("first start stamps time and world date", () => {
    const u = startStamp({ startedAt: null, campaignDate: null }, { now: 100, worldDate: { year: 1492, month: 5, day: 14, hour: 20, minute: 0 } });
    expect(u[`${P}startedAt`]).toBe(100);
    expect(u[`${P}campaignDate`]).toEqual({ year: 1492, month: 5, day: 14, hour: 20, minute: 0 });
    expect(u[`${P}endedAt`]).toBeNull();
  });
  it("a hand-entered date is kept", () => {
    const u = startStamp({ startedAt: null, campaignDate: { year: 3 } }, { now: 1, worldDate: { year: 1492 } });
    expect(u).not.toHaveProperty(`${P}campaignDate`);
  });
  it("restart changes neither startedAt nor the date", () => {
    const u = startStamp({ startedAt: 50, campaignDate: null }, { now: 100, worldDate: { year: 1492 } });
    expect(Object.keys(u)).toEqual([`${P}endedAt`]);
  });
  it("a date whose submitted fields are all empty counts as not entered", () => {
    const empty = { year: null, month: "", day: undefined, hour: null, minute: null };
    const u = startStamp({ startedAt: null, campaignDate: empty }, { now: 1, worldDate: { year: 1492, month: 5, day: 14, hour: 20, minute: 0 } });
    expect(u[`${P}campaignDate`]).toEqual({ year: 1492, month: 5, day: 14, hour: 20, minute: 0 });
  });
  it("no calendar leaves the date alone", () => {
    expect(startStamp({ startedAt: null, campaignDate: null }, { now: 1, worldDate: null })).not.toHaveProperty(`${P}campaignDate`);
  });
});

describe("endStamp", () => {
  it("stamps endedAt", () => expect(endStamp({ now: 9 })).toEqual({ [`${P}endedAt`]: 9 }));
});

describe("sessionButton", () => {
  it("button", () => {
    expect(sessionButton("live", true)).toEqual({ action: "endSession", labelKey: "MEJCampaignCompanion.session.end" });
    expect(sessionButton("ended", true)).toEqual({ action: "startSession", labelKey: "MEJCampaignCompanion.session.restart" });
    expect(sessionButton("notStarted", true)).toEqual({ action: "startSession", labelKey: "MEJCampaignCompanion.session.start" });
    expect(sessionButton("notStarted", false)).toBeNull();
  });
});

describe("elapsedLabel", () => {
  it("elapsed", () => {
    expect(elapsedLabel(30_000)).toBe("<1m");
    expect(elapsedLabel(42 * 60_000)).toBe("42m");
    expect(elapsedLabel(70 * 60_000)).toBe("1h 10m");
  });
});

describe("hasEnteredDate", () => {
  it("null, empty object and blank fields are not entered", () => {
    expect(hasEnteredDate(null)).toBe(false);
    expect(hasEnteredDate({})).toBe(false);
    expect(hasEnteredDate({ year: "", month: null, day: NaN, hour: 4 })).toBe(false);
  });
  it("any of year, month or day makes it entered (month 0 included)", () => {
    expect(hasEnteredDate({ year: 3 })).toBe(true);
    expect(hasEnteredDate({ month: 0 })).toBe(true);
    expect(hasEnteredDate({ day: "12" })).toBe(true);
  });
});
