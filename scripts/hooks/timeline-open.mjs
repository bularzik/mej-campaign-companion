// MEJ's openJournalEntry (monks-enhanced-journal.js ~2527) runs
// Hooks.call("openJournalEntry", doc, options, userId) and treats a `false`
// return as "don't open this in the shell"; its callers then fall back to
// entry.sheet.render(true, options) (~580) - which, for a timeline journal,
// is sheets/TimelineJournalSheet.mjs. Registered at init so it is in place
// before any user click, in api AND native mode (native mode still has MEJ
// installed; it just lacks the extension API).
import { isTimelineJournal } from "../logic/campaigns.mjs";

export function registerTimelineOpen() {
  Hooks.on("openJournalEntry", (doc) => (isTimelineJournal(doc) ? false : undefined));
}
