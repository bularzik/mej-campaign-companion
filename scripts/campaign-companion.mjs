import {
  MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE, HUB_PAGE_ID, TIMELINE_JOURNAL_SETTING, AUTO_LINK_SETTING,
  AUTO_CAPTURE_SETTING, MEDIA_CAPTURE_SETTING, PLAYERS_WRITE_SESSIONS_SETTING, SAVED_QUERIES_SETTING, PLAYER_GROUPS_SETTING, I18N
} from "./constants.mjs";
import { initSearchHooks } from "./search/live-index.mjs";
import { registerAutoLink } from "./hooks/auto-link.mjs";
import { registerAutoCapture } from "./hooks/auto-capture.mjs";
import { registerSocketDispatcher } from "./hooks/socket.mjs";
import { shouldOwnSessionEntry } from "./logic/session-ownership.mjs";

let apiReceived = false;
// Distinguishes "setupMonksEnhancedJournal never fired at all" (MEJ missing
// the extension API) from "it fired but our own registration threw" (a bug
// in this module) for the ready hook's user-facing message below - both
// leave apiReceived false, but they're different problems for a GM to act on.
let apiSetupThrew = false;

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

Hooks.on("setupMonksEnhancedJournal", async (api) => {
  // apiReceived only flips to true once every registration step below has
  // actually completed - it's what the ready-hook check further down uses
  // to decide whether to warn the GM the module isn't working. Setting it
  // eagerly here (as a previous version of this file did) meant that if
  // either dynamic import (or any registration call) below rejected, the
  // ready hook would still see apiReceived === true and stay silent - the
  // module would be completely non-functional with no user-facing signal
  // at all. Wrapping the whole body in try/catch and only setting the flag
  // on the success path (with a *second*, more precise, "actually failed to
  // initialize" message when the API was received but registration itself
  // threw) fixes both halves of that gap.
  try {
    // SessionSheet.mjs and CampaignHubPage.mjs both statically import MEJ's
    // EnhancedJournalSheet.js. Foundry emits each active module's <script
    // type=module> tags sorted by module id, with no regard for
    // relationships.requires - "mej-campaign-companion" sorts before
    // "monks-enhanced-journal" alphabetically, so this module's own script
    // tag runs FIRST. A static top-level import of EnhancedJournalSheet.js
    // (the pattern API.md's own worked example shows) would then make this
    // module the first to touch it, re-entering MEJ's own monks-enhanced-
    // journal.js -> apps/enhanced-journal.js -> sheets/BlankSheet.js import
    // chain *while EnhancedJournalSheet.js's own class statement is still
    // mid-evaluation* - a `ReferenceError: Cannot access 'EnhancedJournalSheet'
    // before initialization` that aborts monks-enhanced-journal.js's entire
    // module evaluation (game.MonksEnhancedJournal never gets assigned, no
    // hooks fire, both modules go dark). Confirmed live via Task 14's e2e
    // suite (00-mej-api.spec.mjs) - see task-14-report.md.
    //
    // Deferring these two imports to inside this hook (which only runs once
    // MEJ's own init() has already run to completion and fired
    // setupMonksEnhancedJournal - i.e. after EnhancedJournalSheet.js's class
    // statement has long since executed via MEJ's own script tag) sidesteps
    // the race entirely without needing an MEJ-side fix.
    const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
      import("./sheets/SessionSheet.mjs"),
      import("./apps/CampaignHubPage.mjs")
    ]);

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

    // registerShellPage deliberately doesn't merge a shell page's id into
    // CONFIG.JournalEntryPage.sheetClasses (API.md's own "shell pages are not
    // full citizens of MEJ's theming/state system" limitation) - but Foundry's
    // *base* DocumentSheetV2/ApplicationV2 machinery unconditionally needs an
    // entry there regardless: EnhancedJournalSheet's own
    // _initializeApplicationOptions() calls
    // DocumentSheetConfig.getSheetThemeForDocument(), which does
    // `Object.values(CONFIG.JournalEntryPage.sheetClasses[type])` - `undefined`
    // for any id that never went through registerSheetType, so `.values()`
    // throws and aborts construction of the Hub's sheet entirely (confirmed
    // live via Task 14's e2e suite: the Hub tab opened but nothing ever
    // rendered inside it). Directly poking CONFIG.JournalEntryPage.sheetClasses
    // doesn't stick - it's a derived cache DocumentSheetConfig rebuilds from
    // its own internal registry once `game.ready` becomes true (registrations
    // made before that, like this whole hook's, are queued in a private
    // #pending array and applied then - see
    // client/applications/apps/document-sheet-config.mjs's registerSheet(),
    // confirmed live: a directly-poked key was observably present
    // immediately after this line but gone again ~1s later). Route through
    // the same real DocumentSheetConfig.registerSheet() call registerSheetType
    // itself uses instead, so this entry survives that rebuild like "session"'s
    // does. CampaignHubPage never actually renders as a *real* JournalEntryPage
    // of this type (the id is only ever used for the synthetic BlankJournal
    // shell-page document), so this is purely additive - it only exists to
    // make getSheetThemeForDocument's lookup resolve to "no configured
    // classes" instead of throwing, exactly the no-per-type-theming
    // degradation API.md already documents as expected for shell pages.
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
      types: [HUB_PAGE_ID],
      makeDefault: false,
      canBeDefault: false,
      canConfigure: false,
      label: `${I18N}.hub.title`
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

    // Injects the Phase B knowledge panel (tags/attributes/backlinks) into
    // every MEJ-typed sheet. Dynamic import: knowledge-ui.mjs imports
    // live-index.mjs (safe) but keep the pattern consistent and cheap.
    const { registerKnowledgePanel } = await import("./hooks/knowledge-ui.mjs");
    registerKnowledgePanel();

    // Registers the @CampaignQuery[...] text enricher for embedding live
    // permission-filtered query results into journal pages.
    const { registerQueryEnricher } = await import("./hooks/query-enricher.mjs");
    registerQueryEnricher();

    // Phase C: block-level secret reveal UI (GM overlay + player
    // re-enrichment). Dynamic import — it reaches live Foundry globals and
    // the audience dialog; nothing MEJ-static, but keep the pattern.
    const { registerSecretsUi } = await import("./hooks/secrets-ui.mjs");
    registerSecretsUi();

    // Phase C: per-player/group relationship reveal overlay (row visibility
    // for hidden relationship rows, secret-label audience for the free-text
    // secret field). Same dynamic-import pattern as registerSecretsUi above.
    const { registerRelationshipsUi } = await import("./hooks/relationships-ui.mjs");
    registerRelationshipsUi();

    // Only now, with every registration step above having actually
    // succeeded, do we consider the API "received" for the ready hook's
    // purposes below.
    apiReceived = true;
  } catch (err) {
    apiSetupThrew = true;
    console.error(`${MODULE_ID} | setupMonksEnhancedJournal handler failed`, err);
    // apiReceived stays false - the ready hook below will surface this to
    // the GM rather than leaving the module silently non-functional.
  }
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

// "Open graph" header button on every MEJ subsheet (spec §5). MEJ's shell
// fires this hook while assembling v1-style header buttons for the mounted
// subsheet; label is an i18n key (MEJ's i18n() localizes it).
Hooks.on("getDocumentSheetHeaderButtons", (subsheet, buttons) => {
  const doc = subsheet?.document;
  if (!(doc instanceof JournalEntryPage)) return;
  if (!game.MonksEnhancedJournal?.getMEJType?.(doc)) return;
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
  if (game.user.isGM && game.MonksEnhancedJournal.getMEJType(doc) === SESSION_TYPE) {
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
    onChange: () => game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)
  };
});

Hooks.once("ready", () => {
  if (!apiReceived) {
    const key = apiSetupThrew ? "init-failed" : "mej-api-missing";
    ui.notifications.error(game.i18n.localize(`${I18N}.errors.${key}`), { permanent: true });
    return;
  }

  // Single shared socket listener for the whole module (media relay +
  // player recap relay) - see hooks/socket.mjs's header comment.
  registerSocketDispatcher();
});
