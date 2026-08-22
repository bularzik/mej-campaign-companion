// Pure campaign-membership logic (spec §1). No Foundry imports so vitest
// can load it directly - same convention as hub-index.mjs. Operates on
// doc-shaped plain objects: folders have .flags/.folder, entries have
// .documentName/.folder/.flags, pages have .documentName/.parent.
import { MODULE_ID, CAMPAIGN_FLAG } from "../constants.mjs";

/** The campaign flag object ({ ownershipDefault, ... }) or null. */
export function campaignFlagOf(folder) {
  return folder?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] ?? null;
}

export function isCampaignFolder(folder) {
  return !!campaignFlagOf(folder);
}

/**
 * The campaign Folder a document belongs to, or null. Accepts a
 * JournalEntry or JournalEntryPage (resolved via .parent). Walks the
 * folder ancestry; nearest flagged ancestor wins - creation UI prevents
 * nesting, this rule is the defensive fallback (spec §1).
 */
export function campaignOf(doc) {
  const entry = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
  let folder = entry?.folder ?? null;
  while (folder) {
    if (isCampaignFolder(folder)) return folder;
    folder = folder.folder ?? null;
  }
  return null;
}

export function campaignIdOf(doc) {
  return campaignOf(doc)?.id ?? null;
}

export function isMemberOf(entry, campaignFolder) {
  return !!campaignFolder && campaignOf(entry)?.id === campaignFolder.id;
}

/** Split entries into Map<campaignId|null, entry[]>; null key = unfiled. */
export function partitionByCampaign(entries) {
  const byId = new Map();
  for (const e of entries ?? []) {
    const id = campaignIdOf(e);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(e);
  }
  return byId;
}

/** Is this journal a timeline journal (a campaign's, or the legacy singleton)? */
export function isTimelineJournal(entry) {
  return !!entry?.flags?.[MODULE_ID]?.timeline;
}

/** "none"|"observer"|"owner" -> ownership level; `levels` is CONST.DOCUMENT_OWNERSHIP_LEVELS (injected for testability). Unknown -> OBSERVER. */
export function ownershipLevelFor(key, levels) {
  const map = { none: levels.NONE, observer: levels.OBSERVER, owner: levels.OWNER };
  return map[key] ?? levels.OBSERVER;
}

/**
 * Spec §3 attachment discipline: an entry may only attach to timepoints of
 * its own campaign. A timeline journal with no campaign (the pre-adoption
 * legacy singleton) accepts anything.
 */
export function canAttachToTimeline(entry, timelineJournal) {
  const timelineCampaign = campaignIdOf(timelineJournal);
  if (timelineCampaign === null) return true;
  return campaignIdOf(entry) === timelineCampaign;
}

/**
 * Spec §5 bulk apply plan: JournalEntry.updateDocuments payloads setting
 * every entry's ownership.default to `level`, skipping ones already there.
 * Touches ONLY the default level - per-user overrides are separate keys.
 */
export function bulkOwnershipPlan(entries, level) {
  return (entries ?? [])
    .filter((e) => (e.ownership?.default ?? null) !== level)
    .map((e) => ({ _id: e.id, "ownership.default": level }));
}
