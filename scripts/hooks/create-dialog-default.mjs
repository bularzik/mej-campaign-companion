// Default the New Entry dialog's folder select to the folder of the entry
// currently open in the MEJ shell, so new entries land beside what the user
// is working on instead of at the root. Companion-side ONLY - MEJ itself
// stays unpatched (user ruling, 2026-08-22): this wraps the same
// JournalEntry.createDialog target MEJ's own wrapper touches, layering on
// top of it via libWrapper when available.
import { MODULE_ID } from "../constants.mjs";
// Generic "libWrapper when active, manual prototype patch otherwise"
// installer - written for the shareImage capture wrap but target-agnostic.
import { installShareImageWrap as installWrap } from "../logic/auto-capture.mjs";
import { defaultCreateFolderId } from "../logic/create-dialog.mjs";

const PREDS = {
  isPage: (d) => d instanceof JournalEntryPage,
  isEntry: (d) => d instanceof JournalEntry
};

/**
 * Mutates a createDialog args array in place: fills args[0].folder with the
 * open-shell entry's folder when the caller didn't choose one. Failures are
 * observed, never thrown - a broken default must not block the dialog.
 */
function applyDefaultFolder(args) {
  try {
    const shell = game.MonksEnhancedJournal?.journal;
    const doc = shell?.rendered ? shell.document : null;
    const folderId = defaultCreateFolderId(args[0], doc, PREDS);
    if (folderId) args[0] = { ...(args[0] ?? {}), folder: folderId };
  } catch (err) {
    console.error(`${MODULE_ID} | create-dialog folder default failed`, err);
  }
}

export function registerCreateDialogDefault() {
  installWrap({
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    // Same target string MEJ's own createDialog wrapper registers, so
    // libWrapper layers the two cleanly in either load order.
    target: "JournalEntry.prototype.constructor.createDialog",
    wrapper: function (wrapped, ...args) {
      applyDefaultFolder(args);
      return wrapped(...args);
    },
    registerManual: () => {
      const original = JournalEntry.createDialog;
      JournalEntry.createDialog = function (...args) {
        applyDefaultFolder(args);
        return original.apply(this, args);
      };
    },
    warn: (error) => console.warn(`${MODULE_ID} | libWrapper.register failed for JournalEntry.createDialog; falling back to manual patch`, error)
  });
}
