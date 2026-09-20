// Hold MEJ openJournalEntry calls for COMPANION documents until the
// companion's ready-time wiring has finished (spec 2026-09-20-ready-wiring-window
// §3.3, amended §7 A1). Installed from the setup hook — MEJ assigns
// game.MonksEnhancedJournal in its init hook, so the static method exists by
// then — and never uninstalled: once readyWiring has resolved the wrapper
// costs one microtask and delegates. The gate closes what early registration
// and the shim-first ready order cannot: the last few tens of milliseconds
// between the ready hook and the shim, in which a click used to land in
// MEJ's JournalEntrySheet wrapper. needsReadyGate scopes the hold to a
// module-prefixed page, an entry holding one, or an argument that is not a
// recognisable document (held conservatively); a plain MEJ document passes
// straight through, gate or no gate.
import { installWraps } from "../logic/mej-wraps.mjs";
import { gatedCall, needsReadyGate } from "../logic/ready-gate-logic.mjs";
import { wrapEnv } from "./wrap-env.mjs";
import { MODULE_ID } from "../constants.mjs";

/**
 * @param {Promise<unknown>} readyWiring the adapter's readyWiring promise (resolves in onReady's finally)
 * @returns {{installed: boolean}}
 */
export function installReadyGate(readyWiring) {
  const mej = game.MonksEnhancedJournal;
  if (typeof mej?.openJournalEntry !== "function") {
    console.warn(`${MODULE_ID} | ready gate not installed: MEJ has no openJournalEntry`);
    return { installed: false };
  }
  const result = installWraps([{
    name: "openJournalEntry", object: mej, key: "openJournalEntry",
    path: "game.MonksEnhancedJournal.openJournalEntry",
    wrapper(wrapped, ...args) {
      if (!needsReadyGate(args[0], MODULE_ID)) return wrapped(...args);
      return gatedCall(readyWiring, wrapped, args);
    }
  }], wrapEnv("ready gate"));
  const installed = result.installed.length === 1;
  if (!installed) {
    console.warn(`${MODULE_ID} | ready gate unavailable; an early open of a Session may still render before the shell adaptation is in place`);
  }
  return { installed };
}
