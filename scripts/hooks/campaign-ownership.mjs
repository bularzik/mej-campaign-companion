// scripts/hooks/campaign-ownership.mjs
// Entries created inside a campaign folder inherit the campaign's ownership
// baseline (spec 2026-09-06 §2). Before this, only the companion's own
// creation paths (Hub session, import, auto-capture) applied the baseline;
// a Person made through MEJ's New Entry dialog stayed at Foundry's default
// (players: NONE), so audience containment refused to link it into the
// player-visible recaps that mention it. Container rule, not a type rule:
// any JournalEntry filed in a campaign or one of its subfolders. GM seat
// only, and the playersWriteSessions hook (campaign-companion.mjs) still
// wins for sessions because OWNER is >= every baseline.
import { MODULE_ID } from "../constants.mjs";
import { campaignOfFolder } from "../logic/campaigns.mjs";
import { baselineOwnership } from "../data/campaign-store.mjs";
import { inheritedOwnership } from "../logic/campaign-ownership.mjs";

export function registerCampaignOwnership() {
  Hooks.on("preCreateJournalEntry", (entry, data) => {
    try {
      // Foundry creation data accepts a Folder document in place of an id;
      // the pending document already resolves that either way, so prefer it
      // and fall back to a manual lookup only if it can't (same pattern as
      // hooks/campaign-guard.mjs).
      const folder = entry.folder ?? game.folders.get(data?.folder?.id ?? data?.folder) ?? null;
      const campaign = campaignOfFolder(folder);
      const ownership = inheritedOwnership(data, campaign ? baselineOwnership(campaign) : null, { isGM: game.user.isGM });
      if (ownership) entry.updateSource({ ownership });
    } catch (err) {
      console.error(`${MODULE_ID} | campaign ownership inherit failed`, err);
    }
  });
}
