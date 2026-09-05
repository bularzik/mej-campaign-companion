// dataVersion 6 (spec 2026-09-04 §C): per-player recaps fold into the
// shared session recap as attributed blocks. Pure - the ready-time runner
// in campaign-companion.mjs resolves user names and writes the page.
import { escapeHtml } from "./html-escape.mjs";

/** No visible text once tags and non-breaking spaces are stripped. */
function isBlank(html) {
  if (typeof html !== "string") return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

/**
 * @param {string} recapHtml current `system.recap`
 * @param {Array<{name: string, html: unknown}>} entries one per legacy playerRecaps key
 * @returns {{ recap: string, folded: number }}
 */
export function foldPlayerRecaps(recapHtml, entries) {
  const base = recapHtml ?? "";
  const kept = (entries ?? [])
    .filter((e) => !isBlank(e?.html))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (!kept.length) return { recap: base, folded: 0 };
  const blocks = kept.map((e) => `<h3>Recap — ${escapeHtml(e.name)}</h3>${e.html}`);
  return { recap: `${base}${blocks.join("")}`, folded: kept.length };
}
