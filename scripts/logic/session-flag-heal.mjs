// Which Session pages need their monks-enhanced-journal.type flag re-stamped?
//
// Stock MEJ scrubs that flag: its fixType() unsets any type its registry does
// not recognise, and a stock registry has no "session". Nothing in this
// module reads the flag any more (identity comes from the native subtype),
// but MEJ's own shell routing needs it - so after a world moves from a stock
// install back to an API-carrying one, the GM re-stamps what was scrubbed.
import { SESSION_TYPE } from "../constants.mjs";

/**
 * @param {{uuid: string, flagType: string|undefined}[]} pages Session pages,
 *        each with the current value of flags["monks-enhanced-journal"].type
 * @returns {string[]} uuids of pages to re-stamp
 */
export function planFlagHeal(pages) {
  return (pages ?? [])
    .filter((page) => page?.flagType !== SESSION_TYPE)
    .map((page) => page.uuid);
}
