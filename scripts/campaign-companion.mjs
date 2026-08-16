import { MODULE_ID, SESSION_TYPE, I18N } from "./constants.mjs";
import { SessionSheet } from "./sheets/SessionSheet.mjs";

let apiReceived = false;

Hooks.on("setupMonksEnhancedJournal", (api) => {
  apiReceived = true;

  api.registerSheetType({
    key: SESSION_TYPE,
    moduleId: MODULE_ID,
    sheetClass: SessionSheet,
    label: `${I18N}.sheettype.session`,
    icon: "fa-dice-d20",
    relationships: ["person", "place", "quest", "encounter", "event", "organization", "loot", "shop", "poi"]
  });

  // Hub page added in Task 7.
});

Hooks.once("ready", () => {
  if (!apiReceived) {
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.mej-api-missing`), { permanent: true });
    return;
  }
});
