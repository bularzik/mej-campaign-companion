// Pure logic for detecting sheet-class registrations Foundry silently
// dropped. See mej-adapter.mjs's onHandshake for the full mechanism: Foundry
// queues any registerSheet call made before game.ready and drains that queue
// exactly once, at some point during setupGame() before the ready flip. A
// registration arriving after that one-time drain but before game.ready is
// pushed onto a queue nothing will ever empty again - silently dropped, no
// error. This module answers "did that happen to us?" so the adapter can
// repair it once game.ready is definitely true and registerSheet applies
// immediately.

/**
 * Which of our sheet registrations failed to take effect?
 * @param {object} sheetClasses   CONFIG.JournalEntryPage.sheetClasses (or a lookalike)
 * @param {string} sessionType    the native Session subtype key
 * @param {string} hubType        the Hub's synthetic type key
 * @param {string} campaignType   the native campaign-portal subtype key
 * @param {string[]} [mediaTypes] the native media subtype keys (e.g. pdf, video)
 * @param {string} [ownerScope]   our own registerSheet scope (the module id) - used ONLY by
 *                                the media check below, to tell OUR registration apart from
 *                                core's. Defaults to "", which deliberately never reads as
 *                                registered (see the media comment).
 * @returns {{session: boolean, hub: boolean, campaign: boolean, media: boolean}} true = missing, needs registering
 */
export function missingSheetRegistrations(sheetClasses, sessionType, hubType, campaignType, mediaTypes = [], ownerScope = "") {
  // sessionType/hubType/campaignType are all module-owned types - nothing
  // else in Foundry ever registers a sheet for them, so "any key present at
  // all" correctly means "we're registered". Deliberately NOT rescoped to
  // ownerScope like media below: this works today, and rescoping types that
  // aren't the bug risks breaking a repair path that's already correct.
  const has = (t) => Object.keys((sheetClasses ?? {})[t] ?? {}).length > 0;

  // media is different: pdf/video are NATIVE Foundry types core itself
  // registers a sheet for - CONFIG.JournalEntryPage.sheetClasses.pdf/.video
  // always carry a `core.JournalEntryPagePDFSheet`/`core.JournalEntryPageVideoSheet`
  // entry regardless of whether our own registration landed, so `has()`
  // alone would report "registered" even when only core's entry is present.
  // Scope the check to a registration key that starts with OUR OWN
  // `${ownerScope}.` prefix (registerSheet's key format is
  // `${scope}.${sheetClass.name}` - see document-sheet-config.mjs) instead
  // of merely checking presence. An empty ownerScope must NOT silently read
  // as "registered" just because some key happens to exist (that's exactly
  // how this bug shipped) - hasOurs() returns false outright when ownerScope
  // is empty, so a non-empty mediaTypes list always reports missing until a
  // real scope is supplied.
  const hasOurs = (t) => {
    if (!ownerScope) return false;
    return Object.keys((sheetClasses ?? {})[t] ?? {}).some((key) => key.startsWith(`${ownerScope}.`));
  };

  return {
    session: !has(sessionType),
    hub: !has(hubType),
    campaign: !has(campaignType),
    // Media covers however many native types mediaTypes lists (today pdf and
    // video); report missing if OUR OWN registration is absent from ANY of
    // them, so a partial repair still re-runs and core's co-registration for
    // an untouched type never masks a dropped one.
    media: (mediaTypes ?? []).some((t) => !hasOurs(t))
  };
}

/**
 * Did OUR OWN registration for `type` survive, in an arbitrary sheetClasses
 * map? Same `${ownerScope}.` discipline as hasOurs above, exposed separately
 * because the timeline redirect sheet (TIMELINE_SHEET_CLASS) registers
 * against CONFIG.JournalEntry - a different document class, and a NATIVE
 * type ("base") core always has its own entry under, so mere presence would
 * read as registered. An empty ownerScope always reports missing.
 * @param {object} sheetClasses  CONFIG.<Document>.sheetClasses (or a lookalike)
 * @param {string} type          the document sub-type key
 * @param {string} ownerScope    our registerSheet scope (the module id)
 * @returns {boolean} true = missing, needs registering
 */
export function missingOwnRegistration(sheetClasses, type, ownerScope) {
  if (!ownerScope) return true;
  return !Object.keys((sheetClasses ?? {})[type] ?? {}).some((key) => key.startsWith(`${ownerScope}.`));
}

/**
 * Everything the companion must (re)register, in one answer: the page-sheet
 * checks above plus the timeline redirect sheet on CONFIG.JournalEntry. The
 * adapter's single registration site (registerCompanionSheets) performs
 * exactly what this returns, so init-time registration, the mode wiring and
 * the ready-time repair can all call it without double-registering.
 * @param {object} pageSheetClasses  CONFIG.JournalEntryPage.sheetClasses (or a lookalike)
 * @param {object} entrySheetClasses CONFIG.JournalEntry.sheetClasses (or a lookalike)
 * @param {{sessionType:string, hubType:string, campaignType:string, mediaTypes:string[], ownerScope:string}} types
 * @returns {{session:boolean, hub:boolean, campaign:boolean, media:boolean, timeline:boolean}} true = register
 */
export function planSheetRegistrations(pageSheetClasses, entrySheetClasses, { sessionType, hubType, campaignType, mediaTypes, ownerScope }) {
  const missing = missingSheetRegistrations(pageSheetClasses, sessionType, hubType, campaignType, mediaTypes, ownerScope);
  missing.timeline = missingOwnRegistration(entrySheetClasses, "base", ownerScope);
  return missing;
}

/**
 * The registerSheet calls registerCompanionSheets must make for a `missing`
 * report, with exactly the option objects the companion has always used.
 * Pure so the collapse of four registration sites into one is pinned by a
 * unit test; the adapter performs each entry.
 *
 * Rationale carried over from the per-type registration helpers this
 * function replaces (formerly registerHubSheetClass / registerMediaSheetClass
 * / registerTimelineSheetClass in mej-adapter.mjs):
 * - hub: the Hub's synthetic page type must resolve in
 *   CONFIG.JournalEntryPage.sheetClasses; routed through the real
 *   DocumentSheetConfig.registerSheet so it survives the rebuild Foundry
 *   does when game.ready flips.
 * - media: routes Foundry's native pdf/video pages to the companion's
 *   viewer sheet so they open inside the MEJ shell (spec E §1); makeDefault
 *   claims them as the default sheet, canConfigure stays true so a GM can
 *   opt an individual page back to core's sheet; registered in BOTH modes -
 *   the shell hosts it in api mode, and it stands alone in native mode.
 * - timeline: timeline journals (spec 2026-09-03 §C) resolve to a sheet
 *   that never draws and hands off to the Hub's Timeline tab, against
 *   CONFIG.JournalEntry (not JournalEntryPage) and the native "base" type -
 *   so it is NEVER the default (that would hijack every plain journal entry
 *   in the world); only a document carrying
 *   flags.core.sheetClass === TIMELINE_SHEET_CLASS resolves to it;
 *   canConfigure stays true so a GM can opt one back to a real sheet.
 * @returns {Array<{documentClass:"JournalEntryPage"|"JournalEntry", sheetClass:Function, options:object}>}
 */
export function sheetRegistrationEntries(missing, { SessionSheet, CampaignHubPage, MediaPageSheet, TimelineJournalSheet },
  { sessionType, hubType, campaignType, mediaTypes, i18n }) {
  const out = [];
  if (missing.session) out.push({ documentClass: "JournalEntryPage", sheetClass: SessionSheet,
    options: { types: [sessionType], makeDefault: true, label: `${i18n}.sheettype.session` } });
  if (missing.hub) out.push({ documentClass: "JournalEntryPage", sheetClass: CampaignHubPage,
    options: { types: [hubType], makeDefault: false, canBeDefault: false, canConfigure: false, label: `${i18n}.hub.title` } });
  if (missing.campaign) out.push({ documentClass: "JournalEntryPage", sheetClass: CampaignHubPage,
    options: { types: [campaignType], makeDefault: true, canBeDefault: true, canConfigure: false, label: `${i18n}.sheettype.campaign` } });
  if (missing.media) out.push({ documentClass: "JournalEntryPage", sheetClass: MediaPageSheet,
    options: { types: mediaTypes, makeDefault: true, canBeDefault: true, canConfigure: true, label: `${i18n}.sheettype.media` } });
  if (missing.timeline) out.push({ documentClass: "JournalEntry", sheetClass: TimelineJournalSheet,
    options: { types: ["base"], makeDefault: false, canBeDefault: false, label: `${i18n}.sheettype.timelineJournal` } });
  return out;
}
