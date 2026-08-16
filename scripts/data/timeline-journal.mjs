import { MODULE_ID, TIMELINE_JOURNAL_SETTING } from "../constants.mjs";

/** The world's singleton "Campaign Timeline" JournalEntry, or null when unset/deleted. */
export function getTimelineJournal() {
  const id = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING);
  return id ? game.journal.get(id) ?? null : null;
}

/** Find or create the timeline journal. Creation requires GM privileges. */
export async function ensureTimelineJournal() {
  let journal = getTimelineJournal();
  if (journal) return journal;
  if (!game.user.isGM) return null;
  journal = await JournalEntry.create({
    name: "Campaign Timeline",
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, journal.id);
  return journal;
}
