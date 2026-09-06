// Closing the stray-campaign-page doors (spec 2026-09-06 §3). Registered at
// the top of the ready hook (see campaign-companion.mjs), before awaiting
// onReady()'s native-mode wiring: MEJ builds its New Entry type <select> in
// a module-level renderDialogV2 hook, which is guaranteed to have already
// registered (all modules' top-level script code runs before init fires),
// so any point at or after init satisfies "after MEJ" - registering this
// early, rather than after onReady() resolves, closes a real race where a
// GM opens the New Entry dialog before that (occasionally slow) chain
// finishes. Decisions are pure (logic/campaign-guard.mjs); this file only
// reads Foundry state and writes through the store. Imports the store
// dynamically so a stray create on a still-booting client never pulls the
// store in early.
import { MODULE_ID, I18N, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";
import { classifyCampaignPageCreate, strayCampaignIntent, CAMPAIGN_OPTION_VALUES } from "../logic/campaign-guard.mjs";
import { campaignOf, campaignOfFolder, hasPortalMarker, isCampaignTypedPage } from "../logic/campaigns.mjs";

// MEJ's New Entry picker carries both Campaign option spellings (the bare
// MEJ registry key and the prefixed native subtype); Foundry's generic
// Create Page picker strips only the prefixed native subtype. A system or
// module is free to register its own subtype literally named "campaign" -
// stripping the bare value from a select that isn't MEJ's own would remove
// that entry from someone else's Create dialog.
const TYPE_SELECTS = [
  { selector: 'select[name="flags.monks-enhanced-journal.pagetype"]', values: CAMPAIGN_OPTION_VALUES },
  { selector: 'select[name="type"]', values: [CAMPAIGN_DOCUMENT_TYPE] }
];

/**
 * Remove every Campaign option from the page-type selects under `root`,
 * each select paired with the values it alone may strip (see TYPE_SELECTS).
 * Idempotent. Unit-tested directly (test/campaign-guard-hook.test.js).
 */
export function stripCampaignOptions(root) {
  if (!root?.querySelectorAll) return;
  for (const { selector, values } of TYPE_SELECTS) {
    for (const select of root.querySelectorAll(selector)) {
      let removedSelected = false;
      for (const opt of [...select.options]) {
        if (!values.includes(opt.value)) continue;
        removedSelected ||= opt.selected;
        opt.remove();
      }
      if (removedSelected && select.options.length) select.selectedIndex = 0;
      for (const group of [...select.querySelectorAll("optgroup")]) {
        if (!group.querySelector("option")) group.remove();
      }
    }
  }
}

/** Normalize a render hook's `html` argument: a bare HTMLElement on AppV2, jQuery-wrapped on AppV1. */
function rootOf(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}

function blocked(verdict) {
  const key = verdict === "block-not-gm" ? "strayNotGm" : "strayBlocked";
  ui.notifications.warn(game.i18n.localize(`${I18N}.campaign.${key}`));
  return false;
}

/** preCreateJournalEntry: MEJ dialog intent (pagetype flag) or inline campaign pages. */
function onPreCreateEntry(entry, data) {
  const intent = strayCampaignIntent(data);
  if (!intent) return;
  // Foundry creation data accepts a Folder document in place of an id;
  // `entry` (the pending document instance) already resolves that either
  // way, so prefer it and fall back to a manual lookup only if it can't.
  const folder = entry.folder ?? game.folders.get(data.folder?.id ?? data.folder) ?? null;
  const verdict = classifyCampaignPageCreate({
    isPortal: false,
    isGM: game.user.isGM,
    entryPageCount: intent.otherPages,
    entryInCampaign: !!campaignOfFolder(folder)
  });
  if (verdict.startsWith("block")) return blocked(verdict);
}

/** preCreateJournalEntryPage: a campaign page added to an existing entry. */
function onPreCreatePage(page, data) {
  if (!isCampaignTypedPage(data)) return;
  const entry = page.parent;
  const verdict = classifyCampaignPageCreate({
    isPortal: data.flags?.[MODULE_ID]?.campaignPortal === true,
    isGM: game.user.isGM,
    entryPageCount: entry?.pages?.size ?? 0,
    entryInCampaign: !!campaignOf(entry)
  });
  if (verdict.startsWith("block")) return blocked(verdict);
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
    })
    .catch((err) => console.error(`${MODULE_ID} | campaign upgrade failed for ${entry.uuid}`, err));
}

export function registerCampaignGuard() {
  Hooks.on("renderDialogV2", (dialog, html) => stripCampaignOptions(rootOf(html) ?? dialog?.element ?? null));
  // Stock MEJ 13.06's New Entry dialog is a plain AppV1 Dialog, not a
  // DialogV2, so renderDialogV2 never fires for it and Campaign would leak
  // through untouched. renderDialog is AppV1's equivalent render hook.
  Hooks.on("renderDialog", (app, html) => stripCampaignOptions(rootOf(html)));
  Hooks.on("preCreateJournalEntry", (entry, data) => onPreCreateEntry(entry, data));
  Hooks.on("preCreateJournalEntryPage", (page, data) => onPreCreatePage(page, data));
  Hooks.on("createJournalEntry", (entry, options, userId) => maybeUpgrade(entry, userId));
  Hooks.on("createJournalEntryPage", (page, options, userId) => maybeUpgrade(page?.parent, userId));
}
