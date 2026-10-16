// scripts/logic/prep-notes-merge.mjs
// Spec 2026-10-15 §5.7: one GM note field per session. The prep board's
// "Scratch notes" (a plain-text `prepNotes` flag) fold into the session's
// GM Notes once, under a heading, and the flag is cleared. Pure.

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @param {string|undefined} gmNotes   stored system.gmNotes (HTML)
 * @param {string|null|undefined} prepNotes  plain text from the flag
 * @param {string} heading  localized heading text
 * @returns {{ gmNotes: string, changed: boolean }}
 */
export function mergePrepNotes(gmNotes, prepNotes, heading) {
  const base = typeof gmNotes === "string" ? gmNotes : "";
  const text = typeof prepNotes === "string" ? prepNotes : "";
  if (!text.trim()) return { gmNotes: base, changed: false };
  const paragraphs = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => `<p>${escapeHtml(l)}</p>`).join("");
  return { gmNotes: `${base}<h3>${escapeHtml(heading)}</h3>${paragraphs}`, changed: true };
}

/** Pages whose prepNotes flag holds text, with the merged GM Notes to write. */
export function planPrepNotesSweep(pages, heading) {
  const plan = [];
  for (const page of pages ?? []) {
    const prep = page.getFlag("mej-campaign-companion", "prepNotes");
    const { gmNotes, changed } = mergePrepNotes(page.system?.gmNotes, prep, heading);
    if (changed) plan.push({ page, gmNotes });
  }
  return plan;
}
