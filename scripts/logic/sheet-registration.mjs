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
 * @returns {{session: boolean, hub: boolean, campaign: boolean, media: boolean}} true = missing, needs registering
 */
export function missingSheetRegistrations(sheetClasses, sessionType, hubType, campaignType, mediaTypes = []) {
  const has = (t) => Object.keys((sheetClasses ?? {})[t] ?? {}).length > 0;
  return {
    session: !has(sessionType),
    hub: !has(hubType),
    campaign: !has(campaignType),
    // Media covers TWO native types; report missing unless BOTH are registered,
    // so a partial repair still re-runs.
    media: (mediaTypes ?? []).some((t) => !has(t))
  };
}
