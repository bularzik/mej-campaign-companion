// Player connections (spec 2026-10-09). Pure and Foundry-free: the model,
// who sees what, and the per-side view the Relationships block renders.
// Storage lives on the "from" entry's MEJ-typed page at
// flags["mej-campaign-companion"].playerConnections = {[id]: Connection};
// every reader goes through normalizeConnections so hand-edited or
// half-synced flags are skipped, never thrown on (spec §2, §7).

import { MODULE_ID, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";

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

// ---- GM-side validation and writes (spec §5) ------------------------------

export const OPS = ["add", "setShared", "delete", "setNote", "deleteNote", "setRevealed"];
const BASE = `flags.${MODULE_ID}.${PLAYER_CONNECTIONS_FLAG}`;
const fail = (reason) => ({ ok: false, reason });
const OK = Object.freeze({ ok: true });
const NOOP = Object.freeze({ ok: true, noop: true });

/** {label, secret} cleaned to the spec limits, or null when either is invalid (or the label is required and empty). */
function notePair(note, { required }) {
  if (note !== undefined && note !== null && !isObj(note)) return null;
  const label = cleanText(note?.label, LABEL_MAX);
  const secret = cleanText(note?.secret, SECRET_MAX);
  if (label === null || secret === null) return null;
  if (required && !label) return null;
  return { label, secret };
}

/**
 * Every check the active GM runs before writing (spec §5). `ctx` is built
 * GM-side from the live documents and the SOCKET sender - never from the
 * payload. Writes address rows by connectionId and notes by sender id, so a
 * connection/note that isn't found is never written to (gone / no-op).
 */
export function validateRequest(op, request, ctx) {
  if (!OPS.includes(op)) return fail("bad-request");
  const { sender, enabled, source, typeOf, canAccess, connections } = ctx;
  if (!source || source.typed !== true) return fail("no-entry");
  if (source.locked === true) return fail("locked");
  const payload = isObj(request?.payload) ? request.payload : {};

  if (op === "add") {
    if (!enabled) return fail("disabled");
    const to = payload.to;
    if (typeof to !== "string" || !to.length) return fail("bad-request");
    if (to === source.uuid) return fail("self");
    if (!canAccess(source.uuid, "OBSERVER")) return fail("no-access");
    const type = typeOf(to);
    if (!type || !canAccess(to, "LIMITED")) return fail("no-access");
    if (!(source.allowed ?? []).includes(type)) return fail("type-not-allowed");
    if (connections.some((c) => c.authorId === sender.id && c.to === to)) return fail("duplicate");
    if (!notePair(payload.fromNote ?? null, { required: true })) return fail("bad-label");
    if (payload.toNote !== undefined && !notePair(payload.toNote, { required: false })) return fail("bad-label");
    return OK;
  }

  const conn = connections.find((c) => c.id === request?.connectionId) ?? null;
  const sees = (c) => canSeeConnection(c, { userId: sender.id, isGM: sender.isGM === true, canSeeEntry: (u) => canAccess(u, "LIMITED") });
  const side = request?.side;
  switch (op) {
    case "setShared":
      if (!conn) return fail("gone");
      if (conn.authorId !== sender.id) return fail("not-author");
      return OK;
    case "delete":
      if (!conn) return NOOP;
      if (conn.authorId !== sender.id && sender.isGM !== true) return fail("not-author");
      return OK;
    case "setNote": {
      if (!enabled) return fail("disabled");
      if (!conn) return fail("gone");
      if (!SIDES.includes(side)) return fail("bad-request");
      if (!sees(conn)) return fail("no-access");
      const sideUuid = side === "from" ? source.uuid : conn.to;
      if (sender.isGM !== true && !canAccess(sideUuid, "OBSERVER")) return fail("no-access");
      if (!notePair(payload, { required: false })) return fail("bad-label");
      return OK;
    }
    case "deleteNote": {
      if (!conn) return NOOP;
      if (!SIDES.includes(side)) return fail("bad-request");
      const writer = typeof payload.noteUserId === "string" ? payload.noteUserId : sender.id;
      if (!Object.hasOwn(conn.sides[side].notes, writer)) return NOOP;
      if (writer !== sender.id && sender.isGM !== true) return fail("not-author");
      return OK;
    }
    case "setRevealed":
      if (!enabled) return fail("disabled");
      if (!conn) return fail("gone");
      if (!SIDES.includes(side)) return fail("bad-request");
      if (!Object.hasOwn(conn.sides[side].notes, sender.id)) return fail("gone");
      if (!sees(conn)) return fail("no-access");
      return OK;
  }
  return fail("bad-request");
}

/**
 * The page.update() data for a validated request (spec §5): keyed paths
 * and `-=` deletes only, so two players writing at once never overwrite
 * each other. Call only after validateRequest returned { ok: true } without
 * `noop` - the path segments (connectionId, side, note writer) are trusted
 * here because validation found them in the stored flag.
 */
export function connectionUpdate(op, request, { senderId, senderName, now, newId, connections }) {
  const payload = isObj(request?.payload) ? request.payload : {};
  const cid = request?.connectionId;
  const side = request?.side;
  const noteKey = (s, uid) => `${BASE}.${cid}.sides.${s}.notes.${uid}`;
  const noteDelete = (s, uid) => `${BASE}.${cid}.sides.${s}.notes.-=${uid}`;
  const makeNote = ({ label, secret }, revealed = false) => ({ authorName: senderName, label, secret, revealed, updated: now });
  switch (op) {
    case "add": {
      const fromNote = notePair(payload.fromNote, { required: true });
      const toNote = payload.toNote === undefined ? null : notePair(payload.toNote, { required: false });
      const toNotes = toNote && (toNote.label || toNote.secret) ? { [senderId]: makeNote(toNote) } : {};
      return {
        [`${BASE}.${newId}`]: {
          id: newId, to: payload.to, authorId: senderId, authorName: senderName,
          shared: payload.shared !== false, created: now,
          sides: { from: { notes: { [senderId]: makeNote(fromNote) } }, to: { notes: toNotes } }
        }
      };
    }
    case "setShared":
      return { [`${BASE}.${cid}.shared`]: payload.shared === true };
    case "delete":
      return { [`${BASE}.-=${cid}`]: null };
    case "setNote": {
      const { label, secret } = notePair(payload, { required: false });
      if (!label && !secret) return { [noteDelete(side, senderId)]: null };
      const prior = connections.find((c) => c.id === cid)?.sides[side].notes[senderId];
      return { [noteKey(side, senderId)]: makeNote({ label, secret }, prior?.revealed === true && secret.length > 0) };
    }
    case "deleteNote": {
      const writer = typeof payload.noteUserId === "string" ? payload.noteUserId : senderId;
      return { [noteDelete(side, writer)]: null };
    }
    case "setRevealed":
      return { [`${noteKey(side, senderId)}.revealed`]: payload.revealed === true };
  }
  return {};
}

// ---- Reverse index (spec §4.3) ---------------------------------------------
// Only the "from" end stores a connection; the "to" end finds it here.
// `outbound` remembers each source's targets so a source can be re-indexed
// or dropped without scanning every target.

export function createReverseIndex() {
  return { inbound: new Map(), outbound: new Map() };
}

export function removeSource(index, fromUuid) {
  const affected = new Set([fromUuid]);
  const targets = index.outbound.get(fromUuid);
  if (!targets) return affected;
  for (const to of targets) {
    const kept = (index.inbound.get(to) ?? []).filter((e) => e.fromUuid !== fromUuid);
    if (kept.length) index.inbound.set(to, kept);
    else index.inbound.delete(to);
    affected.add(to);
  }
  index.outbound.delete(fromUuid);
  return affected;
}

export function reindexSource(index, { fromUuid, flag }) {
  const affected = removeSource(index, fromUuid);
  const targets = new Set();
  for (const row of normalizeConnections(flag, fromUuid)) {
    const list = index.inbound.get(row.to) ?? [];
    list.push({ fromUuid, row });
    index.inbound.set(row.to, list);
    targets.add(row.to);
    affected.add(row.to);
  }
  if (targets.size) index.outbound.set(fromUuid, targets);
  return affected;
}

export function buildReverseIndex(sources) {
  const index = createReverseIndex();
  for (const source of sources ?? []) reindexSource(index, source);
  return index;
}

export function incomingFor(index, toUuid) {
  return index?.inbound.get(toUuid) ?? [];
}

// ---- Targets for the Add dialog and drop (spec §4.6, §7) -------------------

/** Why `target` can't be connected from the source by this author, or null. */
export function targetProblem(target, { sourceUuid, allowed, authorId, existing, typeOf, canLimited }) {
  if (!target) return "not-journal";
  if (target.uuid === sourceUuid) return "self";
  if (!canLimited(target)) return "no-access";
  const type = typeOf(target);
  if (!type || !(allowed ?? []).includes(type)) return "type-not-allowed";
  if ((existing ?? []).some((c) => c.authorId === authorId && c.to === target.uuid)) return "duplicate";
  return null;
}

export function eligibleTargets(entries, ctx, filter = "") {
  const q = String(filter).trim().toLocaleLowerCase();
  return [...(entries ?? [])]
    .filter((entry) => targetProblem(entry, ctx) === null)
    .filter((entry) => !q || String(entry.name ?? "").toLocaleLowerCase().includes(q))
    .map((entry) => ({ uuid: entry.uuid, name: String(entry.name ?? ""), type: ctx.typeOf(entry) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Word export (spec §6.2) -----------------------------------------------

/**
 * Lines for one entry's "Player connections" list, from this entry's side:
 * `Mara — Sister of (by Dana)`, other players' notes nested beneath, secrets
 * as `Secret: …`. GM export with GM content: everything, private ones
 * marked. Otherwise: shared connections plus the exporter's own private
 * ones; secrets only when revealed or written by the exporter.
 */
export function exportLines(items, { includeGM, viewerId, labels }) {
  const secretShown = (note, writerId) => includeGM || note.revealed === true || writerId === viewerId;
  return (items ?? [])
    .filter(({ row }) => includeGM || row.shared || row.authorId === viewerId)
    .map(({ row, side, otherName }) => {
      const notes = row.sides[side].notes;
      const main = notes[row.authorId];
      const text = [
        otherName,
        main?.label ? `— ${main.label}` : null,
        `(${labels.by(row.authorName)})`,
        includeGM && !row.shared ? `(${labels.private})` : null
      ].filter(Boolean).join(" ");
      const children = [];
      if (main?.secret && secretShown(main, row.authorId)) children.push(`${labels.secret}: ${main.secret}`);
      const others = Object.entries(notes)
        .filter(([writerId]) => writerId !== row.authorId)
        .sort(([, a], [, b]) => a.authorName.localeCompare(b.authorName));
      for (const [writerId, note] of others) {
        const parts = [];
        if (note.label) parts.push(`"${note.label}"`);
        if (note.secret && secretShown(note, writerId)) parts.push(`${labels.secret}: ${note.secret}`);
        if (parts.length) children.push(`${note.authorName}: ${parts.join(" — ")}`);
      }
      return { text, children, otherName };
    })
    .sort((a, b) => a.otherName.localeCompare(b.otherName))
    .map(({ text, children }) => ({ text, children }));
}
