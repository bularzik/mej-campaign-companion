// scripts/hooks/prep-notes-migrate.mjs
// Active-GM, idempotent: fold every session page's leftover prepNotes into
// its GM Notes and clear the flag. Runs on ready after the versioned
// migrations; a world with no prepNotes text does nothing. Not a dataVersion
// step: the flag's absence is its own "done" marker.
import { MODULE_ID, I18N, SESSION_DOCUMENT_TYPE, SESSION_TYPE } from "../constants.mjs";
import { planPrepNotesSweep } from "../logic/prep-notes-merge.mjs";

export async function migratePrepNotes() {
  if (game.user !== game.users.activeGM) return 0;
  const pages = game.journal.contents.flatMap((e) =>
    e.pages.contents.filter((p) => p.type === SESSION_DOCUMENT_TYPE || p.type === SESSION_TYPE));
  const plan = planPrepNotesSweep(pages, game.i18n.localize(`${I18N}.prep.scratchHeading`));
  for (const { page, gmNotes } of plan) {
    try {
      await page.update({ "system.gmNotes": gmNotes, [`flags.${MODULE_ID}.-=prepNotes`]: null });
    } catch (err) {
      console.error(`${MODULE_ID} | prep-notes fold failed for ${page.uuid}`, err);
    }
  }
  return plan.length;
}
