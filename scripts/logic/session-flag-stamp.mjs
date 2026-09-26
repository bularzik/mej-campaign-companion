// Stock MEJ's New Entry dialog creates a Session page (type
// mej-campaign-companion.session) with no MEJ type flag, so MEJ opens it as a
// plain JournalEntrySheet. The companion's own creation paths set the flag
// (session-page-data.mjs); this is the patch for pages created any other way
// (spec 2026-09-25 session-type-label, amendment).
import { SESSION_TYPE, SESSION_DOCUMENT_TYPE } from "../constants.mjs";

const MEJ = "monks-enhanced-journal";

export function sessionFlagPatch(data) {
  if (!data || (data.type !== SESSION_DOCUMENT_TYPE && data.type !== SESSION_TYPE)) return null;
  if (data.flags?.[MEJ]?.type !== undefined) return null;
  return { [`flags.${MEJ}.type`]: SESSION_TYPE };
}
