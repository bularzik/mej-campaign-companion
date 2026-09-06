// "Open Campaign Hub" on campaign folders (spec C §2). One bare hook covers
// both surfaces: Foundry's core JournalDirectory and MEJ's shell sidebar both
// register their folder context menus with hookName "getFolderContextOptions"
// and parentClassHooks: false (verified against
// client/applications/sidebar/document-directory.mjs and MEJ
// enhanced-journal.js ~1826-1830), so both fire the same bare hook once.
// The idempotent addOption guard below handles any edge cases.
import { MODULE_ID, I18N, HUB_CAMPAIGN_SCOPE_SETTING } from "../constants.mjs";
import { isCampaignFolder, canConvertFolder } from "../logic/campaigns.mjs";

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

/**
 * "Make this folder a campaign" (spec 2026-09-06 §2): a plain root journal
 * folder is promoted in place through the same Name + Player-access prompt
 * as every other creation surface; a changed name renames the folder first
 * (portal-sync keeps folder and portal names aligned from then on).
 */
function addConvertOption(options) {
  if (options.some((o) => o?.name === `${I18N}.campaign.convertFolder`)) return;
  options.push({
    name: `${I18N}.campaign.convertFolder`,
    icon: '<i class="fa-solid fa-flag"></i>',
    condition: (header) => game.user.isGM && canConvertFolder(folderFromHeader(header)),
    callback: async (header) => {
      const folder = folderFromHeader(header);
      if (!folder) return;
      const [{ promptNewCampaign }, { convertFolderToCampaign }] = await Promise.all([
        import("../apps/new-campaign-dialog.mjs"),
        import("../data/campaign-store.mjs")
      ]);
      const result = await promptNewCampaign({
        name: folder.name,
        title: game.i18n.localize(`${I18N}.campaign.convertFolder`)
      });
      if (!result) return;
      if (result.name !== folder.name) await folder.update({ name: result.name });
      const campaign = await convertFolderToCampaign(folder, { ownershipDefault: result.baseline });
      if (!campaign) {
        ui.notifications.error(game.i18n.localize(`${I18N}.campaign.createFailed`));
        return;
      }
      ui.notifications.info(game.i18n.format(`${I18N}.campaign.converted`, { name: campaign.name }));
    }
  });
}

export function registerFolderContext() {
  Hooks.on("getFolderContextOptions", (app, options) => {
    addOption(options);
    addConvertOption(options);
  });
}
