// playersWriteSessions reaches existing sessions (spec 2026-09-04 §B).
// The preCreateJournalEntry stamp in campaign-companion.mjs still covers
// new entries; this is the one-shot offer made when the setting turns on.
// GM client only - a world setting's onChange fires on every client.
import { MODULE_ID, I18N, SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { sessionEntriesNeedingOwnership } from "../logic/session-ownership.mjs";

export function sessionsNeedingOwnership() {
  return sessionEntriesNeedingOwnership(game.journal.contents, {
    sessionType: SESSION_TYPE,
    sessionDocumentType: SESSION_DOCUMENT_TYPE,
    ownerLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
  });
}

/** One batch update; returns how many entries were written. */
export async function applySessionOwnership(entries) {
  if (!entries?.length) return 0;
  await JournalEntry.implementation.updateDocuments(
    entries.map((e) => ({ _id: e.id, "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }))
  );
  return entries.length;
}

export async function offerExistingSessionOwnership() {
  if (!game.user.isGM) return;
  const entries = sessionsNeedingOwnership();
  if (!entries.length) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${I18N}.settings.playersWriteSessions.name`) },
    content: `<p>${game.i18n.format(`${I18N}.settings.playersWriteSessions.applyExisting`, { count: entries.length })}</p>`,
    rejectClose: false
  });
  if (!ok) return;
  const count = await applySessionOwnership(entries);
  ui.notifications.info(game.i18n.format(`${I18N}.settings.playersWriteSessions.applied`, { count }));
}
