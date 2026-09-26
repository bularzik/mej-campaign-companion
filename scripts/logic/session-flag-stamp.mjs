// Stock MEJ's New Entry dialog creates a Session page (type
// mej-campaign-companion.session) with no MEJ type flag, so MEJ opens it as a
// plain JournalEntrySheet. The companion's own creation paths set the flag
// (session-page-data.mjs); this is the patch for pages created any other way
// (spec 2026-09-25 session-type-label, amendment). Fed the page's `_source`
// (spec 2026-09-25 hub-ux-fixes §4a).
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

const MEJ = "monks-enhanced-journal";

export function sessionFlagPatch(source) {
  if (!source || (source.type !== SESSION_DOCUMENT_TYPE && source.type !== SESSION_TYPE)) return null;
  if (source.flags?.[MEJ]?.type !== undefined) return null;
  return { [`flags.${MEJ}.type`]: SESSION_TYPE };
}

/**
 * Pages created together with their entry (JournalEntry.create({pages}),
 * compendium import, duplicate) never fire preCreateJournalEntryPage, so the
 * entry's preCreate stamps them (spec 2026-09-25 hub-ux-fixes §4b). Returns
 * the full replacement `pages` array for entry.updateSource, or null.
 */
export function embeddedPagesPatch(entrySource) {
  const pages = entrySource?.pages;
  if (!Array.isArray(pages) || !pages.some((p) => sessionFlagPatch(p))) return null;
  return {
    pages: pages.map((p) => (sessionFlagPatch(p)
      ? { ...p, flags: { ...p.flags, [MEJ]: { ...p.flags?.[MEJ], type: SESSION_TYPE } } }
      : p))
  };
}
