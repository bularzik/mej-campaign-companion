// Closing the stray-campaign-page doors (spec 2026-09-06 §3). Registered at
// ready, not init: MEJ builds its New Entry type <select> in a module-level
// renderDialogV2 hook, and ours must run after it. Decisions are pure
// (logic/campaign-guard.mjs); this file only reads Foundry state and writes
// through the store. Imports the store dynamically so a stray create on a
// still-booting client never pulls the store in early.
import { MODULE_ID, I18N, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";
import { classifyCampaignPageCreate, strayCampaignIntent, CAMPAIGN_OPTION_VALUES } from "../logic/campaign-guard.mjs";
import { campaignOf, campaignOfFolder, hasPortalMarker, isCampaignTypedPage } from "../logic/campaigns.mjs";

// MEJ's New Entry picker and Foundry's Create Page picker.
const TYPE_SELECTS = 'select[name="flags.monks-enhanced-journal.pagetype"], select[name="type"]';

/** Remove every Campaign option from the page-type selects under `root`. Idempotent. Exported for tests. */
export function stripCampaignOptions(root) {
  if (!root?.querySelectorAll) return;
  for (const select of root.querySelectorAll(TYPE_SELECTS)) {
    let removedSelected = false;
    for (const opt of [...select.options]) {
      if (!CAMPAIGN_OPTION_VALUES.includes(opt.value)) continue;
      removedSelected ||= opt.selected;
      opt.remove();
    }
    if (removedSelected && select.options.length) select.selectedIndex = 0;
  }
}

function blocked() {
  ui.notifications.warn(game.i18n.localize(`${I18N}.campaign.strayBlocked`));
  return false;
}

/** preCreateJournalEntry: MEJ dialog intent (pagetype flag) or inline campaign pages. */
function onPreCreateEntry(entry, data) {
  const intent = strayCampaignIntent(data);
  if (!intent) return;
  const folder = data.folder ? game.folders.get(data.folder) ?? null : null;
  const verdict = classifyCampaignPageCreate({
    isPortal: false,
    isGM: game.user.isGM,
    entryPageCount: intent.otherPages,
    entryInCampaign: !!campaignOfFolder(folder)
  });
  if (verdict.startsWith("block")) return blocked();
}

/** preCreateJournalEntryPage: a campaign page added to an existing entry. */
function onPreCreatePage(page, data) {
  if (data.type !== CAMPAIGN_DOCUMENT_TYPE) return;
  const entry = page.parent;
  const verdict = classifyCampaignPageCreate({
    isPortal: data.flags?.[MODULE_ID]?.campaignPortal === true,
    isGM: game.user.isGM,
    entryPageCount: entry?.pages?.size ?? 0,
    entryInCampaign: !!campaignOf(entry)
  });
  if (verdict.startsWith("block")) return blocked();
}

/**
 * After creation, on the creating GM's client only: an entry holding exactly
 * one unmarked campaign page and no campaign becomes a campaign. Both create
 * hooks route here; the store re-checks eligibility under its own serial
 * chain, so the second arrival is a no-op.
 */
function maybeUpgrade(entry, userId) {
  if (userId !== game.user.id || !game.user.isGM || !entry?.pages) return;
  const pages = entry.pages.contents;
  if (pages.length !== 1 || !isCampaignTypedPage(pages[0]) || hasPortalMarker(pages[0]) || campaignOf(entry)) return;
  import("../data/campaign-store.mjs")
    .then(({ upgradeEntryToCampaign }) => upgradeEntryToCampaign(entry))
    .then((folder) => {
      if (folder) ui.notifications.info(game.i18n.format(`${I18N}.campaign.strayUpgraded`, { name: folder.name }));
    });
}

export function registerCampaignGuard() {
  Hooks.on("renderDialogV2", (dialog, html) => stripCampaignOptions(html instanceof HTMLElement ? html : html?.[0] ?? dialog?.element ?? null));
  Hooks.on("preCreateJournalEntry", (entry, data) => onPreCreateEntry(entry, data));
  Hooks.on("preCreateJournalEntryPage", (page, data) => onPreCreatePage(page, data));
  Hooks.on("createJournalEntry", (entry, options, userId) => maybeUpgrade(entry, userId));
  Hooks.on("createJournalEntryPage", (page, options, userId) => maybeUpgrade(page?.parent, userId));
}
