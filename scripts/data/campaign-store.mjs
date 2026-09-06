// Foundry glue over logic/campaigns.mjs (spec §1): the seam every other
// subsystem consumes for campaign scope. Imports Foundry globals, so it
// is NOT vitest-loadable; keep anything testable in logic/campaigns.mjs.
import { MODULE_ID, CAMPAIGN_FLAG, AUTO_CAPTURE_CAMPAIGN_SETTING } from "../constants.mjs";
import {
  isCampaignFolder, campaignOf, campaignFlagOf, isTimelineJournal, isCampaignPortal,
  ownershipLevelFor, bulkOwnershipPlan, canConvertFolder, hasPortalMarker, isCampaignTypedPage
} from "../logic/campaigns.mjs";
import { buildCampaignPortalData } from "../logic/campaign-portal-data.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
// ESM cycle: timeline-journal.mjs imports baselineOwnership from this file.
// Safe because both sides only reference the other's function declarations
// at call time (hoisted bindings), never during module evaluation.
import { ensureTimelineJournal } from "./timeline-journal.mjs";

/** Every campaign folder in the world, name-sorted. */
export function getCampaigns() {
  return game.folders
    .filter((f) => f.type === "JournalEntry" && isCampaignFolder(f))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GM-only. Creates the whole campaign structure (spec 2026-09-06 §1): a
 * root-level flagged folder (campaigns never nest - spec §1), then its
 * portal, then its timeline. RULING: if this is the world's first campaign
 * and no auto-capture target is set yet, seed AUTO_CAPTURE_CAMPAIGN_SETTING
 * to it - a legacy (pre-campaign) world's auto-capture setting is unset by
 * definition, and without this its first import/adoption would silently
 * stop auto-capturing until a GM finds the separate capture-target picker.
 */
export async function createCampaign(name, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM) return null;
  const wasFirst = getCampaigns().length === 0;
  const folder = await Folder.create({
    name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
  if (!folder) return null;
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await completeCampaignStructure(folder);
  return folder;
}

async function seedAutoCaptureIfFirst(folder, wasFirst) {
  if (wasFirst && !game.settings.get(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING)) {
    await game.settings.set(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, folder.id);
  }
}

/** The campaign's portal entry (spec C §1), or null. Direct children only - portals live at the folder root. */
export function campaignPortal(campaign) {
  return (campaign?.contents ?? []).find((e) => isCampaignPortal(e)) ?? null;
}

/**
 * GM-only. Create the portal when missing (createCampaign, the settings
 * dialog's restore control, and the dataVersion-2 migration all funnel
 * here). Ownership = the campaign baseline, like any companion creation.
 */
export async function ensureCampaignPortal(campaign) {
  if (!game.user.isGM || !campaign) return null;
  const existing = campaignPortal(campaign);
  if (existing) return existing;
  return JournalEntry.create({
    name: campaign.name,
    folder: campaign.id,
    ownership: { default: baselineOwnership(campaign) },
    pages: [buildCampaignPortalData(campaign.name)]
  });
}

/**
 * Portal, then timeline - each idempotent, each its own repair point.
 * Foundry has no transactions: a failed write is logged and the other still
 * runs, so a later Hub open or the migration completes the structure rather
 * than duplicating it (spec 2026-09-06 §1).
 */
export async function completeCampaignStructure(campaign) {
  try {
    await ensureCampaignPortal(campaign);
  } catch (err) {
    console.error(`${MODULE_ID} | portal creation failed for campaign ${campaign.id}`, err);
  }
  try {
    await ensureTimelineJournal(campaign);
  } catch (err) {
    console.error(`${MODULE_ID} | timeline creation failed for campaign ${campaign.id}`, err);
  }
}

/**
 * GM-only. Promote a plain root JournalEntry folder into a campaign in place
 * (spec 2026-09-06 §1): flag it, then portal + timeline. Entries already in
 * it stay where they are. Null (no writes) when canConvertFolder refuses.
 */
export async function convertFolderToCampaign(folder, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM || !canConvertFolder(folder)) return null;
  const wasFirst = getCampaigns().length === 0;
  await folder.update({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}`]: { ownershipDefault } });
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await completeCampaignStructure(folder);
  return folder;
}

// Upgrades run one at a time: two create hooks can fire for the same entry
// (createJournalEntry for inline pages, createJournalEntryPage for MEJ's
// _onCreate) and rapid creates must not interleave folder writes.
let upgradeChain = Promise.resolve();

/**
 * GM-only. Turn a loose single-page campaign entry into a real campaign
 * (spec 2026-09-06 §3): root folder named after the entry, entry moved in
 * and stamped as the portal, timeline created. Re-checks eligibility at run
 * time, so a second call for the same entry is a no-op. Resolves to the
 * folder, or null when nothing was done.
 */
export function upgradeEntryToCampaign(entry, { ownershipDefault = "observer" } = {}) {
  const run = upgradeChain
    .then(() => doUpgrade(entry, { ownershipDefault }))
    .catch((err) => {
      console.error(`${MODULE_ID} | campaign upgrade failed for ${entry?.uuid}`, err);
      return null;
    });
  upgradeChain = run;
  return run;
}

async function doUpgrade(entry, { ownershipDefault }) {
  if (!game.user.isGM || !entry?.pages) return null;
  const pages = entry.pages.contents;
  const page = pages[0];
  if (pages.length !== 1 || !isCampaignTypedPage(page) || hasPortalMarker(page) || campaignOf(entry)) return null;
  const wasFirst = getCampaigns().length === 0;
  const folder = await Folder.create({
    name: entry.name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
  if (!folder) return null;
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await entry.update({ folder: folder.id, "ownership.default": baselineOwnership(folder) });
  const { flags } = buildCampaignPortalData(entry.name);
  await page.update({ name: entry.name, flags });
  await ensureTimelineJournal(folder);
  return folder;
}

/** Visibility-filtered members of a campaign; the campaign's timeline journal and portal are excluded (spec §1). */
export function campaignEntries(campaign, { user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    campaignOf(e)?.id === campaign.id && !isTimelineJournal(e) && !isCampaignPortal(e) && isVisibleToUser(e, user));
}

/** Visibility-filtered entries under no campaign (any type - spec §2 Unfiled scope), timeline journals and portals excluded. */
export function unfiledEntries({ user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    !campaignOf(e) && !isTimelineJournal(e) && !isCampaignPortal(e) && isVisibleToUser(e, user));
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
 * Spec C's Ownership row treats the portal as an ordinary member for
 * baseline purposes - campaignEntries() excludes it (it's not player-facing
 * "content"), so it's added back in explicitly here; otherwise a baseline
 * change would update every member EXCEPT the portal, leaving players
 * granted view unable to ever open the campaign entity. Returns the update
 * count.
 */
export async function applyBaselineToMembers(campaign) {
  // C12: createCampaign/ensureCampaignPortal in this file both self-check
  // isGM, and CampaignHubPage documents that convention as the reason its
  // actions are safe to leave wired regardless of seat - but the two
  // OWNERSHIP writers, this and setEntryHidden, had no such check. Foundry
  // would reject the write server-side either way; the point is that the
  // invariant this module advertises should actually hold in it.
  if (!game.user.isGM || !campaign) return 0;
  const level = baselineOwnership(campaign);
  const portal = campaignPortal(campaign);
  const targets = [...campaignEntries(campaign, { user: game.user }), ...(portal ? [portal] : [])];
  const updates = bulkOwnershipPlan(targets, level, {
    skipLevel: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
  });
  if (updates.length) await JournalEntry.updateDocuments(updates);
  return updates.length;
}

/** Spec §5 hide/reveal: hide -> NONE; reveal -> the entry's campaign baseline (OBSERVER when unfiled). */
export async function setEntryHidden(entry, hidden) {
  if (!game.user.isGM || !entry) return;   // C12, see applyBaselineToMembers
  const level = hidden
    ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    : baselineOwnership(campaignOf(entry));
  await entry.update({ "ownership.default": level });
}
