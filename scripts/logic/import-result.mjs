// Import summary for the toasts (spec rule: no decision → no dialog). The
// info line always shows; `issues` is null when nothing failed or warned.
import { I18N } from "../constants.mjs";

/**
 * @param {{created: number, timepoints: number, failed: string[]}} results
 * @param {string[]} warnings
 * @param {number} linkedCount
 * @param {(key: string, data?: object) => string} format localizer (game.i18n.format in production)
 * @returns {{ info: string, issues: { message: string, failed: string[], warnings: string[] } | null }}
 */
export function importResultMessages(results, warnings, linkedCount, format) {
  const data = { pages: results?.created ?? 0, timepoints: results?.timepoints ?? 0, links: linkedCount ?? 0 };
  const info = format(`${I18N}.import.${data.links > 0 ? "resultSummaryLinked" : "resultSummary"}`, data);
  const failed = results?.failed ?? [];
  const warns = warnings ?? [];
  if (!failed.length && !warns.length) return { info, issues: null };
  const message = format(`${I18N}.import.resultIssues`, { failed: failed.length, warnings: warns.length });
  return { info, issues: { message, failed: [...failed], warnings: [...warns] } };
}
