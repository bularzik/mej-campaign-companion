/**
 * Pure run-shaping helpers for the docx export (scripts/apps/export-dialog.mjs).
 * Extracted so the <br>-handling rules (documented on export-dialog.mjs's
 * toRuns) are unit-testable without the vendored docx bundle.
 */

/**
 * Split a doc-model run's text on "\n" into docx-ready segments.
 * Segments after the first carry `lineBreak: true` (a break BEFORE the
 * text); an empty FIRST segment is dropped, so "\n" yields exactly one
 * empty-text breaking segment.
 * @param {string} text
 * @returns {{text: string, lineBreak: boolean}[]}
 */
export function segmentRunText(text) {
  return String(text ?? "").split("\n")
    .map((seg, i) => (i === 0 ? (seg ? { text: seg, lineBreak: false } : null) : { text: seg, lineBreak: true }))
    .filter(Boolean);
}

/** Subtitle paragraphs render italic ("IntenseQuote" is absent from the vendored docx build). */
export function subtitleRuns(node) {
  return node.style === "subtitle" ? node.runs.map((r) => ({ ...r, italics: true })) : node.runs;
}
