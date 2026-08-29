// Injects the Phase B "knowledge panel" (tags, attributes, Mentioned in)
// into every MEJ-typed journal sheet, both shell-hosted and popped out.
// Injection hooks (no libWrapper - see the spec's §5 refinement):
//  - "renderJournalPageSheet": fired by MEJ's shell at the end of
//    renderSubSheet (apps/enhanced-journal.js:691) with the subsheet, its
//    root element, and a context carrying `enhancedjournal`.
//  - "renderEnhancedJournalSheet": the standard ApplicationV2 inheritance-
//    chain render hook, fired when an MEJ sheet renders standalone
//    (popped out) - the shell path never calls _onRender, so these two
//    hooks are disjoint in practice; the injector is idempotent anyway.
import { MODULE_ID, I18N, MEDIA_PAGE_TYPES } from "../constants.mjs";
import { getTags, getAttributes, normalizeTagInput } from "../logic/knowledge-flags.mjs";
import { backlinksForEntry } from "../search/live-index.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

/** The page this sheet fronts, if the companion owns its presentation: an MEJ-typed page, or a native media page the companion mounts (spec E §1). */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  if (mejType(doc)) return doc;
  const bare = String(doc.type ?? "").split(".").pop();
  return MEDIA_PAGE_TYPES.includes(bare) ? doc : null;
}

// --- Live "Mentioned in" refresh -------------------------------------------
// injectPanel builds the backlink list once per render, so a panel already on
// screen goes stale when a mention is added or removed on some OTHER entry -
// exactly the auto-link case: typing "met Elara at the docks" into a session
// page updates Elara's row in the backlink index (live-index.mjs's own page
// hooks) but not her already-open sheet. Track every injected panel and
// re-inject when journal content that can carry @UUID refs changes. The
// debounce both coalesces multi-page bursts (imports, retro-link passes)
// into one pass and guarantees the pass runs after live-index's handlers for
// the same hooks, regardless of Hooks registration order.
// Two collections, because the job needs both identity lookup and iteration
// (C13). The previous single Set held a wrapper object per panel STRONGLY -
// only the fields inside it were weak - so every element ever injected stayed
// reachable until refreshTrackedPanels happened to prune it, and trackPanel
// scanned the whole set on every injection to de-duplicate. A long session
// with many sheet renders grew the set without bound and paid an O(n) scan
// on each injection.
//
// Now the record hangs off the element itself, so it becomes collectable with
// the element and lookup is O(1); the Set holds only weak references, purely
// for iteration, and is pruned as it is walked.
const panelRecords = new WeakMap();
const trackedElements = new Set();

function trackPanel(sheet, element, shellHosted) {
  // Re-injecting MOVES the element to the end of the iteration order, which
  // the old delete-then-add on a Set did as a side effect and which
  // refreshTrackedPanels depends on: injectPanel clears the first
  // `.mej-cc-knowledge` INSIDE the element it is given, so when one tracked
  // element is nested in another (a page container inside the shell root),
  // refreshing them oldest-first has the outer pass strip the inner pass's
  // freshly-built panel, and the next refresh then leaves BOTH populated -
  // two panels on screen. Keeping the most recently injected element last
  // preserves the old, correct ordering; the ref is stored on the record so
  // this stays O(1) instead of the scan it replaced.
  const prev = panelRecords.get(element);
  if (prev) trackedElements.delete(prev.ref);
  const ref = new WeakRef(element);
  trackedElements.add(ref);
  panelRecords.set(element, { ref, sheet: new WeakRef(sheet), shellHosted });
}

function refreshTrackedPanels() {
  for (const ref of [...trackedElements]) {
    const element = ref.deref();
    const item = element ? panelRecords.get(element) : null;
    const sheet = item?.sheet.deref();
    if (!sheet || !element?.isConnected) {
      trackedElements.delete(ref);
      // Drop the record too, or a later re-injection into this same element
      // would find a stale entry and skip re-adding it to the iteration set.
      if (element) panelRecords.delete(element);
      continue;
    }
    // Never yank the DOM out from under a panel the user is typing in (tag
    // input, attribute fields) - the next natural render catches it up.
    const panel = element.querySelector(":scope .mej-cc-knowledge");
    if (panel && panel.contains(document.activeElement)) continue;
    injectPanel(sheet, element, { shellHosted: item.shellHosted })
      .catch((err) => console.error(`${MODULE_ID} | knowledge panel refresh failed`, err));
  }
}

async function injectPanel(sheet, element, { shellHosted = false } = {}) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  trackPanel(sheet, element, shellHosted);
  element.querySelector(":scope .mej-cc-knowledge")?.remove();

  const entryUuid = page.parent?.uuid ?? page.uuid;
  const canEdit = game.user.isGM;
  const backlinks = backlinksForEntry(entryUuid).map((row) => ({
    ...row, icon: `fas ${game.MonksEnhancedJournal.getIcon(row.type)}`
  }));
  // playerHidden attribute rows must never reach a non-GM template context -
  // the read-only branch of knowledge-panel.hbs has no playerHidden check of
  // its own (unlike the editable branch's tag-remove/attr-hidden controls,
  // which are already gated behind {{#if canEdit}}), so an unfiltered array
  // here leaked hidden attribute values verbatim to any viewer with mere
  // OBSERVER access (confirmed live via 07-knowledge.spec.mjs's leak check).
  const attributes = canEdit ? getAttributes(page) : getAttributes(page).filter((a) => !a.playerHidden);
  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/knowledge-panel.hbs`,
    { pageUuid: page.uuid, canEdit, tags: getTags(page), attributes, backlinks }
  );
  // DOMParser rather than createContextualFragment (S1). This html is our own
  // Handlebars output, so it is escaped and the exposure is far smaller than
  // at the two sites that parse page bodies - but keeping one parser across
  // the module leaves no live-context parse for the next reader to copy. The
  // panel is plain markup (no custom elements to upgrade), and appendChild
  // adopts it into the live document along with the listeners bound below.
  const panel = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  bindPanel(panel, page, sheet, shellHosted);
  element.appendChild(panel);
}

async function saveAttributes(panel, page) {
  const rows = [...panel.querySelectorAll("[data-attr-id]")].map((tr) => ({
    id: tr.dataset.attrId,
    key: tr.querySelector(".mej-cc-attr-key")?.value?.trim() ?? "",
    value: tr.querySelector(".mej-cc-attr-value")?.value ?? "",
    playerHidden: tr.querySelector(".mej-cc-attr-hidden")?.checked === true
  })).filter((r) => r.key);
  await page.update({ [`flags.${MODULE_ID}.attributes`]: rows });
}

function bindPanel(panel, page, sheet, shellHosted) {
  if (!game.user.isGM) {
    bindBacklinks(panel);
    return;
  }
  // MEJ only auto-re-renders the shell for updates under its OWN flag
  // namespace (enhanced-journal.js's updateJournalEntryPage hook checks a
  // fixed renderUpdateKeys allowlist against flags["monks-enhanced-
  // journal"], plus a few top-level keys - flags["mej-campaign-companion"]
  // writes match none of it) - confirmed live, a tag/attribute edit through
  // this panel left the shell showing stale content indefinitely with no
  // fix. Shell-hosted subsheets need an explicit reload of the shell itself
  // (mirroring MEJ's own hook's `{reload: true}` render call - a plain
  // subsheet-only render() doesn't refire "renderJournalPageSheet", which is
  // a custom hook MEJ's renderSubSheet fires by hand, not a generic
  // Application render event); a standalone popped-out sheet (shellHosted
  // false) IS itself the Application "renderEnhancedJournalSheet" fires for,
  // so a plain render() there already re-triggers injection correctly
  // (confirmed live).
  const refresh = () => {
    const shell = shellHosted ? game.MonksEnhancedJournal?.journal : null;
    if (shell?.rendered) {
      shell.render({ tempOwnership: shell.tempOwnership, reload: true });
    } else {
      sheet.render?.({ parts: ["main"] });
    }
  };

  // Attribute field edits are coalesced through a single debounced writer:
  // each "change" listener below fires its own async page.update() carrying
  // the FULL current attributes array (saveAttributes reads every row fresh
  // off the DOM), so two edits made close together - one field committed via
  // blur, a second field edited and blurred before the first write's round
  // trip completes - raced two concurrent page.update() calls against the
  // same document. Confirmed live: whichever call's response arrived second
  // won regardless of send order, so the first-sent edit could silently
  // clobber the second-sent one's already-persisted value. Debouncing to one
  // write per burst removes the possibility of two in-flight updates
  // entirely - by the time the write fires, the DOM (and thus the array it
  // reads) already reflects every edit in the burst.
  const commitAttributes = foundry.utils.debounce(async () => {
    await saveAttributes(panel, page);
    refresh();
  }, 300);

  panel.querySelector(".mej-cc-tag-input")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const added = normalizeTagInput(event.target.value);
    if (!added.length) return;
    const tags = [...new Set([...getTags(page), ...added])];
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
    refresh();
  });
  panel.querySelectorAll(".mej-cc-tag-remove").forEach((a) => a.addEventListener("click", async () => {
    const tags = getTags(page).filter((t) => t !== a.dataset.tag);
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
    refresh();
  }));
  panel.querySelector(".mej-cc-attr-add")?.addEventListener("click", async () => {
    const rows = [...getAttributes(page), { id: foundry.utils.randomID(8), key: game.i18n.localize(`${I18N}.knowledge.newKey`), value: "", playerHidden: false }];
    await page.update({ [`flags.${MODULE_ID}.attributes`]: rows });
    refresh();
  });
  panel.querySelectorAll(".mej-cc-attr-delete").forEach((a) => a.addEventListener("click", () => {
    a.closest("[data-attr-id]")?.remove();
    commitAttributes();
  }));
  panel.querySelectorAll(".mej-cc-attr-key, .mej-cc-attr-value, .mej-cc-attr-hidden").forEach((input) =>
    input.addEventListener("change", commitAttributes)
  );
  bindBacklinks(panel);
}

function bindBacklinks(panel) {
  panel.querySelectorAll(".mej-cc-backlink-row").forEach((li) => li.addEventListener("click", async () => {
    const entry = await fromUuid(li.dataset.uuid);
    if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
  }));
}

export function registerKnowledgePanel() {
  Hooks.on("renderJournalPageSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html), { shellHosted: true }).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html), { shellHosted: false }).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });

  // Live "Mentioned in" refresh (see trackedPanels above). The update filter
  // mirrors what can actually move a backlink row: page text (new/removed
  // @UUID refs - the auto-link path lands here), names (row labels), and
  // ownership (row visibility). Creates/deletes always refresh - a deleted
  // source drops its mentions, a created page may carry import-time links.
  const scheduleRefresh = foundry.utils.debounce(refreshTrackedPanels, 250);
  const relevantChange = (changes) =>
    changes?.text?.content !== undefined || changes?.name !== undefined || changes?.ownership !== undefined;
  Hooks.on("updateJournalEntryPage", (page, changes) => { if (relevantChange(changes)) scheduleRefresh(); });
  Hooks.on("updateJournalEntry", (entry, changes) => { if (relevantChange(changes)) scheduleRefresh(); });
  Hooks.on("createJournalEntryPage", () => scheduleRefresh());
  // Pages embedded in JournalEntry.create({pages: [...]}) never fire
  // createJournalEntryPage - and that shape IS every real creation path here
  // (MEJ's New Entry dialog, auto-capture, the import wizard). Same Foundry
  // behavior live-index.mjs's initSearchHooks documents and works around.
  Hooks.on("createJournalEntry", () => scheduleRefresh());
  Hooks.on("deleteJournalEntryPage", () => scheduleRefresh());
  Hooks.on("deleteJournalEntry", () => scheduleRefresh());
}
