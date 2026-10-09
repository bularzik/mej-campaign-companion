// Pure decisions for the GM player-access check (spec 2026-10-08
// player-access-check). No Foundry globals so vitest loads it directly; the
// Foundry glue lives in hooks/player-access.mjs.
//
// MEJ's openJournalEntry refuses every non-GM while its world setting
// "allow-player" is off (13.06 monks-enhanced-journal.js ~2311, same on
// 14.x), and that setting defaults to off - so players get Foundry's default
// journal editor and the companion does not work for them.
import { MODULE_ID, MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING, WARN_PLAYER_ACCESS_SETTING } from "../constants.mjs";

export const MEJ_ALLOW_PLAYER_FULL_KEY = `${MEJ_MODULE_ID}.${MEJ_ALLOW_PLAYER_SETTING}`;

/**
 * Whether this client should show the GM dialog. `allowPlayer` is undefined
 * when MEJ's setting is not registered - skip rather than guess.
 */
export function shouldOfferPlayerAccess({ isGM, allowPlayer, warnEnabled }) {
  return isGM === true && allowPlayer === false && warnEnabled === true;
}

/**
 * Whether a setting broadcast should ask this client to reload: players
 * only, MEJ's allow-player only, and only for a change to on. `oldValue` is
 * undefined when the setting record did not exist yet (createSetting).
 */
export function shouldPromptReload({ isGM, key, oldValue, newValue }) {
  return !isGM && key === MEJ_ALLOW_PLAYER_FULL_KEY && newValue === true && oldValue !== true;
}

/** The setting writes for a dialog result, in the order they are applied. */
export function playerAccessWrites({ enable, dontShowAgain }) {
  const writes = [];
  if (enable) writes.push({ namespace: MEJ_MODULE_ID, key: MEJ_ALLOW_PLAYER_SETTING, value: true });
  if (dontShowAgain) writes.push({ namespace: MODULE_ID, key: WARN_PLAYER_ACCESS_SETTING, value: false });
  return writes;
}
