import {
  MODULE_ID, SESSION_TYPE, HUB_PAGE_ID, TIMELINE_JOURNAL_SETTING, AUTO_LINK_SETTING,
  AUTO_CAPTURE_SETTING, MEDIA_CAPTURE_SETTING, I18N
} from "./constants.mjs";
import { SessionSheet } from "./sheets/SessionSheet.mjs";
import { CampaignHubPage } from "./apps/CampaignHubPage.mjs";
import { initSearchHooks } from "./search/live-index.mjs";
import { registerAutoLink } from "./hooks/auto-link.mjs";
import { registerAutoCapture } from "./hooks/auto-capture.mjs";

let apiReceived = false;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, TIMELINE_JOURNAL_SETTING, {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, AUTO_LINK_SETTING, {
    name: `${I18N}.settings.autoLink.name`,
    hint: `${I18N}.settings.autoLink.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, AUTO_CAPTURE_SETTING, {
    name: `${I18N}.settings.autoCaptureEncounters.name`,
    hint: `${I18N}.settings.autoCaptureEncounters.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, MEDIA_CAPTURE_SETTING, {
    name: `${I18N}.settings.autoCaptureSharedMedia.name`,
    hint: `${I18N}.settings.autoCaptureSharedMedia.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

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

  api.registerShellPage({
    id: HUB_PAGE_ID,
    label: `${I18N}.hub.title`,
    icon: "fa-timeline",
    appClass: CampaignHubPage
  });

  // Registers the createJournalEntryPage/updateJournalEntryPage/
  // deleteJournalEntryPage listeners once. The index itself builds lazily
  // (ensureIndex(), first called from the Hub's search pane) - this only
  // wires the hooks that keep it current afterward.
  initSearchHooks();

  // Wires the preUpdateJournalEntryPage listener that auto-links newly-typed
  // MEJ entry names in a page's text.content (gated on the "autoLink"
  // world setting, checked per-update inside the hook itself).
  registerAutoLink();

  // Wires the combat-end Encounter capture and shareImage capture wraps
  // (each gated on its own world setting, checked inside the hook itself).
  registerAutoCapture();
});

// Toolbar entry: a button alongside MEJ's own header controls on every tab,
// opening (or re-activating) the Hub's shell-page tab.
Hooks.on("activateControls", (ej, ctrls) => {
  ctrls.push({
    id: HUB_PAGE_ID,
    label: game.i18n.localize(`${I18N}.hub.title`),
    icon: "fa-solid fa-timeline",
    type: "button",
    visible: true,
    callback: () => game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)
  });
});

// GM-side scene-controls entry point, mirroring how MEJ itself adds a toggle
// to the notes control group (see monks-enhanced-journal.js's own
// getSceneControlButtons listener: controls.notes.tools[key] = {...}, the
// v14 object-keyed shape - not the pre-v14 array-of-tools shape).
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const noteControls = controls.notes;
  if (!noteControls?.tools) return;
  noteControls.tools[HUB_PAGE_ID] = {
    name: HUB_PAGE_ID,
    order: Object.keys(noteControls.tools).length,
    title: `${I18N}.hub.title`,
    icon: "fas fa-timeline",
    button: true,
    onChange: () => game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)
  };
});

Hooks.once("ready", () => {
  if (!apiReceived) {
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.mej-api-missing`), { permanent: true });
    return;
  }
});
