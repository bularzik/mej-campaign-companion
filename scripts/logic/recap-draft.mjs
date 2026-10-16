// Recap draft from a session's notes (spec item 1a). Note text is stored
// escaped+linked HTML (hooks/note-links.mjs), re-escaped idempotently via noteHtmlSource; the
// author name is escaped here. The recap is read by players, so only notes
// that are live and public (no audience, or audience.all) are included.
// The draft is persisted into the recap, which renders with every enricher
// on, so the author name and time carry no enricher trigger either.
import { noteHtmlSource, neutralizeEnrichers } from "./notes.mjs";

const esc = (s) => neutralizeEnrichers(String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), { keepUuidLinks: false });

const isPublicLive = (n) => typeof n.retracted !== "number" && (n.audience == null || n.audience.all === true);

export function recapDraft(notes, { formatTime }) {
  return (notes ?? [])
    .filter(isPublicLive)
    .map((n) => `<p><strong>${esc(formatTime(n.at))} ${esc(n.authorName || n.authorId)}</strong> ${noteHtmlSource(n.text)}</p>`)
    .join("");
}
