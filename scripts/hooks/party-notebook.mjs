// Party notebook lifecycle (spec 2026-10-10 §4.4). GM seat (elected active
// GM): create notebooks on ready and when a campaign gains writers, and
// keep notebook ownership in step with Contributors and player groups.
// Every seat: hide notebooks from the journal sidebar and re-render open
// sheets when a notebook's rows change.
import { MODULE_ID, CAMPAIGN_FLAG, PLAYER_GROUPS_SETTING, PARTY_ROWS_FLAG, PLAYER_CONNECTIONS_FLAG } from "../constants.mjs";
import { isPartyNotebook, isCampaignFolder } from "../logic/campaigns.mjs";
import { ensurePartyNotebook, syncNotebookOwnership, campaignsNeedingNotebooks } from "../data/party-notebook.mjs";
import { getCampaigns } from "../data/campaign-store.mjs";
import { refreshViewsMatching } from "./view-refresh.mjs";

const isWriterSeat = () => game.user.isGM && game.user === game.users.activeGM;

export function hidePartyNotebookRows(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    if (isPartyNotebook(game.journal.get(li.dataset.entryId))) li.remove();
  }
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
  const rootOf = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);
  Hooks.on("renderJournalDirectory", (app, html) => hidePartyNotebookRows(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => hidePartyNotebookRows(app?.element ?? null));

  Hooks.once("ready", () => {
    if (!isWriterSeat()) return;
    reconcile(campaignsNeedingNotebooks())
      .then(() => dropOldConnectionFlags())
      .catch((err) => console.error(`${MODULE_ID} | party notebook ready pass failed`, err));
  });
  Hooks.on("updateFolder", (folder, changes) => {
    if (!isWriterSeat() || !isCampaignFolder(folder)) return;
    if (changes?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] === undefined) return;
    // A campaign that lost all writers keeps its notebook but gets its ownership lowered.
    const needs = campaignsNeedingNotebooks().some((c) => c.id === folder.id);
    reconcile([folder], { create: needs });
  });
  Hooks.on("updateSetting", (setting) => {
    if (setting.key !== `${MODULE_ID}.${PLAYER_GROUPS_SETTING}` || !isWriterSeat()) return;
    reconcile(getCampaigns(), { create: false }).then(() => reconcile(campaignsNeedingNotebooks()));
  });
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (!isPartyNotebook(entry) || changes?.flags?.[MODULE_ID]?.[PARTY_ROWS_FLAG] === undefined) return;
    refreshViewsMatching(null);
  });
}
