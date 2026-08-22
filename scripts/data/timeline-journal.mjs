import { MODULE_ID, TIMELINE_JOURNAL_SETTING } from "../constants.mjs";
import { isTimelineJournal } from "../logic/campaigns.mjs";

/** The legacy world-singleton timeline JournalEntry, or null. Retained for pre-adoption worlds; adoption (spec §6) moves it into a campaign and clears the setting. */
export function getTimelineJournal() {
  const id = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING);
  return id ? game.journal.get(id) ?? null : null;
}

/** The campaign's timeline journal: a directly-contained member entry flagged `timeline` (spec §3). */
export function campaignTimelineJournal(campaign) {
  return campaign.contents.find((e) => isTimelineJournal(e)) ?? null;
}

/** Resolve the timeline for a scope; null campaign -> legacy singleton. */
export function resolveTimelineJournal(campaign = null) {
  return campaign ? campaignTimelineJournal(campaign) : getTimelineJournal();
}

/** Find or create the scope's timeline journal. Creation requires GM privileges. */
export async function ensureTimelineJournal(campaign = null) {
  let journal = resolveTimelineJournal(campaign);
  if (journal) return journal;
  if (!game.user.isGM) return null;
  journal = await JournalEntry.create({
    name: campaign ? `${campaign.name} — Timeline` : "Campaign Timeline",
    ...(campaign ? { folder: campaign.id } : {}),
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  if (!campaign) await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, journal.id);
  return journal;
}
