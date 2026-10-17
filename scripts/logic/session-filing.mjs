// Pure rules for "a session always lives in a campaign" (spec 2026-10-16
// sessions-in-campaigns §1). No Foundry imports so vitest loads it directly;
// hooks/session-filing.mjs wires them to Foundry.
import { SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { storedPageType } from "./mej-type.mjs";

/** Pages of an entry, from a live collection (`pages.contents`) or creation-shaped data (plain array). */
function pagesOf(entry) {
  return Array.isArray(entry?.pages) ? entry.pages : (entry?.pages?.contents ?? []);
}

/** Whether the entry holds at least one Session page, by stored subtype (MEJ rewrites the in-memory type). */
export function holdsSessionPage(entry) {
  return pagesOf(entry).some((p) => storedPageType(p) === SESSION_DOCUMENT_TYPE);
}

/**
 * Whether the filing hook moves this entry: a FOLDERLESS JournalEntry holding
 * a session page. An entry in any folder - campaign or plain ("Archive",
 * "One-shots") - is left where the GM put it (§1b). Multi-page entries are
 * filed whole. World documents only: a compendium entry (truthy `pack`) is
 * never filed.
 */
export function shouldFileSession(entry) {
  if (!entry || entry.documentName !== "JournalEntry") return false;
  if (entry.pack) return false;
  if (entry.folder) return false;
  return holdsSessionPage(entry);
}

/**
 * The root campaign folder named exactly `name`, or null. This reuse rule is
 * what stops "New Campaign" folders piling up (§1c): the GM renames the
 * folder like any other, and the next fallback creates a fresh one.
 */
export function pickFallbackCampaign(campaigns, name) {
  return (campaigns ?? []).find((c) => c?.name === name && !c?.folder) ?? null;
}

/** The single update that files an entry: folder plus default ownership only; explicit per-user ownership is untouched (§1b). */
export function filingUpdate(campaignId, level) {
  return { folder: campaignId, "ownership.default": level };
}
