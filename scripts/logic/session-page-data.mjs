import { MODULE_ID, SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

/**
 * Build the `pages[]` entry for a docx-imported Session page's
 * JournalEntry.create() call (apps/import-wizard.mjs's #createPage
 * "session" branch owns the actual create() call - Foundry-only; this just
 * owns the payload shape, so it's unit-testable directly). Pure beyond the
 * plain string constants imported above - none of them touch `game` at
 * import time (see constants.mjs; campaign-date.mjs and timeline-links.mjs
 * already import from constants.mjs the same way).
 *
 * Sets BOTH:
 *  - the real native page type (SESSION_DOCUMENT_TYPE, the module-declared
 *    subtype key `${MODULE_ID}.session` - a bare "session" is rejected by
 *    DocumentTypeField._validateType at create time - see constants.mjs's
 *    doc comment), and
 *  - `flags["monks-enhanced-journal"].type = SESSION_TYPE`, one of the two
 *    sanctioned companion-flags-only exceptions (MEJ's own namespace, read
 *    by MEJ's own machinery, per the plan's Global Constraints):
 *    search/live-index.mjs, hub-index.mjs, and auto-link candidate
 *    discovery all gate on `game.MonksEnhancedJournal.getMEJType(entry)`,
 *    which reads exactly this flag - "session" is in the merged type
 *    registry (this module's own externalTypes registration via
 *    api.registerSheetType), so the flag route works. Without it, a
 *    docx-imported session is created successfully but invisible to
 *    search/Hub/auto-link. This mirrors what MEJ's own New Entry dialog
 *    already sets for a dialog-created session (see
 *    monks-enhanced-journal.js's `JournalEntry.prototype._onCreate` patch).
 *
 * @param {string} name entry + page name
 * @param {string} html goes into system.recap
 * @param {object|null} campaignDate parsed header date, or null
 * @param {number|null} sessionNumber parsed header session number, or null
 */
export function buildSessionPageData(name, html, campaignDate, sessionNumber) {
  return {
    name,
    type: SESSION_DOCUMENT_TYPE,
    system: { recap: html ?? "", gmNotes: "" },
    flags: {
      [MODULE_ID]: {
        session: {
          sessionNumber: sessionNumber ?? null,
          campaignDate: campaignDate ?? null,
          attendees: [],
          secrets: []
        }
      },
      "monks-enhanced-journal": { type: SESSION_TYPE }
    }
  };
}
