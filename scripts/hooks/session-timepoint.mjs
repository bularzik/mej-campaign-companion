// Creates a timeline timepoint for every new Session page and keeps it in
// step with the session's name and campaign date (spec 2026-10-09
// session-timepoint-encounter-start §2). Pure rules: logic/session-timepoint.mjs.
import { MODULE_ID, SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { ensureTimelineJournal } from "../data/timeline-journal.mjs";
import { getTimepoints, addTimepoint, addLink, editTimepoint } from "../data/timepoints.mjs";
import { queueFiling } from "../logic/filing-queue.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { wantsSessionTimepoint, sessionTimepointDraft, timepointSyncPatch } from "../logic/session-timepoint.mjs";

async function createSessionTimepoint(page) {
  if (!wantsSessionTimepoint(page._source, MODULE_ID)) return;
  const journal = await ensureTimelineJournal(campaignOf(page));
  if (!journal) {
    console.warn(`${MODULE_ID} | session timepoint: no timeline available for`, page.name);
    return;
  }
  const session = sessionData(page);
  const draft = sessionTimepointDraft({ name: page.name, campaignDate: session.campaignDate }, currentWorldComponents());
  let tpId = null;
  await queueFiling(async () => {
    const tp = await addTimepoint(journal, draft.label, null, draft.campaignDate);
    await addLink(journal, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" });
    tpId = tp.id;
  });
  const update = {
    [`flags.${MODULE_ID}.session.timepointId`]: tpId,
    [`flags.${MODULE_ID}.session.timelineId`]: journal.id
  };
  if (draft.stampSession) update[`flags.${MODULE_ID}.session.campaignDate`] = draft.campaignDate;
  await page.update(update);
}

async function syncSessionTimepoint(page) {
  const session = sessionData(page);
  if (!session.timepointId) return;
  const journal = game.journal.get(session.timelineId);
  const tp = journal ? getTimepoints(journal).find((t) => t.id === session.timepointId) : null;
  if (!tp) return; // deleted or moved away: never recreate
  const patch = timepointSyncPatch({ name: page.name, campaignDate: session.campaignDate }, tp);
  if (patch) await queueFiling(() => editTimepoint(journal, tp.id, patch));
}

function guard(task, what) {
  task.catch((err) => console.error(`${MODULE_ID} | session timepoint: ${what} failed`, err));
}

export function registerSessionTimepoint() {
  // Both hooks fire on every client; only the active GM writes.
  Hooks.on("createJournalEntryPage", (page) => {
    if (page.type !== SESSION_DOCUMENT_TYPE || game.user !== game.users.activeGM) return;
    guard(createSessionTimepoint(page), "create");
  });
  Hooks.on("updateJournalEntryPage", (page) => {
    if (page.type !== SESSION_DOCUMENT_TYPE || game.user !== game.users.activeGM) return;
    guard(syncSessionTimepoint(page), "sync");
  });
}
