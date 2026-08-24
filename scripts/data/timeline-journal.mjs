import { MODULE_ID, TIMELINE_JOURNAL_SETTING, CAMPAIGN_FLAG, DEFAULT_TIMELINE_KEY } from "../constants.mjs";
import { isTimelineJournal, campaignIdOf } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { orderTimelines, resolveDefaultTimelineId, sortByCreation } from "../logic/timelines.mjs";
import { baselineOwnership } from "./campaign-store.mjs";

/** The legacy world-singleton timeline JournalEntry, or null. Retained for pre-adoption worlds; adoption (campaign-container spec §6) moves it into a campaign and clears the setting. */
export function getTimelineJournal() {
  const id = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING);
  return id ? game.journal.get(id) ?? null : null;
}

/**
 * Every timeline journal directly inside the campaign folder, in
 * deterministic creation order - the order resolveDefaultTimelineId's
 * fallback depends on. Foundry's Folder#contents is an unsorted filter over
 * the live WorldCollection (stable within one session, NOT guaranteed to
 * reproduce creation order after a reload/fresh login - confirmed live), so
 * this sorts explicitly by each journal's own `_stats.createdTime` (server-
 * stamped on every primary document) rather than trusting collection
 * position. Visibility-filtered when `user` is given.
 */
export function campaignTimelines(campaign, { user = null } = {}) {
  const list = sortByCreation(
    (campaign?.contents ?? []).filter((e) => isTimelineJournal(e)),
    (e) => e._stats?.createdTime
  );
  return user ? list.filter((e) => isVisibleToUser(e, user)) : list;
}

/**
 * World timelines (spec D): timeline journals under no campaign folder.
 * Name-sorted for display; visibility-filtered when `user` is given.
 */
export function worldTimelines({ user = null } = {}) {
  const list = game.journal.contents.filter((e) => isTimelineJournal(e) && !campaignIdOf(e));
  const visible = user ? list.filter((e) => isVisibleToUser(e, user)) : list;
  return orderTimelines(visible, null);
}

/** The campaign's auto-filing default timeline (spec D §1), or null when it has none. */
export function defaultTimeline(campaign) {
  const list = campaignTimelines(campaign);
  const flagged = campaign?.getFlag?.(MODULE_ID, CAMPAIGN_FLAG)?.[DEFAULT_TIMELINE_KEY] ?? null;
  const id = resolveDefaultTimelineId(list, flagged);
  return id ? list.find((t) => t.id === id) ?? null : null;
}

/** The campaign's timeline journal - now the DEFAULT one (spec D). Name kept: existing callers want "the timeline to file into". */
export function campaignTimelineJournal(campaign) {
  return defaultTimeline(campaign);
}

/** Resolve the timeline for a scope; null campaign -> legacy singleton. */
export function resolveTimelineJournal(campaign = null) {
  return campaign ? defaultTimeline(campaign) : getTimelineJournal();
}

/** GM-only. Create a timeline journal: inside `campaign` (campaign baseline ownership) or at root as a world timeline. Never sets the default flag - the first one wins by fallback, later ones are promoted explicitly (setDefaultTimeline). */
export async function createTimeline({ campaign = null, name }) {
  if (!game.user.isGM) return null;
  return JournalEntry.create({
    name,
    ...(campaign ? { folder: campaign.id } : {}),
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: {
      default: campaign ? baselineOwnership(campaign) : CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    }
  });
}

/** GM-only. Point the campaign at its auto-filing default timeline. */
export async function setDefaultTimeline(campaign, timelineId) {
  if (!game.user.isGM || !campaign) return;
  const flag = campaign.getFlag(MODULE_ID, CAMPAIGN_FLAG) ?? {};
  await campaign.setFlag(MODULE_ID, CAMPAIGN_FLAG, { ...flag, [DEFAULT_TIMELINE_KEY]: timelineId });
}

/** Find or create the scope's default timeline journal. Creation requires GM privileges. */
export async function ensureTimelineJournal(campaign = null) {
  const journal = resolveTimelineJournal(campaign);
  if (journal) return journal;
  if (!game.user.isGM) return null;
  if (campaign) return createTimeline({ campaign, name: `${campaign.name} — Timeline` });
  const created = await JournalEntry.create({
    name: "Campaign Timeline",
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, created.id);
  return created;
}
