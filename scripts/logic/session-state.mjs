// Session status, start/end stamps and header button rules. Pure.
const P = "flags.mej-campaign-companion.session.";

export function hasVisibleText(html) {
  if (!html) return false;
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").trim().length > 0;
}

/** "live" | "ended" | "notStarted". `isCurrent` wins; stamps and legacy content mean ended. */
export function sessionStatus({ startedAt, endedAt, isCurrent, hasTableTalk, recap } = {}) {
  if (isCurrent) return "live";
  if (startedAt || endedAt) return "ended";
  if (hasTableTalk || hasVisibleText(recap)) return "ended";
  return "notStarted";
}

const blank = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));

/**
 * True when a GM has entered an in-game date. MEJ's submit-on-change sends all
 * five date inputs, so a page whose date was never typed into can still hold an
 * object of empty values; only a year, month or day counts as entered.
 */
export function hasEnteredDate(date) {
  if (!date || typeof date !== "object") return false;
  return !blank(date.year) || !blank(date.month) || !blank(date.day);
}

/** Flag-path update applied when a session is started (or restarted). */
export function startStamp(session, { now, worldDate }) {
  const update = {};
  const first = session.startedAt == null;
  if (first) {
    update[`${P}startedAt`] = now;
    if (!hasEnteredDate(session.campaignDate) && worldDate != null) update[`${P}campaignDate`] = worldDate;
  }
  update[`${P}endedAt`] = null;
  return update;
}

export function endStamp({ now }) {
  return { [`${P}endedAt`]: now };
}

export function sessionButton(status, isGM) {
  if (!isGM) return null;
  if (status === "live") return { action: "endSession", labelKey: "MEJCampaignCompanion.session.end" };
  const labelKey = status === "ended" ? "MEJCampaignCompanion.session.restart" : "MEJCampaignCompanion.session.start";
  return { action: "startSession", labelKey };
}

export function elapsedLabel(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
