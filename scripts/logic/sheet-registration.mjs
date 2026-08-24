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
    // Media covers TWO native types; report missing unless OUR OWN
    // registration is present on BOTH, so a partial repair still re-runs and
    // core's co-registration for the untouched type never masks a dropped one.
    media: (mediaTypes ?? []).some((t) => !hasOurs(t))
  };
}
