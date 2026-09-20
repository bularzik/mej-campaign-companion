// Decision behind SessionSheet.onEditGmNotes's commit (spec
// 2026-09-20-gm-notes-commit-design.md §3.1). Pure so vitest can pin it:
// the sheet reads the <prose-mirror>'s public `value` (its live content
// while active, its stored value otherwise) and writes it back through the
// public setter only when this says so.

/**
 * Whether the GM-notes editor's current value must be written back.
 * @param {unknown} live   the editor element's `value` (live content while active)
 * @param {unknown} stored the document's `system.gmNotes`
 * @returns {boolean} true only when `live` is a string that differs from `stored`
 *   (a missing stored value counts as "")
 */
export function shouldCommitGmNotes(live, stored) {
  if (typeof live !== "string") return false;
  return live !== (stored ?? "");
}
