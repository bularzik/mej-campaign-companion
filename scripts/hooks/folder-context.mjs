// "Open Campaign Hub" on campaign folders (spec C §2). One bare hook covers
// both surfaces: Foundry's core JournalDirectory and MEJ's shell sidebar both
// register their folder context menus with hookName "getFolderContextOptions"
// and parentClassHooks: false (verified against
// client/applications/sidebar/document-directory.mjs and MEJ
// enhanced-journal.js ~1826-1830), so both fire the same bare hook once.
// The idempotent addOption guard below handles any edge cases.
import { MODULE_ID, I18N, HUB_CAMPAIGN_SCOPE_SETTING } from "../constants.mjs";
import { isCampaignFolder } from "../logic/campaigns.mjs";

function folderFromHeader(header) {
  const el = header instanceof HTMLElement ? header : header?.[0];
  const id = el?.closest("[data-folder-id]")?.dataset.folderId
    ?? el?.closest("[data-uuid]")?.dataset.uuid?.split(".").pop();
  return id ? game.folders.get(id) ?? null : null;
}

function addOption(options) {
  if (options.some((o) => o?.name === `${I18N}.hub.openCampaignHub`)) return;
  options.push({
    name: `${I18N}.hub.openCampaignHub`,
    icon: '<i class="fa-solid fa-timeline"></i>',
    condition: (header) => isCampaignFolder(folderFromHeader(header)),
    callback: async (header) => {
      const folder = folderFromHeader(header);
      if (!folder) return;
      const [{ setHubScope }, { openHub }] = await Promise.all([
        import("../apps/CampaignHubPage.mjs"),
        import("../integrations/mej-adapter.mjs")
      ]);
      setHubScope(folder.id);
      await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, folder.id);
      await openHub();
    }
  });
}

export function registerFolderContext() {
  Hooks.on("getFolderContextOptions", (app, options) => addOption(options));
}
