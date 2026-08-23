// Two-way campaign<->portal rename sync (spec C §1). The pure planner
// (renameSyncPlan) owns the decision; these hooks only detect which side
// changed and apply at most one write. Equal names plan to null, so the
// echo write each sync causes converges immediately - no loop-breaker
// flag is needed. GM-side only: players cannot rename either object.
import { MODULE_ID } from "../constants.mjs";
import { renameSyncPlan } from "../logic/campaign-portal-data.mjs";
import { isCampaignFolder, isCampaignPortal } from "../logic/campaigns.mjs";
import { campaignPortal } from "../data/campaign-store.mjs";

export function registerPortalSync() {
  Hooks.on("updateFolder", async (folder, changes) => {
    try {
      if (!game.user.isGM || changes?.name === undefined) return;
      if (!isCampaignFolder(folder)) return;
      const portal = campaignPortal(folder);
      if (!portal) return;
      const plan = renameSyncPlan({ folderName: folder.name, portalName: portal.name, changedSide: "folder" });
      if (plan?.target === "portal") {
        // Keep the page name in step too - the portal is a single-page entry.
        const page = portal.pages.contents[0];
        await portal.update({ name: plan.name, ...(page ? { pages: [{ _id: page.id, name: plan.name }] } : {}) });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | portal rename sync (folder) failed`, err);
    }
  });

  Hooks.on("updateJournalEntry", async (entry, changes) => {
    try {
      if (!game.user.isGM || changes?.name === undefined) return;
      if (!isCampaignPortal(entry)) return;
      const folder = entry.folder;
      if (!folder || !isCampaignFolder(folder)) return;
      const plan = renameSyncPlan({ folderName: folder.name, portalName: entry.name, changedSide: "portal" });
      if (plan?.target === "folder") await folder.update({ name: plan.name });
    } catch (err) {
      console.error(`${MODULE_ID} | portal rename sync (portal) failed`, err);
    }
  });
}
