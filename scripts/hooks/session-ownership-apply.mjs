// playersWriteSessions reaches existing sessions (spec 2026-09-04 §B).
// The preCreateJournalEntry stamp in campaign-companion.mjs still covers
// new entries; this is the one-shot offer made when the setting turns on.
// Active-GM client only - a world setting's onChange fires on EVERY client,
// GMs included, so with more than one GM connected a plain `isGM` guard
// would pop the confirm dialog once per GM. Gating on the elected single
// writer (`game.user === game.users.activeGM`) matches the migration
// block's own reasoning (campaign-companion.mjs) and hooks/socket.mjs.
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
  if (game.user !== game.users.activeGM) return;
  const entries = sessionsNeedingOwnership();
  if (!entries.length) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${I18N}.settings.playersWriteSessions.name`) },
    content: `<p>${game.i18n.format(`${I18N}.settings.playersWriteSessions.applyExisting`, { count: entries.length })}</p>`,
    rejectClose: false
  });
  if (!ok) return;
  try {
    const count = await applySessionOwnership(entries);
    ui.notifications.info(game.i18n.format(`${I18N}.settings.playersWriteSessions.applied`, { count }));
  } catch (error) {
    console.error(`${MODULE_ID} | granting session ownership failed`, error);
    ui.notifications.error(game.i18n.localize(`${I18N}.settings.playersWriteSessions.applyFailed`));
  }
}
