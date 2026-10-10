// Companion wrap of MEJ's _prepareTabs (spec 2026-10-09 §4.7; rule 2 per 2026-10-10 §3.1). MEJ deletes
// the relationships tab INSIDE the wrapped method, so the wrap works on its
// result: for a non-GM and the "primary" group it removes the tab when §3
// says hidden, and restores it from the parent class's _prepareTabs (the
// pre-MEJ-filtering tab object) when §3 says visible. PlaceSheet re-deletes
// the tab after calling super (PlaceSheet.js:61-76, in 13.06 and 14.01
// alike), so it is wrapped too; the decision is idempotent. Subclasses that
// call super._prepareTabs (SessionSheet, CampaignHubPage) inherit it.
// Never patches MEJ: installWraps (libWrapper when usable, manual otherwise).
import { MODULE_ID, PLAYER_GROUPS_SETTING, PLAYER_CONNECTIONS_SETTING } from "../constants.mjs";
import { installWraps } from "../logic/mej-wraps.mjs";
import { wrapEnv } from "../integrations/wrap-env.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { relationshipsTabVisible, countVisibleGmRows, applyRelationshipsTab } from "../logic/rel-tab-visibility.mjs";
import { readableNotebooks, writeNotebookFor } from "../data/party-notebook.mjs";
import { linesForEntry } from "../logic/party-rows.mjs";

const MEJ_FLAGS = "monks-enhanced-journal";

/** World setting "Players can create connections"; false if unreadable. */
export function playerConnectionsEnabled() {
  try {
    return game.settings.get(MODULE_ID, PLAYER_CONNECTIONS_SETTING) !== false;
  } catch {
    return false;
  }
}

const canLimited = (uuid) => {
  const doc = typeof uuid === "string" ? fromUuidSync(uuid) : null;
  return doc instanceof JournalEntry && doc.testUserPermission(game.user, "LIMITED") === true;
};

/** Spec §2.5 write rule for adding from this entry: setting on, writer on the notebook, allowed types. */
export function canAddParty(sheet, entry) {
  if (!playerConnectionsEnabled()) return false;
  if ((sheet.allowedRelationships?.length ?? 0) === 0) return false;
  const nb = writeNotebookFor(entry);
  return !!nb && (game.user.isGM || nb.isOwner === true) && entry.testUserPermission(game.user, "LIMITED") === true;
}

function relTabDecision(sheet) {
  const page = sheet.document;
  const entry = page?.parent;
  if (!(page instanceof JournalEntryPage) || !entry) return null;
  let hiddenBySetting = false;
  try {
    hiddenBySetting = sheet.sheetSettings?.()?.tabs?.relationships?.shown === false;
  } catch {
    hiddenBySetting = false;
  }
  const visibleGmRows = countVisibleGmRows(
    page.flags?.[MEJ_FLAGS]?.relationships,
    entry.getFlag(MODULE_ID, "relReveals") ?? {},
    {
      userId: game.user.id,
      groups: normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING)),
      sheetType: sheet.constructor?.type,
      canSeeTarget: canLimited
    }
  );
  const visiblePartyRows = linesForEntry(entry.uuid, readableNotebooks(), { canLimited }).length;
  const canAdd = canAddParty(sheet, entry);
  return {
    hiddenBySetting,
    visible: relationshipsTabVisible({ isGM: false, visibleGmRows, visiblePartyRows, canAdd })
  };
}

function makeWrapper(baseProto) {
  return function relationshipsTabWrapper(wrapped, group) {
    const tabs = wrapped(group);
    if (group !== "primary" || game.user.isGM) return tabs;
    try {
      const decision = relTabDecision(this);
      if (!decision) return tabs;
      const fullTabs = decision.visible && !decision.hiddenBySetting && !tabs?.relationships
        ? baseProto._prepareTabs.call(this, group)
        : null;
      const { tabs: next, activate } = applyRelationshipsTab(tabs, { ...decision, fullTabs });
      if (activate && this.tabGroups) this.tabGroups[group] = activate;
      return next;
    } catch (err) {
      console.error(`${MODULE_ID} | relationships tab decision failed`, err);
      return tabs;
    }
  };
}

export async function registerRelationshipsTabWrap() {
  let EnhancedJournalSheet;
  let PlaceSheet = null;
  try {
    ({ EnhancedJournalSheet } = await import("/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js"));
  } catch (err) {
    console.warn(`${MODULE_ID} | relationships tab visibility unavailable: MEJ sheet class not importable`, err);
    return;
  }
  try {
    ({ PlaceSheet } = await import("/modules/monks-enhanced-journal/sheets/PlaceSheet.js"));
  } catch {
    PlaceSheet = null;
  }
  const wrapper = makeWrapper(Object.getPrototypeOf(EnhancedJournalSheet.prototype));
  const specs = [{ name: "EnhancedJournalSheet._prepareTabs", object: EnhancedJournalSheet?.prototype, key: "_prepareTabs", wrapper }];
  if (PlaceSheet?.prototype && Object.hasOwn(PlaceSheet.prototype, "_prepareTabs")) {
    specs.push({ name: "PlaceSheet._prepareTabs", object: PlaceSheet.prototype, key: "_prepareTabs", wrapper });
  }
  const result = installWraps(specs, wrapEnv("relationships tab"));
  if (result.failed) console.warn(`${MODULE_ID} | relationships tab visibility unavailable (wrap not installable)`);
}
