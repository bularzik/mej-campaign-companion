import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasCalendar, getCalendarMonths, calendarBounds, formatCampaignDate, currentWorldComponents
} from "../scripts/logic/campaign-calendar.mjs";

function stubCalendar() {
  vi.stubGlobal("game", {
    i18n: { localize: (k) => k.replace("MONTH.", "") },
    time: {
      calendar: {
        timeToComponents: () => ({}),
        months: { values: [
          { name: "MONTH.Hammer", days: 30 },
          { name: "MONTH.Alturiak", days: 30 },
          { name: "MONTH.Ches", days: 30 }
        ] },
        days: { hoursPerDay: 24, minutesPerHour: 60 }
      }
    }
  });
}

describe("campaign-calendar with a calendar present", () => {
  beforeEach(stubCalendar);
  afterEach(() => vi.unstubAllGlobals());

  it("detects the calendar", () => {
    expect(hasCalendar()).toBe(true);
  });

  it("lists localized months with 0-based indices", () => {
    expect(getCalendarMonths()).toEqual([
      { index: 0, name: "Hammer", days: 30 },
      { index: 1, name: "Alturiak", days: 30 },
      { index: 2, name: "Ches", days: 30 }
    ]);
  });

  it("reports bounds from the calendar", () => {
    expect(calendarBounds()).toEqual({
      monthCount: 3, monthDayCounts: [30, 30, 30], hoursPerDay: 24, minutesPerHour: 60
    });
  });

  it("formats a campaign date with the localized month name", () => {
    expect(formatCampaignDate({ year: 1492, month: 1, day: 15, hour: null, minute: null }))
      .toBe("Alturiak 15, 1492");
    expect(formatCampaignDate(null)).toBe("");
  });
});

describe("campaign-calendar with no calendar", () => {
  beforeEach(() => vi.stubGlobal("game", { i18n: { localize: (k) => k }, time: {} }));
  afterEach(() => vi.unstubAllGlobals());

  it("reports absence and empty months, with default bounds", () => {
    expect(hasCalendar()).toBe(false);
    expect(getCalendarMonths()).toEqual([]);
    expect(calendarBounds()).toEqual({
      monthCount: 12, monthDayCounts: [], hoursPerDay: 24, minutesPerHour: 60
    });
  });
});

describe("currentWorldComponents", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the current world time to dialog-ready components", () => {
    const timeToComponents = vi.fn(() => ({
      year: 1492, month: 1, dayOfMonth: 14, day: 44, hour: 9, minute: 30, second: 0
    }));
    vi.stubGlobal("game", {
      time: {
        worldTime: 123456,
        calendar: {
          timeToComponents,
          months: { values: [] },
          days: { hoursPerDay: 24, minutesPerHour: 60 }
        }
      }
    });
    expect(currentWorldComponents()).toEqual({ year: 1492, month: 1, day: 15, hour: 9, minute: 30 });
    expect(timeToComponents).toHaveBeenCalledWith(123456);
  });

  it("returns null when no calendar is available", () => {
    vi.stubGlobal("game", { time: {} });
    expect(currentWorldComponents()).toBe(null);
  });
});
