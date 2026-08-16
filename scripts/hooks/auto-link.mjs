// scripts/hooks/auto-link.mjs
// Adapted from campaign-record's scripts/hooks/auto-link.mjs. Candidates come
// from MEJ-typed JournalEntries (not campaign-record "group" siblings), and
// the only field auto-linked is a journal page's own text.content.
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates } from "../logic/auto-link-candidates.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { MODULE_ID, AUTO_LINK_SETTING } from "../constants.mjs";

const NO_AUTO_LINK_FLAG = "noAutoLink";

/**
 * Linkable candidates: every other MEJ-typed JournalEntry visible to the
 * current user. Each candidate's `uuid` is the entry's own Foundry uuid
 * ("JournalEntry.<id>"), which is exactly the @UUID target auto-link.mjs
 * emits - so no format translation is needed here.
 */
function buildCandidates(selfEntryId) {
  const pages = game.journal
    .filter((entry) => game.MonksEnhancedJournal.getMEJType(entry))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: isVisibleToUser(entry, game.user)
    }));
  return selectCandidates({ pages, selfId: selfEntryId });
}

/**
 * On a committed page save, wrap newly-added MEJ entry-name mentions in
 * text.content as @UUID content links.
 *
 * Baseline note: campaign-record anchors its diff baseline to the last full
 * sheet render (scripts/logic/auto-link-baseline.mjs, set from
 * BaseRecordSheet#_onRender) because its inline-edit fields autosave quietly
 * (`{ render: false }`) between renders, and preUpdateJournalEntryPage skips
 * those quiet saves - so the document's live field value can silently drift
 * past the last-processed state. MEJ's page text.content has no such quiet
 * autosave path: it's only written by an explicit editor "save" commit, which
 * always reaches this hook. So the pre-update `page.text.content` (the
 * content as of the last save that *did* run this hook) is already the
 * correct baseline, and the baseline module is unnecessary here.
 */
export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    try {
      if (!game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) return;
      if (page.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG)) return;
      const next = changes?.text?.content;
      if (next === undefined || typeof next !== "string" || !next) return;

      const candidates = buildCandidates(page.parent?.id);
      if (!candidates.length) return;

      const baseline = page.text?.content ?? "";
      const linked = autoLinkAdded(baseline, next, candidates);
      if (linked !== next) foundry.utils.setProperty(changes, "text.content", linked);
    } catch (err) {
      console.error(`${MODULE_ID} | auto-link failed`, err);
    }
  });
}
