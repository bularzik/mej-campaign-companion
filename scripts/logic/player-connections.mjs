// Player connections (spec 2026-10-09). Pure and Foundry-free: the model,
// who sees what, and the per-side view the Relationships block renders.
// Storage lives on the "from" entry's MEJ-typed page at
// flags["mej-campaign-companion"].playerConnections = {[id]: Connection};
// every reader goes through normalizeConnections so hand-edited or
// half-synced flags are skipped, never thrown on (spec §2, §7).

export const LABEL_MAX = 200;
export const SECRET_MAX = 500;
export const SIDES = ["from", "to"];

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** Trimmed text within `max` chars; "" for null/undefined; null when not a string or too long. */
export function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > max ? null : text;
}

function normalizeNotes(side) {
  const notes = {};
  const raw = isObj(side) && isObj(side.notes) ? side.notes : {};
  for (const [userId, n] of Object.entries(raw)) {
    if (!isObj(n)) continue;
    notes[userId] = {
      authorName: str(n.authorName),
      label: str(n.label),
      secret: str(n.secret),
      revealed: n.revealed === true,
      updated: Number.isFinite(n.updated) ? n.updated : 0
    };
  }
  return { notes };
}

/**
 * Defensive parse of the playerConnections flag (spec §2). A row must carry
 * a string `id` equal to its own key (writes address rows by that id, so a
 * mismatch would write beside the row instead of into it) and a string `to`.
 * `fromUuid` is the entry the flag lives on; every row carries it so the
 * reverse side can name its other end.
 */
export function normalizeConnections(flagValue, fromUuid = null) {
  if (!isObj(flagValue)) return [];
  const rows = [];
  for (const [key, raw] of Object.entries(flagValue)) {
    if (!isObj(raw)) continue;
    if (typeof raw.id !== "string" || !raw.id.length || raw.id !== key) continue;
    if (typeof raw.to !== "string" || !raw.to.length) continue;
    const sides = isObj(raw.sides) ? raw.sides : {};
    rows.push({
      id: raw.id,
      from: fromUuid,
      to: raw.to,
      authorId: typeof raw.authorId === "string" ? raw.authorId : "",
      authorName: str(raw.authorName),
      shared: raw.shared !== false,
      created: Number.isFinite(raw.created) ? raw.created : 0,
      sides: { from: normalizeNotes(sides.from), to: normalizeNotes(sides.to) }
    });
  }
  return rows;
}

/**
 * Spec §3: GM sees every row; anyone else needs LIMITED+ on both endpoints
 * (an unresolved target therefore hides the row) and to be the author or the
 * row to be shared. A foreign author (no such user here) can never match
 * userId, so their private rows fall to GM-only on their own.
 */
export function canSeeConnection(row, { userId, isGM, canSeeEntry }) {
  if (!row) return false;
  if (isGM) return true;
  if (!canSeeEntry(row.from) || !canSeeEntry(row.to)) return false;
  return row.authorId === userId || row.shared === true;
}

/** A note as `viewer` may see it: the secret is blanked unless writer, GM, or revealed. */
export function visibleNote(note, writerId, { userId, isGM }) {
  const secretVisible = isGM === true || writerId === userId || note.revealed === true;
  return {
    writerId,
    authorName: note.authorName,
    label: note.label,
    revealed: note.revealed,
    secretVisible,
    secret: secretVisible ? note.secret : ""
  };
}

/**
 * Everything the block needs to draw one connection on one side (spec §4.5):
 * the author's note is the row's main label, other writers' notes list
 * beneath, and each control is decided here so the DOM layer only renders.
 */
export function sideView(row, side, { userId, isGM, enabled, knownUserIds, canObserveSide }) {
  const notes = row.sides[side].notes;
  const known = (id) => knownUserIds?.has?.(id) === true;
  const noteView = (writerId) => {
    const own = writerId === userId;
    const editable = own && enabled === true && known(writerId);
    return {
      ...visibleNote(notes[writerId], writerId, { userId, isGM }),
      editable,
      canReveal: editable && notes[writerId].secret.length > 0,
      canDelete: own || isGM === true
    };
  };
  const isAuthor = row.authorId === userId;
  const others = Object.keys(notes)
    .filter((id) => id !== row.authorId)
    .sort((a, b) => notes[a].authorName.localeCompare(notes[b].authorName) || a.localeCompare(b))
    .map(noteView);
  return {
    id: row.id,
    side,
    from: row.from,
    to: row.to,
    otherUuid: side === "from" ? row.to : row.from,
    reverse: side === "to",
    shared: row.shared,
    authorId: row.authorId,
    authorName: row.authorName,
    foreignAuthor: !known(row.authorId),
    isAuthor,
    showAuthor: isGM === true || !isAuthor,
    viewerId: userId,
    main: notes[row.authorId] ? noteView(row.authorId) : null,
    others,
    canAddNote: enabled === true && canObserveSide === true && !notes[userId] && (row.shared || isAuthor || isGM === true),
    canToggleShare: isAuthor && known(userId),
    canDelete: isAuthor || isGM === true
  };
}

/** Notes on either side written by someone other than the connection author (spec §3 confirmations). */
export function countOtherNotes(row) {
  return SIDES.reduce((n, side) => n + Object.keys(row.sides[side].notes).filter((id) => id !== row.authorId).length, 0);
}
