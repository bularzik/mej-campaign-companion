// Recap draft from a session's notes (spec item 1a). Note text is stored
// escaped+linked HTML (hooks/note-links.mjs), so it is emitted as-is; the
// author name is escaped here. The recap is read by players, so only notes
// that are live and public (no audience, or audience.all) are included.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isPublicLive = (n) => typeof n.retracted !== "number" && (n.audience == null || n.audience.all === true);

export function recapDraft(notes, { formatTime }) {
  return (notes ?? [])
    .filter(isPublicLive)
    .map((n) => `<p><strong>${esc(formatTime(n.at))} ${esc(n.authorName || n.authorId)}</strong> ${n.text}</p>`)
    .join("");
}
