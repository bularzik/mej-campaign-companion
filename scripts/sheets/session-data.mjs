/**
 * Pure helper for the Session page type's flags["mej-campaign-companion"].session data.
 *
 * Deliberately has NO Foundry imports (no `foundry.utils`, no globals) so it can be
 * loaded directly by vitest. SessionSheet.mjs (which does import Foundry-served
 * modules that don't resolve on disk) delegates to this module for its data shape.
 */

export const SESSION_DEFAULTS = Object.freeze({
  sessionNumber: null,
  campaignDate: null,
  attendees: [],
  secrets: [],
  startedAt: null,
  endedAt: null
});

/**
 * @param {{ getFlag: (scope: string, key: string) => any }} page
 * @returns {{ sessionNumber: number|null, campaignDate: object|null, attendees: string[], secrets: object[], startedAt: number|null, endedAt: number|null }}
 */
export function sessionData(page) {
  const stored = page.getFlag("mej-campaign-companion", "session") ?? {};
  return { ...structuredClone(SESSION_DEFAULTS), ...stored };
}
