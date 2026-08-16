import { MODULE_ID, SESSION_TYPE, I18N } from "./constants.mjs";

let apiReceived = false;

Hooks.on("setupMonksEnhancedJournal", (api) => {
  apiReceived = true;
  // SessionSheet registration added in Task 5; Hub page in Task 7.
});

Hooks.once("ready", () => {
  if (!apiReceived) {
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.mej-api-missing`), { permanent: true });
    return;
  }
});
