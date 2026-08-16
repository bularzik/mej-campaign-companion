/**
 * Order-preserving numeric key for a campaign date's components, or null when
 * unset. month/day/hour/minute stay < 100 for every shipped calendar, so this
 * needs no calendar month-length math. Missing time sorts as midnight.
 */
export function campaignSortKey(campaignDate) {
  if (!campaignDate) return null;
  const { year, month, day, hour, minute } = campaignDate;
  return ((((year * 100) + month) * 100) + day) * 10000 + ((hour ?? 0) * 100 + (minute ?? 0));
}

/**
 * Validate raw modal inputs into campaign-date components, or null when blank.
 * Returns { components, error } where error is an i18n key or null. bounds:
 * { monthCount, monthDayCounts[], hoursPerDay, minutesPerHour }.
 */
export function parseCampaignDateInput(raw, bounds) {
  const y = (raw.year ?? "").trim();
  const m = (raw.month ?? "").trim();
  const d = (raw.day ?? "").trim();
  const t = (raw.time ?? "").trim();

  if (!y && !m && !d) return { components: null, error: null };
  if (!y || !m || !d) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDatePartial" };

  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year)) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadYear" };
  if (!Number.isInteger(month) || month < 0 || month >= bounds.monthCount) {
    return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadMonth" };
  }
  const maxDay = bounds.monthDayCounts[month] ?? 31;
  if (!Number.isInteger(day) || day < 1 || day > maxDay) {
    return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadDay" };
  }

  let hour = null;
  let minute = null;
  if (t) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!match) return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadTime" };
    hour = Number(match[1]);
    minute = Number(match[2]);
    if (hour < 0 || hour >= bounds.hoursPerDay || minute < 0 || minute >= bounds.minutesPerHour) {
      return { components: null, error: "CAMPAIGNRECORD.Hub.CampaignDateBadTime" };
    }
  }
  return { components: { year, month, day, hour, minute }, error: null };
}

/** In-world date label built from components + a resolved month name. */
export function formatComponentsFallback(components, monthName) {
  if (!components) return "";
  const time = components.hour != null
    ? ` ${String(components.hour).padStart(2, "0")}:${String(components.minute ?? 0).padStart(2, "0")}`
    : "";
  return `${monthName} ${components.day}, ${components.year}${time}`;
}

/** Real-world create date as a short locale date; "" when unset. */
export function formatCreateDate(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString() : "";
}
