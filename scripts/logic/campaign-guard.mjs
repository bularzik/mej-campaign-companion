// Pure decisions behind hooks/campaign-guard.mjs (spec 2026-09-06 §3). No
// Foundry imports - same convention as campaigns.mjs.
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";

/** <option> values a page-type picker may carry for our campaign type: MEJ's bare registry key and Foundry's prefixed subtype. */
export const CAMPAIGN_OPTION_VALUES = [CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE];

/**
 * Spec §3 table. `entryPageCount` is the number of pages the entry will hold
 * BESIDES the campaign page; `entryInCampaign` says whether the entry's
 * folder resolves to a campaign. Order matters: a multipage entry is refused
 * before its folder is even looked at.
 */
export function classifyCampaignPageCreate({ isPortal, isGM, entryPageCount, entryInCampaign }) {
  if (isPortal) return "ignore";
  if (!isGM) return "block-not-gm";
  if (entryPageCount > 0) return "block-multipage";
  if (entryInCampaign) return "block-in-campaign";
  return "allow";
}

/**
 * Inspect JournalEntry creation data for a stray campaign page. MEJ's New
 * Entry dialog carries the intent as flags.monks-enhanced-journal.pagetype
 * ("campaign" or "campaign:<subtype>") with no pages yet, and adds the page
 * itself in _onCreate; API/macro/import creation carries inline pages.
 * Inline pages already carrying the portal marker are ensureCampaignPortal's
 * own work and never count. Null when no campaign page is involved.
 */
export function strayCampaignIntent(data) {
  if (!data) return null;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const inline = pages.filter((p) => p?.type === CAMPAIGN_DOCUMENT_TYPE && p?.flags?.[MODULE_ID]?.campaignPortal !== true);
  const pagetype = String(data.flags?.["monks-enhanced-journal"]?.pagetype ?? "").split(":")[0];
  if (!inline.length && pagetype !== CAMPAIGN_TYPE) return null;
  return { otherPages: pages.length - inline.length };
}
