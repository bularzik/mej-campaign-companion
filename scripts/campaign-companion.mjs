import {
  MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE, HUB_PAGE_ID, TIMELINE_JOURNAL_SETTING, AUTO_LINK_SETTING,
  AUTO_CAPTURE_SETTING, MEDIA_CAPTURE_SETTING, PLAYERS_WRITE_SESSIONS_SETTING, SAVED_QUERIES_SETTING, PLAYER_GROUPS_SETTING,
  RETRO_LINK_MODE_SETTING, FORCE_NATIVE_MODE_SETTING, I18N, DATA_VERSION_SETTING, CURRENT_DATA_VERSION, AUTO_CAPTURE_CAMPAIGN_SETTING,
  HUB_CAMPAIGN_SCOPE_SETTING, ADOPTION_PROMPTED_SETTING
} from "./constants.mjs";
import { registerSocketDispatcher } from "./hooks/socket.mjs";
import { shouldOwnSessionEntry } from "./logic/session-ownership.mjs";
import { onHandshake, onReady, currentMode, wiringFailed, openHub, mejType, healSessionFlags } from "./integrations/mej-adapter.mjs";
import { MODE_ABSENT, MODE_API } from "./logic/mej-mode.mjs";

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

  game.settings.register(MODULE_ID, RETRO_LINK_MODE_SETTING, {
    name: `${I18N}.settings.retroLinkMode.name`,
    hint: `${I18N}.settings.retroLinkMode.hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: `${I18N}.settings.retroLinkMode.off`,
      confirm: `${I18N}.settings.retroLinkMode.confirm`,
      silent: `${I18N}.settings.retroLinkMode.silent`
    },
    default: "confirm"
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

  game.settings.register(MODULE_ID, PLAYERS_WRITE_SESSIONS_SETTING, {
    name: `${I18N}.settings.playersWriteSessions.name`,
    hint: `${I18N}.settings.playersWriteSessions.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SAVED_QUERIES_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, PLAYER_GROUPS_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Hidden client setting: pretend the extension API is absent. This is how
  // native mode gets exercised on a build that HAS the API (the e2e world),
  // and doubles as an escape hatch if shell integration ever misbehaves.
  game.settings.register(MODULE_ID, FORCE_NATIVE_MODE_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, DATA_VERSION_SETTING, {
    scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, {
    scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, ADOPTION_PROMPTED_SETTING, {
    scope: "world", config: false, type: Boolean, default: false
  });
});

// Grants player-writable default ownership to Session entries created
// through either of the companion's own creation paths (see
// logic/session-ownership.mjs's header comment for why one hook covers
// both), gated on the playersWriteSessions setting. GM-client-only: the
// dialogs/wizard this covers are GM-only affordances, and preCreateX hooks
// only ever fire locally on the client initiating the creation call (unlike
// the broadcast _onCreate patch MEJ itself uses, which needs its own
// `game.user.id !== userid` guard for that reason - no equivalent guard is
// needed here).
Hooks.on("preCreateJournalEntry", (entry, data) => {
  if (!game.user.isGM) return;
  const playersWriteSessions = game.settings.get(MODULE_ID, PLAYERS_WRITE_SESSIONS_SETTING);
  if (!shouldOwnSessionEntry(data, { sessionType: SESSION_TYPE, sessionDocumentType: SESSION_DOCUMENT_TYPE, playersWriteSessions })) return;
  entry.updateSource({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
});

Hooks.on("setupMonksEnhancedJournal", (api) => onHandshake(api));

// Toolbar entry: a button alongside MEJ's own header controls on every tab,
// opening (or re-activating) the Hub's shell-page tab.
Hooks.on("activateControls", (ej, ctrls) => {
  ctrls.push({
    id: HUB_PAGE_ID,
    label: game.i18n.localize(`${I18N}.hub.title`),
    icon: "fa-solid fa-timeline",
    type: "button",
    visible: true,
    callback: () => openHub()
  });
});

// "Open graph" header button on every MEJ subsheet (spec §5). MEJ's shell
// fires this hook while assembling v1-style header buttons for the mounted
// subsheet; label is an i18n key (MEJ's i18n() localizes it).
Hooks.on("getDocumentSheetHeaderButtons", (subsheet, buttons) => {
  const doc = subsheet?.document;
  if (!(doc instanceof JournalEntryPage)) return;
  if (!mejType(doc)) return;
  buttons.unshift({
    label: `${I18N}.graph.open`,
    class: "mej-cc-open-graph",
    icon: "fas fa-circle-nodes",
    onclick: async () => {
      const { openGraph } = await import("./apps/graph-app.mjs");
      openGraph({ centerUuid: doc.parent?.uuid ?? doc.uuid });
    }
  });

  // Phase C: prep board on Session sheets (GM-only, spec §8).
  if (game.user.isGM && mejType(doc) === SESSION_TYPE) {
    buttons.unshift({
      label: `${I18N}.prep.open`,
      class: "mej-cc-open-prep",
      icon: "fas fa-clipboard-list",
      onclick: async () => {
        try {
          const { openPrepBoard } = await import("./apps/prep-board-app.mjs");
          await openPrepBoard({ pageUuid: doc.uuid });
        } catch (err) {
          console.error(`${MODULE_ID} | prep board open failed`, err);
        }
      }
    });
  }
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
    onChange: () => openHub()
  };
});

Hooks.once("ready", async () => {
  const mode = await onReady();

  // Native mode is a SUPPORTED configuration, not an error - it gets no
  // warning. Only a missing MEJ, or a wiring step that actually threw,
  // is worth interrupting the GM for.
  if (mode === MODE_ABSENT || wiringFailed()) {
    const key = wiringFailed() ? "init-failed" : "mej-missing";
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.${key}`), { permanent: true });
    if (mode === MODE_ABSENT) return;
  }

  // Single shared socket listener for the whole module (media relay +
  // player recap relay) - see hooks/socket.mjs's header comment.
  registerSocketDispatcher();

  // A world that spent time on a stock MEJ install comes back with the MEJ
  // type flag scrubbed off its Session pages; put it back so MEJ's shell
  // routes them again. No-op in native mode and for non-active-GM clients.
  await healSessionFlags();

  // Spec §6: versioned migration hook. No migrations exist yet at version 1;
  // future schema changes bump CURRENT_DATA_VERSION and add steps here.
  if (game.user.isGM && game.settings.get(MODULE_ID, DATA_VERSION_SETTING) < CURRENT_DATA_VERSION) {
    await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);
  }
});
