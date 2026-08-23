// "Open Campaign Hub" on campaign folders (spec C §2). Two hook names,
// one handler: Foundry v13/v14's core JournalDirectory fires the
// class-suffixed "getFolderContextOptions{Class}" chain
// (ApplicationV2.#callHooks appends "{}" when parentClassHooks is true -
// verified against client/applications/api/application.mjs and
// client/applications/sidebar/document-directory.mjs), while MEJ's shell
// sidebar recreates the menu with hookName "getFolderContextOptions" and
// parentClassHooks: false, which fires the BARE name once
// (enhanced-journal.js's activateListeners). Registering both covers both
// surfaces; they never fire for the same menu instance.
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
  Hooks.on("getFolderContextOptionsJournalDirectory", (app, options) => addOption(options));
}
