// The one module that knows which Monk's Enhanced Journal we are talking to.
//
// Everything mode-dependent lives here. The rest of the module is written
// once and runs identically on a stock MEJ install and on a build carrying
// the extension API - see docs/superpowers/specs/2026-08-17-mej-api-optional-design.md.
import {
  MODULE_ID, HUB_PAGE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE,
  FORCE_NATIVE_MODE_SETTING, I18N
} from "../constants.mjs";
import { resolveMode, MODE_API, MODE_NATIVE, MODE_ABSENT } from "../logic/mej-mode.mjs";
import { mejTypeWith, isSessionDoc } from "../logic/mej-type.mjs";
import { planFlagHeal } from "../logic/session-flag-heal.mjs";
import { missingSheetRegistrations } from "../logic/sheet-registration.mjs";
import { initSearchHooks } from "../search/live-index.mjs";
import { registerAutoLink } from "../hooks/auto-link.mjs";
import { registerRetroLink } from "../hooks/retro-link.mjs";
import { registerAutoCapture } from "../hooks/auto-capture.mjs";

let handshakeFired = false;
let mode = null;
let coreRegistered = false;
let wiringThrew = false;

/** @returns {"api"|"native"|"absent"|null} null until resolution happens. */
export function currentMode() {
  return mode;
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
}

/** Shell-integrated Session sheet + Hub tab, via MEJ's extension API. */
async function wireApiMode(api) {
  // Deferred imports: these two files statically import MEJ's
  // EnhancedJournalSheet.js, and our script tag runs BEFORE MEJ's. Importing
  // them at top level would re-enter MEJ's own import chain mid-evaluation
  // and take both modules down - see campaign-companion.mjs's header comment.
  const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs")
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

  // Foundry's DocumentSheetV2 machinery needs an entry in
  // CONFIG.JournalEntryPage.sheetClasses for the Hub's synthetic type or
  // getSheetThemeForDocument throws while constructing the sheet. See the
  // long comment this replaced in campaign-companion.mjs for why poking
  // CONFIG directly does not stick.
  registerHubSheetClass(CampaignHubPage);
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
 * Repair sheet registrations Foundry's pre-ready registerSheet queue may
 * have silently dropped (see onHandshake's comment for the mechanism). Safe
 * to call any time after game.ready is true, in either mode: registerSheet
 * applies immediately once ready, so a repair here always sticks. Cheap and
 * idempotent when nothing was dropped - the CONFIG lookup is synchronous and
 * the dynamic imports only happen when something actually needs fixing.
 */
async function ensureSheetRegistrations() {
  const missing = missingSheetRegistrations(
    CONFIG.JournalEntryPage.sheetClasses, SESSION_DOCUMENT_TYPE, HUB_PAGE_ID
  );
  if (!missing.session && !missing.hub) return;

  console.log(`${MODULE_ID} | re-registering sheet classes Foundry dropped before ready`, missing);
  const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs")
  ]);

  if (missing.session) {
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, SessionSheet, {
      types: [SESSION_DOCUMENT_TYPE],
      makeDefault: true,
      label: `${I18N}.sheettype.session`
    });
  }
  if (missing.hub) registerHubSheetClass(CampaignHubPage);
}

/** Standalone Session sheet + Hub window, for a stock MEJ install. */
async function wireNativeMode() {
  // Same deferred-import discipline as api mode: these files statically
  // import MEJ's EnhancedJournalSheet.js.
  const [{ SessionSheet }, { CampaignHubPage }] = await Promise.all([
    import("../sheets/SessionSheet.mjs"),
    import("../apps/CampaignHubPage.mjs")
  ]);

  // Pure core Foundry - no MEJ involvement. The subtype itself comes from
  // module.json's documentTypes declaration, so this only says "when Foundry
  // opens a page of that type, use our sheet". SessionSheet needs no changes
  // to work outside MEJ's shell: EnhancedJournalSheet._onRender already calls
  // activateListeners/subRender, and trueElement falls back to this.element.
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, SessionSheet, {
    types: [SESSION_DOCUMENT_TYPE],
    makeDefault: true,
    label: `${I18N}.sheettype.session`
  });

  // The Hub's synthetic type needs its sheetClasses entry in this mode too -
  // getSheetThemeForDocument does the same lookup however the sheet is hosted.
  registerHubSheetClass(CampaignHubPage);
}

/** Called from MEJ's setupMonksEnhancedJournal hook. */
export async function onHandshake(api) {
  handshakeFired = true;
  // forceNativeMode: ignore the API entirely and let the ready path wire
  // native mode, so native mode is testable on an API-carrying build.
  if (forceNative()) return;

  mode = MODE_API;
  // wireApiMode first, registerCore second: Foundry's DocumentSheetConfig
  // drains its pre-ready registerSheet queue exactly once, at some point
  // during setupGame() before game.ready flips - see initializeSheets() in
  // Foundry's document-sheet-config.mjs. registerCore() pulls in several
  // more dynamic imports than wireApiMode does; running it first risked
  // pushing wireApiMode's registerSheet calls past that one-time drain into
  // a window nothing will ever empty again (confirmed live: sheetClasses
  // stayed permanently empty for our types when registerCore ran first).
  // onReady()'s ensureSheetRegistrations() is the safety net if this order
  // ever loses the race again.
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

  await registerCore();
  await step("native-mode wiring", () => wireNativeMode());
  await step("sheet registration check", () => ensureSheetRegistrations());
  return mode;
}

/** Open the Campaign Hub: a shell tab in api mode, a window in native mode. */
export async function openHub() {
  try {
    if (mode === MODE_ABSENT) return;
    if (mode === MODE_API) {
      await game.MonksEnhancedJournal.openShellPage(HUB_PAGE_ID);
      return;
    }
    const { openHubWindow } = await import("../apps/hub-window.mjs");
    await openHubWindow();
  } catch (err) {
    console.error(`${MODULE_ID} | opening the campaign hub failed`, err);
  }
}

/**
 * Re-stamp the MEJ type flag on Session pages that lost it to a stock MEJ
 * install (its fixType unsets flags for types its registry does not know).
 * API mode only, active GM only, silent. Returns how many pages were fixed.
 * @returns {Promise<number>}
 */
export async function healSessionFlags() {
  if (mode !== MODE_API) return 0;
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
