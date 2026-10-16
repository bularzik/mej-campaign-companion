// scripts/hooks/reveal-filing.mjs
// Glue between the reveal paths and the note store (spec 2026-10-15 §9,
// "revealing is filing"). Every function here is a no-op when the store or
// the current-session helper cannot load, when the entry is in no campaign,
// or when no session is open - revealing never fails because filing could
// not happen. GM-only: every caller already returns early for players.
//
// Security: a reveal note's text is only a localized label around the
// entry's NAME (escaped, enrichers broken - safeNoteName); it never holds
// secret text. Its audience is the reveal's audience (explicit
// { users, groups }, or null only for an Everyone reveal), so the note is
// soft-hidden exactly like the secret it points at.
import { MODULE_ID, I18N, REVEAL_NOTES_FLAG } from "../constants.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { revealTransition, revealNote, revealNoteAudience, revealKey, safeNoteName } from "../logic/reveal-note.mjs";

async function loadStore() {
  try {
    const [store, session] = await Promise.all([
      import("../data/notes-store.mjs"),
      import("../logic/current-session.mjs")
    ]);
    return { store, currentSession: session.currentSession };
  } catch {
    return null;
  }
}

// The note is gone from the store (deleted by a GM, or the notes entry
// itself is missing): nothing to retract or widen, and the stale flag key
// must go so a later reveal can file again.
const isGone = (err) => err?.reason === "notFound" || err?.reason === "noEntry";

const clearKey = (target, key) => target.update({ [`flags.${MODULE_ID}.${REVEAL_NOTES_FLAG}.-=${key}`]: null });

/**
 * @param {object} args
 * @param {JournalEntry} args.entry       the entry the secret belongs to
 * @param {Document} args.target          document holding the reveal record (page or entry)
 * @param {"block"|"checklist"|"rel"} args.kind
 * @param {string} args.id                 block section id / checklist item id / relationship id
 * @param {object} args.previous           audience before the dialog
 * @param {object} args.audience           audience after the dialog
 * @param {string} args.label              note text (revealLabel: already escaped)
 */
export async function fileRevealChange({ entry, target, kind, id, previous, audience, label }) {
  try {
    if (!game.user.isGM || !entry || !target) return;
    const transition = revealTransition(previous, audience);
    if (transition === "none") return;
    const campaign = campaignOf(entry);
    if (!campaign) return;
    const loaded = await loadStore();
    if (!loaded) return;
    const { store } = loaded;
    const key = revealKey(kind, id);
    const existing = target.getFlag(MODULE_ID, REVEAL_NOTES_FLAG)?.[key] ?? null;

    if (transition === "retract") {
      if (!existing) return;
      try {
        await store.retractNote(campaign, existing);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
      await clearKey(target, key);
      return;
    }

    if (transition === "update") {
      // The secret stays revealed; the note keeps its place on the session
      // it was filed under and only its audience follows the new one, so a
      // player added later can read it and one removed no longer can.
      if (!existing) return;
      try {
        await store.updateNote(campaign, existing, { audience: revealNoteAudience(audience) });
      } catch (err) {
        if (!isGone(err)) throw err;
        await clearKey(target, key);
      }
      return;
    }

    // transition === "reveal". A leftover id means an earlier un-reveal did
    // not retract its note (a failed write, or a path that never filed the
    // retract): retract that orphan first so no live note outlasts the
    // secret it described.
    if (existing) {
      try {
        await store.retractNote(campaign, existing);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
    const session = loaded.currentSession(campaign);
    if (!session) {
      if (existing) await clearKey(target, key);
      return;
    }
    await store.ensureNotesEntry(campaign);
    const note = await store.addNote(campaign, revealNote({
      entryUuid: entry.uuid,
      pageUuid: target.documentName === "JournalEntryPage" ? target.uuid : null,
      blockId: id, kind, audience, revealedBy: game.user.id, at: Date.now(),
      sessionUuid: session.uuid, label
    }));
    const noteId = typeof note === "string" ? note : note?.id ?? null;
    if (noteId) await target.update({ [`flags.${MODULE_ID}.${REVEAL_NOTES_FLAG}.${key}`]: noteId });
    else if (existing) await clearKey(target, key);
  } catch (err) {
    console.error(`${MODULE_ID} | filing a reveal note failed`, err);
  }
}

/**
 * Show Players: one GM note on the current session of the capture campaign.
 * A share to every player (`users` empty) is readable by everyone; a share to
 * selected players carries exactly those players as its audience.
 */
export async function fileMediaNote({ campaign, src, name, users = [] }) {
  try {
    if (!game.user.isGM || !campaign || !src) return;
    const loaded = await loadStore();
    if (!loaded) return;
    const session = loaded.currentSession(campaign);
    if (!session) return;
    await loaded.store.ensureNotesEntry(campaign);
    await loaded.store.addNote(campaign, {
      text: game.i18n.format(`${I18N}.revealNote.media`, { name: safeNoteName(name || src) }),
      authorId: game.user.id, at: Date.now(), worldDate: null, sessionUuid: session.uuid,
      mentions: [], kind: "reveal",
      audience: users?.length ? { users: [...users], groups: [] } : null,
      ref: { src, kind: "media" }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | filing a media note failed`, err);
  }
}

/** Localized note label per kind, around the escaped entry name (never secret text). */
export function revealLabel(kind, entryName) {
  const key = { block: "block", checklist: "checklist", rel: "relationship" }[kind] ?? "block";
  return game.i18n.format(`${I18N}.revealNote.${key}`, { name: safeNoteName(entryName) });
}
