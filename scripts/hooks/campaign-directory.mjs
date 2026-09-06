// Campaign creation from the journal sidebar (spec 2026-09-06 §2): a GM-only
// New Campaign header button and a flag icon on campaign folder rows, on
// both Foundry's JournalDirectory and MEJ's shell sidebar copy - the same
// two hooks timeline-directory.mjs uses (see its header for why both run
// after MEJ's own decoration). Top-level imports are constants + pure logic
// only, so this registers at init; the dialog and store load on click.
import { I18N } from "../constants.mjs";
import { isCampaignFolder } from "../logic/campaigns.mjs";

const BUTTON_CLASS = "mej-cc-create-campaign";
const FOLDER_CLASS = "mej-cc-campaign-folder";
const FOLDER_ICON = "fa-solid fa-flag fa-fw";

function rootOf(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}

/**
 * Insert the New Campaign button after Create Folder. Only for a GM, and
 * only where the directory itself offers Create Folder (permission and
 * non-compendium surfaces both fall out of that one check). Idempotent.
 * Exported for tests.
 */
export function addCreateCampaignButton(root) {
  if (!root?.querySelector || !game.user?.isGM) return;
  const actions = root.querySelector(".directory-header .header-actions");
  const after = actions?.querySelector("button.create-folder");
  if (!actions || !after || actions.querySelector(`.${BUTTON_CLASS}`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.innerHTML = `<i class="fa-solid fa-flag" inert></i><span>${foundry.utils.escapeHTML(game.i18n.localize(`${I18N}.campaign.createButton`))}</span>`;
  button.addEventListener("click", onCreateCampaign);
  after.after(button);
}

async function onCreateCampaign(event) {
  event.preventDefault();
  const [{ promptNewCampaign }, { createCampaign }] = await Promise.all([
    import("../apps/new-campaign-dialog.mjs"),
    import("../data/campaign-store.mjs")
  ]);
  const result = await promptNewCampaign();
  if (!result) return;
  const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
  if (!campaign) {
    ui.notifications.error(game.i18n.localize(`${I18N}.campaign.createFailed`));
    return;
  }
  ui.notifications.info(game.i18n.format(`${I18N}.campaign.created`, { name: campaign.name }));
}

/** Flag icon + class on every campaign folder row under `root`. Idempotent. Exported for tests. */
export function decorateCampaignFolders(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("li.folder[data-folder-id]")) {
    const folder = game.folders.get(li.dataset.folderId);
    if (!folder || !isCampaignFolder(folder)) continue;
    li.classList.add(FOLDER_CLASS);
    const icon = li.querySelector(":scope > .folder-header > i");
    if (icon) icon.className = FOLDER_ICON;
  }
}

function decorate(root) {
  addCreateCampaignButton(root);
  decorateCampaignFolders(root);
}

export function registerCampaignDirectory() {
  Hooks.on("renderJournalDirectory", (app, html) => decorate(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => decorate(rootOf(app?.element)));
}
