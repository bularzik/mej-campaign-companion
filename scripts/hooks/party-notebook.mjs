// Party notebook lifecycle (spec 2026-10-10 §4.4). GM seat (elected active
// GM): create notebooks on ready and when a campaign gains writers, and
// keep notebook ownership in step with Contributors and player groups.
// Every seat: re-render the open sheets a notebook change touches (the
// sidebar hide lives in party-notebook-directory.mjs, registered at init).
import { MODULE_ID, CAMPAIGN_FLAG, PLAYER_GROUPS_SETTING, PARTY_ROWS_FLAG, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { isPartyNotebook, isCampaignFolder, campaignOf } from "../logic/campaigns.mjs";
import { affectedUuids } from "../logic/party-rows.mjs";
import { ensurePartyNotebook, syncNotebookOwnership, campaignsNeedingNotebooks } from "../data/party-notebook.mjs";
import { getCampaigns } from "../data/campaign-store.mjs";
import { refreshViewsMatching } from "./view-refresh.mjs";
import { hidePartyNotebookRows, hideRenderedPartyNotebookRows } from "./party-notebook-directory.mjs";

export { hidePartyNotebookRows };

const isWriterSeat = () => game.user.isGM && game.user === game.users.activeGM;

/**
 * notebookUuid -> {key: {a, b}}: each notebook's row ends as of the last
 * update this seat saw. Another seat's delete arrives with the row already
 * gone, so its a/b come from here.
 */
const rowEnds = new Map();
function snapshotRows(entry) {
  const raw = entry?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG];
  const ends = {};
  if (raw && typeof raw === "object") {
    for (const [key, r] of Object.entries(raw)) if (r && typeof r === "object") ends[key] = { a: r.a, b: r.b };
  }
  rowEnds.set(entry.uuid, ends);
  return ends;
}

/** Re-render only the views showing an end of a changed row (Final review IMP 3). */
function refreshForRowChange(entry, rowChanges) {
  const before = rowEnds.get(entry.uuid) ?? {};
  const after = snapshotRows(entry);
  // A whole-flag replace names no row keys: treat every row before and after as changed.
  const keys = rowChanges && typeof rowChanges === "object" && Object.keys(rowChanges).length
    ? Object.keys(rowChanges) : [...Object.keys(before), ...Object.keys(after)];
  const uuids = new Set(affectedUuids(keys, before, after));
  if (uuids.size) refreshViewsMatching((uuid) => uuids.has(uuid));
}

/** Contributor added/removed: re-render this campaign's views so controls appear or vanish. */
function refreshForOwnershipChange(notebook) {
  const campaign = campaignOf(notebook);
  if (!campaign) return;
  refreshViewsMatching((uuid) => {
    try {
      return campaignOf(fromUuidSync(uuid))?.id === campaign.id;
    } catch {
      return false;
    }
  });
}

async function reconcile(campaigns, { create = true } = {}) {
  for (const c of campaigns) {
    try {
      if (create) await ensurePartyNotebook(c);
      await syncNotebookOwnership(c);
    } catch (err) {
      console.error(`${MODULE_ID} | party notebook sync failed for campaign ${c.id}`, err);
    }
  }
}

/** Lower ownership where writers vanished, then create/raise where they exist. GM writer seat only. */
function reconcileAll() {
  if (!isWriterSeat()) return Promise.resolve();
  return Promise.resolve()
    .then(() => reconcile(getCampaigns(), { create: false }))
    .then(() => reconcile(campaignsNeedingNotebooks()))
    .catch((err) => console.error(`${MODULE_ID} | party notebook reconcile failed`, err));
}

/** Pre-1.0: no migration. Drop stray 0.25.0 playerConnections page flags. */
async function dropOldConnectionFlags() {
  for (const entry of game.journal.contents) {
    for (const page of entry.pages.contents) {
      if (page.flags?.[MODULE_ID]?.[PLAYER_CONNECTIONS_FLAG] === undefined) continue;
      await page.update({ [`flags.${MODULE_ID}.-=${PLAYER_CONNECTIONS_FLAG}`]: null });
    }
  }
}

export function registerPartyNotebook() {
  // The sidebar hide is registered at init; catch anything rendered before data was ready.
  hideRenderedPartyNotebookRows();
  for (const entry of game.journal?.contents ?? []) if (isPartyNotebook(entry)) snapshotRows(entry);
  Hooks.on("createJournalEntry", (entry) => {
    if (isPartyNotebook(entry)) snapshotRows(entry);
  });
  Hooks.on("deleteJournalEntry", (entry) => rowEnds.delete(entry?.uuid));

  // registerCore() may run inside or after the "ready" dispatch; Hooks.once("ready") would never fire then.
  const readyPass = () => {
    if (!isWriterSeat()) return;
    reconcile(campaignsNeedingNotebooks())
      .then(() => dropOldConnectionFlags())
      .catch((err) => console.error(`${MODULE_ID} | party notebook ready pass failed`, err));
  };
  if (game.ready) readyPass();
  else Hooks.once("ready", readyPass);
  Hooks.on("updateFolder", (folder, changes) => {
    if (!isWriterSeat() || !isCampaignFolder(folder)) return;
    if (changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] === undefined) return;
    // A campaign that lost all writers keeps its notebook but gets its ownership lowered.
    try {
      const needs = campaignsNeedingNotebooks().some((c) => c.id === folder.id);
      reconcile([folder], { create: needs });
    } catch (err) {
      console.error(`${MODULE_ID} | party notebook folder update failed`, err);
    }
  });
  const onGroupsSetting = (setting) => {
    if (setting?.key !== `${MODULE_ID}.${PLAYER_GROUPS_SETTING}` || !isWriterSeat()) return;
    reconcileAll();
  };
  // The first save of a never-stored setting creates its Setting document.
  Hooks.on("createSetting", onGroupsSetting);
  Hooks.on("updateSetting", onGroupsSetting);
  Hooks.on("createUser", () => reconcileAll());
  Hooks.on("deleteUser", () => reconcileAll());
  Hooks.on("updateUser", (user, changes) => {
    if (changes?.role === undefined) return;
    reconcileAll();
  });
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!isPartyNotebook(entry)) return;
    try {
      const rowChanges = changes?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG];
      if (rowChanges !== undefined) refreshForRowChange(entry, rowChanges);
      if (changes?.ownership !== undefined) refreshForOwnershipChange(entry);
    } catch (err) {
      console.error(`${MODULE_ID} | party notebook refresh failed`, err);
    }
  });
}
