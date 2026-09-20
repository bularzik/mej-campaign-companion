// The `env` every companion wrap installer hands to installWraps
// (scripts/logic/mej-wraps.mjs): libWrapper when the lib-wrapper module is
// active, the manual prototype patch otherwise, and a warn() that prefixes
// the installer's name. Shared by the shell shim and the ready gate so both
// report the same way.
import { MODULE_ID } from "../constants.mjs";

/**
 * @param {string} label the installer's name for warn prefixes ("shell shim", "ready gate")
 */
export function wrapEnv(label) {
  return {
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    warn: (msg, err) => console.warn(`${MODULE_ID} | ${label}: ${msg}`, err ?? "")
  };
}
