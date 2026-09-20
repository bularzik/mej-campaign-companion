// The one module that knows which Monk's Enhanced Journal we are talking to.
//
// Everything mode-dependent lives here. The rest of the module is written
// once and runs identically on a stock MEJ install and on a build carrying
// the extension API - see docs/superpowers/specs/2026-08-17-mej-api-optional-design.md.
import {
  MODULE_ID, HUB_PAGE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE,
  CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE, MEDIA_PAGE_TYPES,
  FORCE_NATIVE_MODE_SETTING, SHELL_HOSTING_SETTING, I18N
} from "../constants.mjs";
import { resolveMode, MODE_API, MODE_NATIVE, MODE_ABSENT } from "../logic/mej-mode.mjs";
import { mejTypeWith, isSessionDoc } from "../logic/mej-type.mjs";
import { planFlagHeal } from "../logic/session-flag-heal.mjs";
import { planSheetRegistrations } from "../logic/sheet-registration.mjs";
import { initSearchHooks } from "../search/live-index.mjs";
import { registerAutoLink } from "../hooks/auto-link.mjs";
import { registerRetroLink } from "../hooks/retro-link.mjs";
import { registerAutoCapture } from "../hooks/auto-capture.mjs";
import { registerCampaignOwnership } from "../hooks/campaign-ownership.mjs";

let handshakeFired = false;
let mode = null;
let coreRegistered = false;
let wiringThrew = false;

// Resolves once onReady() has finished wiring, whichever mode it resolved.
// Created at module load rather than inside onReady() because the Hub's
// entry points are already live in the UI before onReady() is even called -
// see openHub(), which awaits it.
let readyWired;
/** Resolves when onReady() has finished wiring (success or failure). The ready gate (ready-gate.mjs) holds MEJ opens on it. */
export const readyWiring = new Promise((resolve) => { readyWired = resolve; });

// The sheet classes, imported once at init (registerSheetsEarly). Resolves to
// the class map, or to null when the import failed - every later consumer
// falls back to a fresh import then.
let earlySheets = null;

/** @returns {"api"|"native"|"absent"|null} null until resolution happens. */
export function currentMode() {
  return mode;
}

// Native-mode hosting, set by wireNativeMode(). Never "shell" in api mode
// (MEJ's own shell hosts us there) nor in absent mode (nothing to host in).
let hosting = null;

/** @returns {"shell"|"window"|null} native-mode hosting; null until native mode is wired. */
export function currentHosting() {
  return hosting;
}

/** True when a wiring step threw - the ready hook surfaces this to the GM. */
export function wiringFailed() {
  return wiringThrew;
}

/**
 * Drop-in for game.MonksEnhancedJournal.getMEJType that also recognises our
 * own Session pages by their native subtype (stock MEJ's registry does not).
 * @param {object} doc a JournalEntry or JournalEntryPage
 * @returns {string|false}
 */
export function mejType(doc) {
  return mejTypeWith(doc, (d) => game.MonksEnhancedJournal?.getMEJType?.(d));
}

function forceNative() {
  // Defensive: if module script order ever changed such that this is read
  // before our own init registered the setting, treat it as off rather than
  // throwing out of MEJ's handshake.
  try {
    return !!game.settings.get(MODULE_ID, FORCE_NATIVE_MODE_SETTING);
  } catch (err) {
    return false;
  }
}

/** Same defensive read as forceNative(), but shell hosting is the default. */
function shellHostingWanted() {
  try {
    return game.settings.get(MODULE_ID, SHELL_HOSTING_SETTING) !== false;
  } catch (err) {
    return true;
  }
}

/**
 * Observer posture: run one wiring step in isolation so a throw in it can't
 * prevent any other step (in registerCore or either mode-wiring function)
 * from running. Flags wiringThrew and logs; never rethrows.
 * @param {string} label short description for the console.error prefix
 * @param {() => (void|Promise<void>)} fn the step to run
 */
async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    wiringThrew = true;
    console.error(`${MODULE_ID} | ${label} failed to register`, err);
  }
}

/**
 * Everything that needs only Foundry hooks and MEJ's presence - i.e. all of
 * the module except the Session sheet and the Hub. Idempotent: whichever
 * mode path wins calls it exactly once. Each step is isolated via step() so
 * one broken feature can't take the others down with it.
 */
export async function registerCore() {
  if (coreRegistered) return;
  coreRegistered = true;

  await step("search hooks", () => initSearchHooks());
  await step("auto-link", () => registerAutoLink());
  await step("retro-link", () => registerRetroLink());
  await step("campaign ownership", () => registerCampaignOwnership());
  await step("auto-capture", () => registerAutoCapture());

  await step("knowledge panel", async () => {
    const { registerKnowledgePanel } = await import("../hooks/knowledge-ui.mjs");
    registerKnowledgePanel();
  });

  await step("create-dialog folder default", async () => {
    const { registerCreateDialogDefault } = await import("../hooks/create-dialog-default.mjs");
    registerCreateDialogDefault();
  });

  await step("query enricher", async () => {
    const { registerQueryEnricher } = await import("../hooks/query-enricher.mjs");
    registerQueryEnricher();
  });

  await step("secrets ui", async () => {
    const { registerSecretsUi } = await import("../hooks/secrets-ui.mjs");
    registerSecretsUi();
  });

  await step("relationships ui", async () => {
    const { registerRelationshipsUi } = await import("../hooks/relationships-ui.mjs");
    registerRelationshipsUi();
  });

  await step("portal rename sync", async () => {
    const { registerPortalSync } = await import("../hooks/portal-sync.mjs");
    registerPortalSync();
  });

  // Folder context menu ("Open Campaign Hub") is registered at "init" now,
  // not here - see campaign-companion.mjs's Hooks.once("init", ...) for why
  // registering this late (registerCore only ever runs from "setup"/"ready")
  // reliably missed the sidebar's own one-time ContextMenu construction.
}

/** Shell-integrated Session sheet + Hub tab, via MEJ's extension API. */
async function wireApiMode(api) {
  // The classes come from the init-time import (registerSheetsEarly), or a
  // fresh dynamic import here if that one failed. Deferred either way: these
  // files statically import MEJ's EnhancedJournalSheet.js, and our script tag
  // runs BEFORE MEJ's - importing them at top level would re-enter MEJ's own
  // import chain mid-evaluation and take both modules down, see
  // campaign-companion.mjs's header comment.
  const { SessionSheet, CampaignHubPage } = await companionSheetClasses();

  api.registerSheetType({
    key: SESSION_TYPE,
    moduleId: MODULE_ID,
    sheetClass: SessionSheet,
    label: `${I18N}.sheettype.session`,
    icon: "fa-dice-d20",
    relationships: ["person", "place", "quest", "encounter", "event", "organization", "loot", "shop", "poi"]
  });

  api.registerSheetType({
    key: CAMPAIGN_TYPE,
    moduleId: MODULE_ID,
    sheetClass: CampaignHubPage,
    label: `${I18N}.sheettype.campaign`,
    icon: "fa-flag",
    relationships: []
  });

  api.registerShellPage({
    id: HUB_PAGE_ID,
    label: `${I18N}.hub.title`,
    icon: "fa-timeline",
    appClass: CampaignHubPage
  });
}

/**
 * Shared by both modes: the Hub's synthetic page type must resolve in
 * CONFIG.JournalEntryPage.sheetClasses. Route through the real
 * DocumentSheetConfig.registerSheet so it survives the rebuild Foundry does
 * when game.ready flips.
 */
export function registerHubSheetClass(CampaignHubPage) {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
    types: [HUB_PAGE_ID],
    makeDefault: false,
    canBeDefault: false,
    canConfigure: false,
    label: `${I18N}.hub.title`
  });
}

/**
 * Route Foundry's native pdf/video pages to the companion's viewer sheet so
 * they open inside the MEJ shell (spec E §1). makeDefault claims them as the
 * default sheet; canConfigure stays true so a GM can opt an individual page
 * back to core's sheet. Registered in BOTH modes - the shell hosts it in api
 * mode, and it stands alone in native mode.
 */
export function registerMediaSheetClass(MediaPageSheet) {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, MediaPageSheet, {
    types: MEDIA_PAGE_TYPES,
    makeDefault: true,
    canBeDefault: true,
    canConfigure: true,
    label: `${I18N}.sheettype.media`
  });
}

/**
 * Timeline journals (spec 2026-09-03 §C) resolve to a sheet that never draws
 * and hands off to the Hub's Timeline tab. Against CONFIG.JournalEntry, not
 * JournalEntryPage, and against the native "base" type - so it is NEVER the
 * default (that would hijack every plain journal entry in the world); only a
 * document carrying flags.core.sheetClass === TIMELINE_SHEET_CLASS resolves
 * to it. canConfigure stays true so a GM can opt one back to a real sheet.
 */
export function registerTimelineSheetClass(TimelineJournalSheet) {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, TimelineJournalSheet, {
    types: ["base"],
    makeDefault: false,
    canBeDefault: false,
    label: `${I18N}.sheettype.timelineJournal`
  });
}

/**
 * The one place companion sheet classes are registered. Idempotent against
 * CONFIG once game.ready is true: performs only what planSheetRegistrations()
 * reports missing there, so the ready-time repair can call it safely no
 * matter how many times it runs. Before ready, CONFIG does not yet reflect a
 * queued registerSheet call, so planSheetRegistrations() cannot see it either
 * - a second pre-ready caller would queue a full duplicate set. Exactly one
 * caller may call this before ready: registerSheetsEarly(), from the init
 * hook (spec 2026-09-20-ready-wiring-window §3.1).
 * @param {{SessionSheet:Function, CampaignHubPage:Function, MediaPageSheet:Function, TimelineJournalSheet:Function}} classes
 * @returns {{session:boolean, hub:boolean, campaign:boolean, media:boolean, timeline:boolean}} what was registered
 */
export function registerCompanionSheets({ SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet }) {
  const missing = planSheetRegistrations(CONFIG.JournalEntryPage.sheetClasses, CONFIG.JournalEntry.sheetClasses, {
    sessionType: SESSION_DOCUMENT_TYPE, hubType: HUB_PAGE_ID, campaignType: CAMPAIGN_DOCUMENT_TYPE,
    mediaTypes: MEDIA_PAGE_TYPES, ownerScope: MODULE_ID
  });
  if (missing.session) {
    // Pure core Foundry - no MEJ involvement. The subtype itself comes from
    // module.json's documentTypes declaration, so this only says "when
    // Foundry opens a page of that type, use our sheet".
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, SessionSheet, {
      types: [SESSION_DOCUMENT_TYPE],
      makeDefault: true,
      label: `${I18N}.sheettype.session`
    });
  }
  if (missing.hub) registerHubSheetClass(CampaignHubPage);
  if (missing.campaign) {
    // Campaign portal pages: the portal's sheet IS the Hub - makeDefault /
    // canBeDefault so a core sidebar click opens it directly.
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
      types: [CAMPAIGN_DOCUMENT_TYPE],
      makeDefault: true,
      canBeDefault: true,
      canConfigure: false,
      label: `${I18N}.sheettype.campaign`
    });
  }
  if (missing.media) registerMediaSheetClass(MediaPageSheet);
  if (missing.timeline) registerTimelineSheetClass(TimelineJournalSheet);
  return missing;
}

/** The four sheet classes: from the init-time import when it succeeded, else imported now. */
async function companionSheetClasses() {
  const early = earlySheets ? await earlySheets : null;
  if (early) return early;
  const [{ SessionSheet }, { CampaignHubPage }, { MediaPageSheet }, { TimelineJournalSheet }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs"),
    import("../sheets/MediaPageSheet.mjs"),
    import("../sheets/TimelineJournalSheet.mjs")
  ]);
  return { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet };
}

/**
 * Called from the init hook when MEJ is active (spec §3.2). Starts the sheet
 * imports and registers the classes the moment they resolve - on a normal
 * boot well before Foundry's one-time pre-ready drain, so the registrations
 * exist when game.ready flips; if the imports resolve after the drain the
 * ready-time repair (ensureSheetRegistrations) picks them up as before. Not
 * awaited by the hook: Foundry does not await hook handlers. Dynamic, not
 * static, imports: these files statically import MEJ's EnhancedJournalSheet.js,
 * which is safe to load only after MEJ's own module has been evaluated - true
 * for every hook, never at our script's top level.
 */
export function registerSheetsEarly() {
  earlySheets = Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs"),
    import("../sheets/MediaPageSheet.mjs"),
    import("../sheets/TimelineJournalSheet.mjs")
  ]).then(([{ SessionSheet }, { CampaignHubPage }, { MediaPageSheet }, { TimelineJournalSheet }]) => {
    const classes = { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet };
    registerCompanionSheets(classes);
    return classes;
  }).catch((err) => {
    console.warn(`${MODULE_ID} | early sheet registration failed; the ready-time repair will retry`, err);
    return null;
  });
}

/**
 * Repair sheet registrations Foundry's pre-ready registerSheet queue may
 * have silently dropped (see sheet-registration.mjs's header comment for the
 * mechanism). Safe to call any time after game.ready is true, in either mode: registerSheet
 * applies immediately once ready, so a repair here always sticks. Cheap and
 * idempotent when nothing was dropped - companionSheetClasses() is awaited
 * unconditionally (usually just the already-settled earlySheets promise),
 * but the CONFIG lookup and registerSheet calls inside registerCompanionSheets
 * only fire for what planSheetRegistrations() actually reports missing.
 */
async function ensureSheetRegistrations() {
  const classes = await companionSheetClasses();
  const registered = registerCompanionSheets(classes);
  if (Object.values(registered).some(Boolean)) {
    console.log(`${MODULE_ID} | re-registering sheet classes Foundry dropped before ready`, registered);
  }
}

/** Standalone Session sheet + Hub window, for a stock MEJ install. */
async function wireNativeMode() {
  // Same as api mode: the classes come from the init-time import
  // (registerSheetsEarly), or a fresh dynamic import here if that one
  // failed - deferred either way, since these files statically import MEJ's
  // EnhancedJournalSheet.js.
  const { SessionSheet, CampaignHubPage } = await companionSheetClasses();

  // Shell hosting (spec 2026-09-19 §4): wraps installed as a unit; window
  // hosting is the fallback whether the setting is off or a wrap failed.
  hosting = "window";
  if (shellHostingWanted()) {
    // Its OWN try/catch, not step()'s: window hosting is a supported
    // configuration, so a shim that cannot even be imported (a stock MEJ
    // that moved apps/enhanced-journal.js, say) must leave `hosting` at
    // "window" and warn - never set wiringThrew, which would put the
    // "initialisation failed" error notification in front of a GM whose
    // module is in fact working. installShellShim itself never throws
    // (spec §4.1); this covers the import that reaches it.
    try {
      const { installShellShim } = await import("./shell-shim.mjs");
      const result = installShellShim({ SessionSheet, CampaignHubPage });
      hosting = result.hosting;
    } catch (err) {
      console.warn(`${MODULE_ID} | shell hosting unavailable (the adaptation could not be loaded); using standalone windows`, err);
    }
  }
}

/** Called from MEJ's setupMonksEnhancedJournal hook. */
export async function onHandshake(api) {
  handshakeFired = true;
  // forceNativeMode: ignore the API entirely and let the ready path wire
  // native mode, so native mode is testable on an API-carrying build.
  if (forceNative()) return;

  mode = MODE_API;
  // wireApiMode first, registerCore second: wireApiMode is cheap (a handful
  // of api.register* calls plus the already-resolving companionSheetClasses()
  // promise), while registerCore() pulls in a dozen sequential dynamic
  // imports - running the cheap step first gets the shell tab and sheet types
  // registered sooner. This ordering has no bearing on sheet registrations
  // surviving Foundry's one-time pre-ready registerSheet drain: wireApiMode
  // itself performs none. Sheet classes are registered at init
  // (registerSheetsEarly, see its own comment for the drain mechanism), with
  // ensureSheetRegistrations() at ready as the repair - so neither this
  // order nor registerCore's imports can cause a registration to be lost.
  await step("api-mode wiring", () => wireApiMode(api));
  await registerCore();
  console.log(`${MODULE_ID} | mode: ${mode}`);
}

/**
 * Called from the ready hook. Resolves the mode if the handshake never got
 * there first, and wires whatever that mode needs.
 * @returns {Promise<"api"|"native"|"absent">}
 */
export async function onReady() {
  try {
    return await wireForReady();
  } finally {
    // In a finally so a throw anywhere above still releases openHub() - a
    // GM left with a Hub button that hangs forever would be worse than one
    // that reports the failure the wiring already logged.
    readyWired();
  }
}

/** onReady()'s actual wiring; split out so onReady owns only the signalling. */
async function wireForReady() {
  if (mode === MODE_API) {
    // game.ready is definitely true here, so registerSheet applies
    // immediately - this repairs anything onHandshake's registerSheet calls
    // lost to Foundry's pre-ready drain (see onHandshake's comment). Not
    // hoisted above mode resolution: an absent-mode world must stay
    // completely inert, and this dynamically imports SessionSheet/
    // CampaignHubPage, both of which extend MEJ's own EnhancedJournalSheet -
    // safe once we know MEJ actually wired us up, not before.
    await step("sheet registration check", () => ensureSheetRegistrations());
    return mode;
  }

  const mejActive = !!game.modules.get("monks-enhanced-journal")?.active;
  mode = resolveMode({ handshakeFired, mejActive, forceNative: forceNative() });
  console.log(`${MODULE_ID} | mode: ${mode}`);
  if (mode === MODE_ABSENT) return mode;

  // Shim first, core features second (spec 2026-09-20-ready-wiring-window
  // §3.4): registerCore() awaits a dozen sequential dynamic imports, and
  // the shim used to wait behind all of them - 430-924 ms after the ready
  // hook on 2026-09-20's measurement. The sheet classes are registered at
  // init (registerSheetsEarly) and repaired here if that import lost the
  // race with Foundry's pre-ready drain.
  await step("native-mode wiring", () => wireNativeMode());
  await step("sheet registration check", () => ensureSheetRegistrations());
  await registerCore();
  return mode;
}

/**
 * Open the Campaign Hub: a shell tab in api mode, and in native mode too
 * when the shim installed; a standalone window otherwise.
 */
export async function openHub() {
  try {
    // Wait for onReady()'s wiring before dispatching on `mode`. Every entry
    // point to the Hub is live in the UI before that wiring finishes:
    // Foundry fires getSceneControlButtons from initializeUI(), i.e. before
    // game.ready flips, while our ready hook still has registerCore()'s
    // dozen dynamic imports and the mode wiring ahead of it. A click landing
    // in that window reached openHubWindow() before registerHubSheetClass()
    // had run, and Foundry 13's DocumentSheetV2 constructor then threw on
    // the missing CONFIG.JournalEntryPage.sheetClasses["campaign-hub"] entry
    // (getSheetThemeForDocument -> getSheetClassesForSubType ->
    // Object.values(undefined)) - the click was simply lost, and only a
    // second click after the wiring landed worked. Reproduced live on
    // 13.351 + stock MEJ 13.06. Free on every later click: already resolved.
    await readyWiring;
    if (mode === MODE_ABSENT) return;
    if (mode === MODE_API) {
      await game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID);
      return;
    }
    if (mode === MODE_NATIVE && hosting === "shell") {
      const { openHubInShell } = await import("./shell-shim.mjs");
      await openHubInShell();
      return;
    }
    const { openHubWindow } = await import("../apps/hub-window.mjs");
    await openHubWindow();
  } catch (err) {
    console.error(`${MODULE_ID} | opening the campaign hub failed`, err);
  }
}

/**
 * Open a Session page the way the current mode hosts it.
 *
 * Native mode with shell hosting is the only case that needs MEJ's own open
 * path, and even there MEJ may refuse: openJournalEntry returns false for a
 * non-GM without allow-player, a LIMITED user, monks-common-display /
 * conversation-hud, and a vetoed hook (13.06 monks-enhanced-journal.js's
 * openJournalEntry head). Fall back to the page's own sheet whenever it
 * says no. Api mode is unchanged from before shell hosting existed: MEJ's
 * shell picks the sheet up from a plain render.
 *
 * MEJ's open path can THROW as well as return false (13.06's own
 * _renderPageViews is the crash this module already carries
 * sheets/awaitable-render.mjs for), and a throw here would lose the click
 * entirely - the caller is usually a UI handler. Treat it exactly like a
 * refusal and fall through to the page's own sheet, which is the supported
 * window-hosting path anyway.
 */
export async function openSessionPage(page) {
  if (mode === MODE_NATIVE && hosting === "shell") {
    try {
      if (await game.MonksEnhancedJournal.openJournalEntry(page)) return;
    } catch (err) {
      console.warn(`${MODULE_ID} | MEJ's open path threw for "${page?.name}"; opening the session in its own window`, err);
    }
  }
  await page.sheet.render(true);
}

/**
 * Re-stamp the MEJ type flag on Session pages that lost it to a stock MEJ
 * install (its fixType unsets flags for types its registry does not know).
 * Shell-hosted modes only (api, or native with the shim), active GM only,
 * silent. Returns how many pages were fixed.
 * @returns {Promise<number>}
 */
export async function healSessionFlags() {
  // Api mode, or native mode with shell hosting (wrap 1 keeps stock MEJ's
  // fixType from scrubbing the flag again). Window hosting: stock MEJ would
  // scrub it back on the next open, so re-stamping is pointless there.
  if (!(mode === MODE_API || (mode === MODE_NATIVE && hosting === "shell"))) return 0;
  if (game.users.activeGM !== game.user) return 0;

  try {
    const sessionPages = [];
    for (const entry of game.journal.contents) {
      for (const page of entry.pages.contents) {
        if (!isSessionDoc(page)) continue;
        sessionPages.push({
          uuid: page.uuid,
          flagType: page.getFlag("monks-enhanced-journal", "type")
        });
      }
    }

    const uuids = planFlagHeal(sessionPages);
    for (const uuid of uuids) {
      const page = await fromUuid(uuid);
      await page?.setFlag("monks-enhanced-journal", "type", SESSION_TYPE);
    }
    if (uuids.length) {
      console.log(`${MODULE_ID} | re-stamped the MEJ type flag on ${uuids.length} session page(s)`);
    }
    return uuids.length;
  } catch (err) {
    console.error(`${MODULE_ID} | session flag heal failed`, err);
    return 0;
  }
}
