// Pure note model (spec 2026-10-15 items 1-3). No Foundry imports. A note
// is one keyed object under flags[MODULE_ID].notes on the campaign's hidden
// notes entry (data/notes-store.mjs); every write is one keyed path so two
// authors never clobber each other.
import { MODULE_ID, NOTES_FLAG, NOTE_TEXT_MAX } from "../constants.mjs";
import { canSee, normalizeAudience } from "./reveal-state.mjs";

export const NOTE_KINDS = ["player", "gm", "reveal"];

const path = (id, field) => `flags.${MODULE_ID}.${NOTES_FLAG}.${id}${field ? `.${field}` : ""}`;

export function validNoteText(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text.length || text.length > NOTE_TEXT_MAX) return null;
  return text;
}

const UUID_RE = /@UUID\[([^\]]+)\]/g;

/** Unique JournalEntry uuids mentioned in `text`; a page uuid collapses to its entry. */
export function mentionsOf(text) {
  const out = [];
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(UUID_RE)) {
    const parts = m[1].split(".");
    if (parts[0] !== "JournalEntry" || !parts[1]) continue;
    const uuid = `JournalEntry.${parts[1]}`;
    if (!out.includes(uuid)) out.push(uuid);
  }
  return out;
}

function normalizeAudienceOrNull(raw) {
  if (raw == null) return null;
  const a = normalizeAudience(raw);
  return { users: a.users, groups: a.groups, all: a.all };
}

/**
 * Stored text is pre-escaped HTML plus @UUID shorthand, so a legitimate note
 * never holds a literal < or >. A stray one (a direct flag write) is
 * neutralized here so no read path can carry markup (R1).
 */
const neutralizeAngles = (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

function normalizeOne(id, raw) {
  if (!raw || typeof raw !== "object" || typeof raw.text !== "string" || typeof raw.authorId !== "string") return null;
  return {
    id,
    text: neutralizeAngles(raw.text),
    authorId: raw.authorId,
    authorName: typeof raw.authorName === "string" ? raw.authorName : "",
    at: typeof raw.at === "number" ? raw.at : 0,
    worldDate: raw.worldDate && typeof raw.worldDate === "object" ? raw.worldDate : null,
    sessionUuid: typeof raw.sessionUuid === "string" ? raw.sessionUuid : null,
    mentions: Array.isArray(raw.mentions) ? raw.mentions.filter((m) => typeof m === "string") : [],
    audience: normalizeAudienceOrNull(raw.audience),
    kind: NOTE_KINDS.includes(raw.kind) ? raw.kind : "player",
    editedAt: typeof raw.editedAt === "number" ? raw.editedAt : null,
    retracted: typeof raw.retracted === "number" ? raw.retracted : null,
    ref: raw.ref && typeof raw.ref === "object" && !Array.isArray(raw.ref) ? { ...raw.ref } : null
  };
}

export function normalizeNotes(flagValue) {
  if (!flagValue || typeof flagValue !== "object" || Array.isArray(flagValue)) return [];
  return Object.entries(flagValue)
    .map(([id, raw]) => normalizeOne(id, raw))
    .filter(Boolean)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function noteCreateUpdate({ id, text, authorId, authorName = "", at, worldDate = null, sessionUuid = null, mentions, audience = null, kind = "player", ref = null }) {
  const value = {
    text, authorId, authorName, at, worldDate, sessionUuid: sessionUuid ?? null,
    mentions: mentions ?? mentionsOf(text),
    audience: normalizeAudienceOrNull(audience),
    kind: NOTE_KINDS.includes(kind) ? kind : "player",
    editedAt: null, retracted: null, ref
  };
  return { id, update: { [path(id)]: value } };
}

export function noteEditUpdate(note, rawText, { now }) {
  const text = validNoteText(rawText);
  if (!text) return null;
  return { [path(note.id, "text")]: text, [path(note.id, "mentions")]: mentionsOf(text), [path(note.id, "editedAt")]: now };
}

export function noteDeleteUpdate(id) {
  return { [`flags.${MODULE_ID}.${NOTES_FLAG}.-=${id}`]: null };
}

export function noteRetractUpdate(id, { now }) {
  return { [path(id, "retracted")]: now };
}

export function noteAudienceUpdate(id, audience) {
  return { [path(id, "audience")]: normalizeAudienceOrNull(audience) };
}

export function canEditNote(note, user) {
  return !!user && (user.isGM === true || note?.authorId === user.id);
}

export function visibleNotes(notes, user, groups) {
  if (user?.isGM) return [...(notes ?? [])];
  return (notes ?? []).filter((n) => {
    if (n.retracted !== null) return false;
    if (n.audience === null || n.audience.all) return true;
    return canSee(n.audience, user?.id, groups);
  });
}

export const notesForSession = (notes, sessionUuid) => (notes ?? []).filter((n) => n.sessionUuid === sessionUuid);
export const notesMentioning = (notes, entryUuid) => (notes ?? []).filter((n) => n.mentions.includes(entryUuid));
export const heldNotes = (notes) => (notes ?? []).filter((n) => n.sessionUuid === null);

export function noteCountsBySession(notes) {
  const m = new Map();
  for (const n of notes ?? []) {
    if (n.sessionUuid === null) continue;
    m.set(n.sessionUuid, (m.get(n.sessionUuid) ?? 0) + 1);
  }
  return m;
}
