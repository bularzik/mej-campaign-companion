// Pure reporting for failed retro-link writes (spec 2026-09-19 §5.3, A2).
const I18N = "MEJCampaignCompanion";

/** First line of an error's message, capped, never empty. */
export function describeError(err) {
  const text = typeof err === "string" ? err : err?.message;
  const line = String(text ?? "").split("\n")[0].trim();
  return (line || "unknown error").slice(0, 160);
}

/**
 * One message naming each failed journal once with the reason.
 * @param {Array<{page:string, journal:string, reason:string}>} failures
 * @param {(key:string, data:object)=>string} format
 */
export function retroFailureMessage(failures, format) {
  const byJournal = new Map();
  for (const f of failures) if (!byJournal.has(f.journal)) byJournal.set(f.journal, f.reason);
  const list = [...byJournal].map(([journal, reason]) => `${journal} (${reason})`).join("; ");
  return format(`${I18N}.retroLink.writeFailedDetail`, { count: failures.length, list });
}
