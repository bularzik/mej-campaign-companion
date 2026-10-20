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

/**
 * What "add to recap" appends (spec 2026-10-19 §4.3), so the same notes do not
 * go in twice by accident. Only public live notes ever reach the recap
 * (recapDraft), and "added" is judged over those same notes:
 *   "newer"          - added before; append only public live notes after the stamp.
 *   "again"          - added before and nothing public is newer; re-adding all asks first.
 *   "maybeDuplicate" - never stamped but the recap already has text (e.g. the old
 *                      End dialog's draft); adding all asks first.
 *   "all"            - never added and the recap is empty; append all.
 */
export function tableTalkPlan(notes, { addedAt = null, recapHasText = false } = {}) {
  const pub = (notes ?? []).filter(isPublicLive);
  if (typeof addedAt === "number") {
    const newer = pub.filter((n) => n.at > addedAt);
    return newer.length ? { kind: "newer", notes: newer, added: false } : { kind: "again", notes: pub, added: true };
  }
  return { kind: recapHasText ? "maybeDuplicate" : "all", notes: pub, added: false };
}
