// scripts/hooks/entity-from-selection.mjs
// "Create Entity from Selection" (spec 2026-09-22): adds one entry to MEJ's
// description context menu through a manual wrap of
// EnhancedJournalSheet.prototype._getDescriptionContextOptions - MEJ builds
// that menu with `new ContextMenu(...)` directly, so no hook exists to
// extend it. Manual (no libWrapper path): the class is an ES-module export,
// not reachable by a global path string.
//
// Cross-version ContextMenu API (spike 2026-09-22 (b)): Foundry 14.368 reads
// `label`/`visible(target)`/`onClick(event, target)`; Foundry 13.351 reads
// only `name`/`condition(target)`/`callback(target)` (single argument, no
// event) and its renderer reads `item.name` for the label, never
// `item.label`. Every entry below carries both spellings.
//
// Live-selection capture (spike (c)): `window.getSelection()` is already
// empty by the time a ContextMenu entry's `visible`/`condition`/`onClick`/
// `callback` runs. A single document-level capture-phase `mousedown`
// listener (right button only) captures the selection EARLIER, while it is
// still live, and stashes it as `lastCapture`; the menu entry and
// `startFromSelection` read that stashed capture instead of the DOM
// selection at click time.
import { MODULE_ID, I18N, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING, RETRO_LINK_MODE_SETTING, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { installWraps } from "../logic/mej-wraps.mjs";
import { wrapEnv } from "../integrations/wrap-env.mjs";
import { captureSelection } from "../logic/selection-capture.mjs";
import { linkableRegions } from "../logic/link-targets.mjs";
import { campaignOf, campaignFlagOf, isContributor } from "../logic/campaigns.mjs";
import { runEntityFromSelection } from "../logic/entity-from-selection-run.mjs";
import { promptEntityFromSelection } from "../apps/entity-from-selection-dialog.mjs";
import { createMejEntry } from "../data/mej-entry.mjs";
import { runRetroPass } from "./retro-link.mjs";

/** How long a captured selection stays usable after a right mousedown (ruling 2). */
const CAPTURE_TTL_MS = 10000;

/** Foundry-bound deps for the pipeline (GM path here, relay handler in Task 7). */
export function pipelineDeps() {
  return {
    moduleId: MODULE_ID,
    fromUuid: (u) => fromUuid(u),
    createMejEntry,
    runRetroPass: (entries) => runRetroPass(entries),
    getProperty: (o, p) => foundry.utils.getProperty(o, p),
    logError: (msg, err) => console.error(`${MODULE_ID} | ${msg}`, err)
  };
}

/** The rendered editor under the pointer, if it is in display mode. */
function displayFor(target) {
  const parent = target?.closest?.(".editor-parent") ?? null;
  if (!parent || parent.classList.contains("editing")) return null;
  if (parent.querySelector(".editor-control prose-mirror.active, .editor-control .ProseMirror")) return null;
  return parent.querySelector(".editor-display[data-key]");
}

// The last right-button mousedown's captured selection, or null. Read by
// eligibilityFromCapture; cleared once startFromSelection has consumed it
// (ruling 2) so a stale capture cannot be replayed for a later click.
let lastCapture = null;

/** Capture-phase mousedown listener (ruling 2): stash the live selection NOW, before ContextMenu clears it. */
function onRightMouseDown(event) {
  if (event.button !== 2) return;
  const display = displayFor(event.target);
  if (!display) {
    lastCapture = null;
    return;
  }
  const capture = captureSelection(display, window.getSelection());
  lastCapture = { parent: display.closest(".editor-parent"), display, capture, at: Date.now() };
}

/**
 * Everything the click needs, or null when the item must stay hidden (spec
 * §4.2). Reads the STASHED capture (lastCapture), never a live selection
 * read - the live selection is gone by the time ContextMenu calls this
 * (spike (c)).
 */
export function eligibilityFromCapture(sheet, target) {
  const page = sheet?.document;
  if (!page || !lastCapture) return null;
  const parent = target?.closest?.(".editor-parent") ?? null;
  if (!parent || parent !== lastCapture.parent) return null;
  if (Date.now() - lastCapture.at >= CAPTURE_TTL_MS) return null;
  const capture = lastCapture.capture;
  if (!capture) return null;
  const fieldKey = lastCapture.display.dataset.key;
  if (!linkableRegions(page).some((r) => r.key === fieldKey)) return null;
  if (game.user.isGM) return sheet.isEditable ? { page, fieldKey, capture, relay: false } : null;
  const campaign = campaignOf(page);
  if (!campaign || !game.users.activeGM) return null;
  const groups = game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING);
  return isContributor(game.user, campaignFlagOf(campaign), groups) ? { page, fieldKey, capture, relay: true } : null;
}

/** Replaced by Task 7 (entity-from-selection-relay.mjs). */
let requestViaGm = async () => ({ ok: false, reason: "relay-unavailable" });
export function setRelay(fn) { requestViaGm = fn; }

export function showEntityOutcome(outcome, { type, name, sheet }) {
  const f = (k, d) => game.i18n.format(`${I18N}.entityFromSelection.${k}`, d);
  if (!outcome?.ok) {
    const reason = game.i18n.localize(`${I18N}.entityFromSelection.rejected.${outcome?.reason ?? "create-failed"}`);
    ui.notifications.error(f("failed", { reason }));
    return;
  }
  const typeLabel = game.i18n.localize(game.MonksEnhancedJournal?.getTypeLabels?.()?.[type] ?? type);
  if (outcome.linked) ui.notifications.info(f("created", { type: typeLabel, name }));
  else ui.notifications.warn(f("createdNotLinked", { type: typeLabel, name }));
  if (outcome.retro && !game.user.isGM && game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING) === "confirm") {
    ui.notifications.info(game.i18n.localize(`${I18N}.entityFromSelection.awaitingReview`));
  }
  const entry = fromUuidSync(outcome.entryUuid);
  const host = sheet?.enhancedjournal;
  if (entry && host && entry.testUserPermission(game.user, "OBSERVER")) {
    host.addTab(entry, { activate: false });
    host.render();
  }
}

async function startFromSelection(sheet, target) {
  // Re-check against the STASHED capture (ruling 2), not a live selection
  // read: the dialog awaited below steals focus and the live selection is
  // gone by the time ContextMenu's own click handler even runs (spike (c)).
  const ctx = eligibilityFromCapture(sheet, target);
  lastCapture = null;
  if (!ctx) return;
  const lastType = game.settings.get(MODULE_ID, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING);
  const choice = await promptEntityFromSelection({ name: ctx.capture.text, lastType });
  if (!choice) return;
  await game.settings.set(MODULE_ID, ENTITY_FROM_SELECTION_LAST_TYPE_SETTING, choice.type);
  const request = { pageUuid: ctx.page.uuid, fieldKey: ctx.fieldKey, ...ctx.capture, ...choice };
  const outcome = ctx.relay ? await requestViaGm(request) : await runEntityFromSelection(request, pipelineDeps());
  showEntityOutcome(outcome, { type: choice.type, name: choice.name, sheet });
}

export async function registerEntityFromSelection() {
  let EnhancedJournalSheet;
  try {
    ({ EnhancedJournalSheet } = await import("/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js"));
  } catch (err) {
    console.warn(`${MODULE_ID} | entity-from-selection unavailable: MEJ sheet class not importable`, err);
    return;
  }
  const result = installWraps([{
    name: "_getDescriptionContextOptions",
    object: EnhancedJournalSheet?.prototype,
    key: "_getDescriptionContextOptions",
    wrapper(wrapped, ...args) {
      const menu = wrapped(...args);
      const sheet = this;
      // Both API shapes (ruling 1): 14.368 reads label/visible/onClick(event,
      // target); 13.351 reads name/condition/callback(target) with no event.
      const label = game.i18n.localize(`${I18N}.entityFromSelection.menu`);
      const isVisible = (t) => !!eligibilityFromCapture(sheet, t);
      const run = (t) => startFromSelection(sheet, t);
      menu.push({
        label, name: label, icon: '<i class="fas fa-user-plus"></i>',
        visible: isVisible, condition: isVisible,
        onClick: (event, t) => run(t), callback: (t) => run(t)
      });
      return menu;
    }
  }], wrapEnv("entity from selection"));
  if (result.failed) {
    console.warn(`${MODULE_ID} | entity-from-selection unavailable (wrap not installable)`);
    return;
  }
  // Capture-phase, document-level, installed once the wrap that will consume
  // it is actually in place (ruling 2).
  document.addEventListener("mousedown", onRightMouseDown, true);
}
