import { formatComponentsFallback } from "./campaign-date.mjs";

/** The active in-world calendar, or null on pre-v13 cores / when unavailable. */
function calendar() {
  const cal = game.time?.calendar;
  return cal && typeof cal.timeToComponents === "function" ? cal : null;
}

export function hasCalendar() {
  return calendar() != null;
}

/** Localized months with 0-based indices; [] when no calendar. */
export function getCalendarMonths() {
  const cal = calendar();
  if (!cal) return [];
  return cal.months.values.map((m, index) => ({
    index,
    name: game.i18n.localize(m.name),
    days: m.leapDays ?? m.days
  }));
}

/** Validation bounds for campaign-date entry; safe defaults when no calendar. */
export function calendarBounds() {
  const cal = calendar();
  const days = cal?.days ?? {};
  return {
    monthCount: cal ? cal.months.values.length : 12,
    monthDayCounts: cal ? cal.months.values.map((m) => m.leapDays ?? m.days) : [],
    hoursPerDay: days.hoursPerDay ?? 24,
    minutesPerHour: days.minutesPerHour ?? 60
  };
}

/**
 * Build the Session sheet campaign-date field's month <select> options. The module's
 * storage contract is a 0-based month (see this file's own getCalendarMonths() and
 * currentWorldComponents() doc comments) - templates/session.hbs used to bind a raw
 * `min="1" max="12"` number input directly to the flag, so a value typed as "6" (June,
 * human-facing) was stored as literal 6 (July, per the 0-based contract), a silent
 * off-by-one that also disagreed with the Hub's own #promptTimepoint dialog
 * (CampaignHubPage.mjs), which has always built its month <select> from this same
 * 0-based getCalendarMonths() index. Every option's `value` here is 0-based, whether or
 * not a calendar is active, so there is no conversion step left for the caller - the
 * select's submitted value IS the stored value.
 * Pure/testable: takes getCalendarMonths()'s own output rather than calling it directly.
 * @param {{index:number, name:string}[]} months getCalendarMonths() output ([] when no calendar)
 * @returns {{value:number, label:string}[]}
 */
export function sessionMonthOptions(months) {
  if (months.length) return months.map((m) => ({ value: m.index, label: m.name }));
  // No active calendar: fall back to a generic 12-month list, still 0-based, matching
  // formatCampaignDate's own "Month N" (N = month + 1) fallback display convention below.
  return Array.from({ length: 12 }, (_, i) => ({ value: i, label: `Month ${i + 1}` }));
}

/** Localized in-world date label for stored components; "" when unset. */
export function formatCampaignDate(components) {
  if (!components) return "";
  const monthName = getCalendarMonths()[components.month]?.name ?? `Month ${components.month + 1}`;
  return formatComponentsFallback(components, monthName);
}

/**
 * The current world time as stored campaign-date components (0-based month,
 * 1-based day), for prefilling new timepoints; null when no calendar.
 */
export function currentWorldComponents() {
  const cal = calendar();
  if (!cal) return null;
  const c = cal.timeToComponents(game.time.worldTime);
  return {
    year: c.year,
    month: c.month ?? 0,
    day: (c.dayOfMonth ?? 0) + 1,
    hour: c.hour ?? 0,
    minute: c.minute ?? 0
  };
}
