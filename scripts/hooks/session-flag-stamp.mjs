// Applies sessionFlagPatch to a page before it is written (see
// logic/session-flag-stamp.mjs). updateSource on the pending document is the
// preCreate-hook way to amend the create data.
import { MODULE_ID } from "../constants.mjs";
import { sessionFlagPatch } from "../logic/session-flag-stamp.mjs";

export function registerSessionFlagStamp() {
  Hooks.on("preCreateJournalEntryPage", (page, data) => {
    try {
      const patch = sessionFlagPatch(data);
      if (patch) page.updateSource(patch);
    } catch (err) {
      console.error(`${MODULE_ID} | session flag stamp failed`, err);
    }
  });
}
