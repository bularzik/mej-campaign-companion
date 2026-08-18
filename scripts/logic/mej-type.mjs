// Session identity, independent of Monk's Enhanced Journal's type registry.
//
// The companion used to ask game.MonksEnhancedJournal.getMEJType(doc) whether
// a document was one of "ours". That works for MEJ's built-in types, but not
// for our own Session type on a STOCK MEJ install: getMEJType validates the
// monks-enhanced-journal.type flag against MEJ's registry, which only knows
// about "session" when the extension API registered it. On stock it returns
// false for every Session page - silently, with no error - so sessions would
// vanish from search, auto-link, the Hub index, export and the graph.
//
// The native page type (SESSION_DOCUMENT_TYPE, a Foundry module-declared
// subtype from module.json) is owned by Foundry itself: no MEJ build can
// scrub it, and it means the same thing in both modes. It is the truth here.
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

/**
 * Is this document one of our Session pages (or the single-page entry
 * wrapping one)? Mirrors getMEJType's contract: page OR entry, and an entry
 * only counts when it has exactly one page (MEJ's own rule).
 * @param {object|null|undefined} doc
 * @returns {boolean}
 */
export function isSessionDoc(doc) {
  if (!doc) return false;
  if (doc.type === SESSION_DOCUMENT_TYPE) return true;
  const pages = doc.pages?.contents;
  if (!Array.isArray(pages) || pages.length !== 1) return false;
  return pages[0]?.type === SESSION_DOCUMENT_TYPE;
}

/**
 * Drop-in replacement for game.MonksEnhancedJournal.getMEJType, with Session
 * pages resolved from the native subtype first.
 * @param {object|null|undefined} doc
 * @param {((doc: object) => string|false|undefined)|undefined} getMEJType
 * @returns {string|false} short MEJ type key, or false
 */
export function mejTypeWith(doc, getMEJType) {
  if (isSessionDoc(doc)) return SESSION_TYPE;
  return getMEJType?.(doc) || false;
}
