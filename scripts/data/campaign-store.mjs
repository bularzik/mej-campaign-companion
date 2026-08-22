// Foundry glue over logic/campaigns.mjs (spec §1): the seam every other
// subsystem consumes for campaign scope. Imports Foundry globals, so it
// is NOT vitest-loadable; keep anything testable in logic/campaigns.mjs.
import { MODULE_ID, CAMPAIGN_FLAG } from "../constants.mjs";
import {
  isCampaignFolder, campaignOf, campaignFlagOf, isTimelineJournal,
  ownershipLevelFor, bulkOwnershipPlan
} from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";

/** Every campaign folder in the world, name-sorted. */
export function getCampaigns() {
  return game.folders
    .filter((f) => f.type === "JournalEntry" && isCampaignFolder(f))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** GM-only. Creates a root-level campaign folder (campaigns never nest - spec §1). */
export async function createCampaign(name, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM) return null;
  return Folder.create({
    name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
}

/** Visibility-filtered members of a campaign; the campaign's timeline journal is excluded (spec §1). */
export function campaignEntries(campaign, { user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    campaignOf(e)?.id === campaign.id && !isTimelineJournal(e) && isVisibleToUser(e, user));
}

/** Visibility-filtered entries under no campaign (any type - spec §2 Unfiled scope), timeline journals excluded. */
export function unfiledEntries({ user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    !campaignOf(e) && !isTimelineJournal(e) && isVisibleToUser(e, user));
}

/** The campaign's ownership baseline as a CONST.DOCUMENT_OWNERSHIP_LEVELS value (spec §5). */
export function baselineOwnership(campaign) {
  const key = campaignFlagOf(campaign)?.ownershipDefault;
  return ownershipLevelFor(key, CONST.DOCUMENT_OWNERSHIP_LEVELS);
}

/**
 * Spec §5 bulk apply: set every member's ownership.default to the baseline.
 * Skips entries currently hidden (NONE) via the eye toggle - a bulk apply
 * must not silently un-hide them (see bulkOwnershipPlan's doc comment).
 * Returns the update count.
 */
export async function applyBaselineToMembers(campaign) {
  const level = baselineOwnership(campaign);
  const updates = bulkOwnershipPlan(campaignEntries(campaign, { user: game.user }), level, {
    skipLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
  });
  if (updates.length) await JournalEntry.updateDocuments(updates);
  return updates.length;
}

/** Spec §5 hide/reveal: hide -> NONE; reveal -> the entry's campaign baseline (OBSERVER when unfiled). */
export async function setEntryHidden(entry, hidden) {
  const level = hidden
    ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    : baselineOwnership(campaignOf(entry));
  await entry.update({ "ownership.default": level });
}
