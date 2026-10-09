// GM player-access check (spec 2026-10-08 player-access-check). On a GM's
// login, when MEJ's "Allow players to use Enhanced Journal" is off, explain
// that Campaign Companion won't work properly for players and offer to turn
// it on. Decisions are pure (logic/player-access.mjs); this file only reads
// and writes Foundry state. Never throws out of the ready hook.
import { MODULE_ID, I18N, MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING, WARN_PLAYER_ACCESS_SETTING } from "../constants.mjs";
import { shouldOfferPlayerAccess, playerAccessWrites } from "../logic/player-access.mjs";

/** MEJ's allow-player value, or undefined when MEJ has not registered it. */
export function readAllowPlayer() {
  if (!game.settings.settings.has(`${MEJ_MODULE_ID}.${MEJ_ALLOW_PLAYER_SETTING}`)) return undefined;
  return game.settings.get(MEJ_MODULE_ID, MEJ_ALLOW_PLAYER_SETTING) === true;
}

export async function checkPlayerAccessOnLogin() {
  try {
    const allowPlayer = readAllowPlayer();
    if (allowPlayer === undefined) {
      console.warn(`${MODULE_ID} | player-access check skipped: ${MEJ_MODULE_ID} has no "${MEJ_ALLOW_PLAYER_SETTING}" setting`);
      return;
    }
    const offer = shouldOfferPlayerAccess({
      isGM: game.user.isGM,
      allowPlayer,
      warnEnabled: game.settings.get(MODULE_ID, WARN_PLAYER_ACCESS_SETTING) === true
    });
    if (!offer) return;
    const { promptPlayerAccess } = await import("../apps/player-access-dialog.mjs");
    const result = await promptPlayerAccess();
    const writes = playerAccessWrites(result);
    try {
      for (const w of writes) await game.settings.set(w.namespace, w.key, w.value);
    } catch (err) {
      console.error(`${MODULE_ID} | player-access settings write failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.playerAccess.failed`));
      return;
    }
    if (result.enable) ui.notifications.info(game.i18n.localize(`${I18N}.playerAccess.enabled`));
  } catch (err) {
    console.error(`${MODULE_ID} | player-access check failed`, err);
  }
}
