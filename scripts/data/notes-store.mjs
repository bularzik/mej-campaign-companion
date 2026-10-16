// Foundry glue for the per-campaign notes entry (spec 2026-10-15 item 1).
// Mirrors data/party-notebook.mjs; GM-only writers self-check isGM.
import { MODULE_ID, I18N, NOTES_ENTRY_FLAG, NOTES_FLAG, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { isNotesEntry, isCampaignFolder } from "../logic/campaigns.mjs";
import { notebookOwnership, ownershipUpdate } from "../logic/party-access.mjs";
import { notesWriters } from "../logic/notes-access.mjs";
import {
  normalizeNotes, visibleNotes, notesForSession, notesMentioning, noteCreateUpdate, noteEditUpdate,
  noteDeleteUpdate, noteRetractUpdate, noteAudienceUpdate, canEditNote, validNoteText
} from "../logic/notes.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";

export class NotesStoreError extends Error {
  constructor(reason) {
    super(`notes store: ${reason}`);
    this.reason = reason;
  }
}

/** Accept a Folder or a folder id. */
export function resolveCampaign(campaign) {
  const folder = typeof campaign === "string" ? game.folders.get(campaign) : campaign;
  return folder && isCampaignFolder(folder) ? folder : null;
}

export function notesEntryOf(campaign) {
  const folder = resolveCampaign(campaign);
  return (folder?.contents ?? []).find((e) => isNotesEntry(e)) ?? null;
}

function desiredOwnership(folder, current) {
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  return notebookOwnership(current ?? {}, {
    defaultLevel: L.NONE,
    writerIds: notesWriters(folder, game.users.contents, L),
    ownerLevel: L.OWNER,
    gmIds: game.users.filter((u) => u.isGM).map((u) => u.id)
  });
}

const creating = new Map();

/** GM-only. The campaign's notes entry, created when missing. */
export async function ensureNotesEntry(campaign) {
  const folder = resolveCampaign(campaign);
  if (!game.user.isGM || !folder) return null;
  const existing = notesEntryOf(folder);
  if (existing) return existing;
  // Overlapping triggers share one creation (else both see no entry and both create).
  const pending = creating.get(folder.id);
  if (pending) return pending;
  const p = JournalEntry.create({
    name: game.i18n.format(`${I18N}.notes.entryName`, { campaign: folder.name }),
    folder: folder.id,
    ownership: desiredOwnership(folder, {}) ?? { default: 0 },
    flags: { [MODULE_ID]: { [NOTES_ENTRY_FLAG]: true, [NOTES_FLAG]: {} } }
  }).finally(() => creating.delete(folder.id));
  creating.set(folder.id, p);
  return p;
}

/** GM-only. Ownership follows the baseline and the user list. */
export async function syncNotesOwnership(campaign) {
  const folder = resolveCampaign(campaign);
  if (!game.user.isGM || !folder) return;
  const entry = notesEntryOf(folder);
  if (!entry) return;
  const update = ownershipUpdate(entry.ownership, desiredOwnership(folder, entry.ownership), {
    replace: typeof globalThis._replace === "function" ? globalThis._replace : null
  });
  if (update) await entry.update(update);
}

export function readNotes(campaign) {
  const entry = notesEntryOf(campaign);
  return entry ? normalizeNotes(entry.flags?.[MODULE_ID]?.[NOTES_FLAG]) : [];
}

export function listNotes(campaign, { sessionUuid, mentionsUuid, user = game.user } = {}) {
  const entry = notesEntryOf(campaign);
  if (!entry || !(user.isGM || entry.testUserPermission(user, "OBSERVER"))) return [];
  const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
  let notes = visibleNotes(readNotes(campaign), user, groups);
  if (sessionUuid !== undefined) notes = notesForSession(notes, sessionUuid);
  if (mentionsUuid !== undefined) notes = notesMentioning(notes, mentionsUuid);
  return notes;
}

function writable(campaign) {
  const entry = notesEntryOf(campaign);
  if (!entry) throw new NotesStoreError("noEntry");
  if (!entry.isOwner) throw new NotesStoreError("noAccess");
  return entry;
}

/** Append a note; `text` is already linked HTML (hooks/note-links.mjs). Returns the stored note. */
export async function addNote(campaign, { text, authorId = game.user.id, authorName = game.user.name, at = Date.now(), worldDate = null, sessionUuid = null, mentions, audience = null, kind = "player", ref = null }) {
  const entry = writable(campaign);
  if (!validNoteText(text)) throw new NotesStoreError("badText");
  // Only a GM may attribute a note to someone else, write a gm/reveal note, or set an audience.
  if (!game.user.isGM) {
    authorId = game.user.id;
    authorName = game.user.name;
    kind = "player";
    audience = null;
  }
  const { id, update } = noteCreateUpdate({
    id: foundry.utils.randomID(10), text, authorId, authorName, at, worldDate, sessionUuid, mentions, audience, kind, ref
  });
  await entry.update(update);
  return readNotes(campaign).find((n) => n.id === id) ?? null;
}

/** Patch `{ text?, audience? }`: text by author or GM; audience by a GM only (Plan C widens reveal audiences here). */
export async function updateNote(campaign, id, patch = {}) {
  const entry = writable(campaign);
  const note = readNotes(campaign).find((n) => n.id === id);
  if (!note) throw new NotesStoreError("notFound");
  const update = {};
  if (patch.text !== undefined) {
    if (!canEditNote(note, game.user)) throw new NotesStoreError("noAccess");
    const edit = noteEditUpdate(note, patch.text, { now: Date.now() });
    if (!edit) throw new NotesStoreError("badText");
    Object.assign(update, edit);
  }
  if (patch.audience !== undefined) {
    if (!game.user.isGM) throw new NotesStoreError("noAccess");
    Object.assign(update, noteAudienceUpdate(id, patch.audience));
  }
  if (Object.keys(update).length) await entry.update(update);
}

export async function deleteNote(campaign, id) {
  const entry = writable(campaign);
  const note = readNotes(campaign).find((n) => n.id === id);
  if (!note) throw new NotesStoreError("notFound");
  if (!canEditNote(note, game.user)) throw new NotesStoreError("noAccess");
  await entry.update(noteDeleteUpdate(id));
}

/** GM-only (Plan C's un-reveal path). */
export async function retractNote(campaign, id) {
  if (!game.user.isGM) throw new NotesStoreError("noAccess");
  const entry = writable(campaign);
  if (!readNotes(campaign).some((n) => n.id === id)) throw new NotesStoreError("notFound");
  await entry.update(noteRetractUpdate(id, { now: Date.now() }));
}
