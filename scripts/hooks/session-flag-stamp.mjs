// Applies sessionFlagPatch to a page before it is written (see
// logic/session-flag-stamp.mjs). updateSource on the pending document is the
// preCreate-hook way to amend the create data. Pages created together with
// their entry fire only the entry's preCreate, hence the second hook.
import { MODULE_ID } from "../constants.mjs";
import { sessionFlagPatch, embeddedPagesPatch } from "../logic/session-flag-stamp.mjs";

export function registerSessionFlagStamp() {
  Hooks.on("preCreateJournalEntryPage", (page) => {
    try {
      const patch = sessionFlagPatch(page._source);
      if (patch) page.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp failed`, err);
    }
  });
  Hooks.on("preCreateJournalEntry", (entry) => {
    try {
      const patch = embeddedPagesPatch(entry._source);
      if (patch) entry.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp (embedded pages) failed`, err);
    }
  });
}
