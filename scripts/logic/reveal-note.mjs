// scripts/logic/reveal-note.mjs
// Spec 2026-10-15 §5 principle 4 and §9: "revealing is filing". A reveal
// that takes a secret from nobody to somebody files one GM-authored note on
// the current session; taking it back to nobody retracts that note. Adding
// a second player to an already-revealed secret files nothing - the filed
// note's audience follows instead. The note REFERENCES the page and block -
// it never copies secret text - and carries the reveal's audience so the
// note is soft-hidden exactly like the secret. Pure; glue: hooks/reveal-filing.mjs.
import { normalizeAudience, isRevealed } from "./reveal-state.mjs";
import { neutralizeEnrichers } from "./notes.mjs";

const audienceKey = (a) => (a.all ? "all" : `${[...a.users].sort().join(",")}|${[...a.groups].sort().join(",")}`);

/** @returns {"reveal"|"retract"|"update"|"none"} */
export function revealTransition(previous, next) {
  const prev = normalizeAudience(previous);
  const nxt = normalizeAudience(next);
  const was = isRevealed(prev);
  const is = isRevealed(nxt);
  if (!was && is) return "reveal";
  if (was && !is) return "retract";
  if (was && is && audienceKey(prev) !== audienceKey(nxt)) return "update";
  return "none";
}

/** Flag-safe key for the revealNotes map ("." is a path separator in Foundry updates). */
export function revealKey(kind, id) {
  return `${kind}-${String(id).replace(/[.]/g, "_")}`;
}

/** The note audience for a reveal audience: explicit `{ users, groups }`, or null for Everyone. */
export function revealNoteAudience(audience) {
  const a = normalizeAudience(audience);
  return a.all ? null : { users: [...a.users], groups: [...a.groups] };
}

/**
 * A document name made safe to splice into stored note text (which is
 * already-escaped HTML): markup escaped and every enricher trigger broken,
 * including `@UUID[`, so the label renders as the plain name.
 */
export function safeNoteName(name) {
  if (typeof name !== "string") return "";
  const escaped = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return neutralizeEnrichers(escaped, { keepUuidLinks: false });
}

/** The addNote payload for a reveal (Plan B's notes-store contract plus `ref`). */
export function revealNote({ entryUuid, pageUuid, blockId, kind, audience, revealedBy, at, sessionUuid, label }) {
  return {
    text: label,
    authorId: revealedBy,
    at,
    worldDate: null,
    sessionUuid: sessionUuid ?? null,
    mentions: entryUuid ? [entryUuid] : [],
    kind: "reveal",
    audience: revealNoteAudience(audience),
    ref: { pageUuid: pageUuid ?? null, blockId: blockId ?? null, kind }
  };
}
