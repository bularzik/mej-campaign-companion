// Native-mode shell hosting on a stock Monk's Enhanced Journal (spec
// 2026-09-19 §4). Four wraps, installed as a unit; any failure uninstalls
// the lot and reports window hosting. Line numbers cite MEJ 13.06
// apps/enhanced-journal.js / monks-enhanced-journal.js; 14.01 is identical
// at the points used (docs/superpowers/triage/2026-09-19-mej-shell-hosting-survey.md).
//
// Deferred import discipline (see campaign-companion.mjs's header): this file
// statically imports MEJ's own apps/enhanced-journal.js, so it must only ever
// be reached through a dynamic import from the adapter, never at top level.
import { EnhancedJournal } from "/modules/monks-enhanced-journal/apps/enhanced-journal.js";
import { MODULE_ID, HUB_PAGE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { installWraps, uninstallWraps } from "../logic/mej-wraps.mjs";
import { withCompanionTypes, isShellPageId } from "../logic/shell-shim-logic.mjs";
import { hubShellDocument, setHubSheetClass } from "../apps/hub-shell-document.mjs";

let records = [];

function env() {
  return {
    libWrapperModule: game.modules.get("lib-wrapper"),
    libWrapper: globalThis.libWrapper,
    moduleId: MODULE_ID,
    warn: (msg, err) => console.warn(`${MODULE_ID} | shell shim: ${msg}`, err ?? "")
  };
}

/**
 * Install the wraps. Returns the hosting the caller should use. Never throws:
 * window hosting is the answer for every failure, including one raised before
 * the wraps are even reached.
 * @returns {{hosting:"shell"|"window", installed:string[], failed:string|null}}
 */
export function installShellShim({ SessionSheet, CampaignHubPage }) {
  try {
    return install({ SessionSheet, CampaignHubPage });
  } catch (err) {
    console.warn(`${MODULE_ID} | shell hosting unavailable; using standalone windows`, err);
    return { hosting: "window", installed: [], failed: "install" };
  }
}

function install({ SessionSheet, CampaignHubPage }) {
  setHubSheetClass(CampaignHubPage);
  const mej = game.MonksEnhancedJournal;
  const hubDoc = () => hubShellDocument();
  const additions = { [SESSION_TYPE]: SessionSheet, [HUB_PAGE_ID]: CampaignHubPage };

  const specs = [
    {
      // Opens the shell's single-page demotion gate (:430-441) for session
      // entries, makes getMEJType recognise sessions, and stops fixType
      // (:4139-4141) unsetting the session flag.
      name: "getDocumentTypes", object: mej, key: "getDocumentTypes",
      path: "game.MonksEnhancedJournal.getDocumentTypes",
      wrapper(wrapped, ...args) { return withCompanionTypes(wrapped(...args), additions); }
    },
    {
      // Wrap 1 has a side effect stock MEJ never had to think about: with
      // "session" in the registry, fixType's tail (:4139-4141) now takes the
      // `object.type = type` branch and rewrites a Session page's in-memory
      // type to the bare MEJ key. That is harmless for MEJ's own types (all
      // of them are native "text" pages carrying a flag), but a Session
      // page's real Foundry subtype IS mej-campaign-companion.session: the
      // companion's whole identity test (logic/mej-type.mjs) and its sheet
      // registration hang off it, and Foundry's own DocumentSheetV2
      // constructor throws on the bare key ("Cannot convert undefined or
      // null to object" out of getSheetClassesForSubType - seen live on
      // 13.06 before this wrap). The fork's fixType carves external types
      // out for exactly this reason (14.0x monks-enhanced-journal.js
      // :1054-1076); on stock we put the type back afterwards.
      name: "fixType", object: mej, key: "fixType",
      wrapper(wrapped, object, settype) {
        const before = object?.type;
        const result = wrapped(object, settype);
        if (before === SESSION_DOCUMENT_TYPE && object.type !== before) object.type = before;
        return result;
      }
    },
    {
      // Resolves the Hub's synthetic tab id (also after a reload, when the
      // shell re-resolves persisted tabs through findEntity, :866-887).
      name: "findEntity", object: EnhancedJournal.prototype, key: "findEntity",
      wrapper(wrapped, entityId, text) {
        if (isShellPageId(entityId, HUB_PAGE_ID)) return Promise.resolve(hubDoc());
        return wrapped(entityId, text);
      }
    },
    {
      // 14.01 builds core's DocumentSheetConfig for the shell's document and
      // it throws on a synthetic type; 13.06 opens MEJ's own dialog, which is
      // meaningless for the Hub. Same early return on both.
      name: "onConfigureSheet", object: EnhancedJournal, key: "onConfigureSheet",
      wrapper(wrapped, ...args) {
        if (this?.document === hubDoc()) return;
        return wrapped(...args);
      }
    }
  ];

  const result = installWraps(specs, env());
  records = result.records;
  if (result.failed) {
    console.warn(`${MODULE_ID} | shell hosting unavailable (wrap "${result.failed}" not installable); using standalone windows`);
    return { hosting: "window", installed: [], failed: result.failed };
  }
  console.log(`${MODULE_ID} | shell hosting installed: ${result.installed.join(", ")}`);
  return { hosting: "shell", installed: result.installed, failed: null };
}

export function uninstallShellShim() {
  uninstallWraps(records, env());
  records = [];
}

/**
 * Open the Hub as a shell tab: same incantation as MEJ's openJournalEntry
 * tail (13.06 monks-enhanced-journal.js:2390-2401) and the fork's
 * openShellPage. open() is async on both 13.06 (:1266) and 14.01 (:1388);
 * MEJ's own tail does not await it, we do.
 */
export async function openHubInShell(options = {}) {
  const MEJ = game.MonksEnhancedJournal;
  if (!MEJ.journal?.rendered) {
    MEJ.journal = await (new EnhancedJournal(options)).render(true, options);
  }
  await MEJ.journal.open(hubShellDocument(), options.newtab === true, options);
}
