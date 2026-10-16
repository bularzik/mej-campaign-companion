// Recap draft from a session's notes (spec item 1a). Note text is stored
// escaped+linked HTML (hooks/note-links.mjs), so it is emitted as-is; the
// author name is escaped here.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function recapDraft(notes, { formatTime }) {
  return (notes ?? [])
    .filter((n) => n.retracted === null)
    .map((n) => `<p><strong>${esc(formatTime(n.at))} ${esc(n.authorName || n.authorId)}</strong> ${n.text}</p>`)
    .join("");
}
