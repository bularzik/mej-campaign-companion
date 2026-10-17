// Injects the Phase B "knowledge panel" (tags, attributes, Mentioned in)
// into every MEJ-typed journal sheet, both shell-hosted and popped out,
// mounted as a right-hand rail beside the sheet body (mountRail).
// Injection hooks (no libWrapper - see the spec's §5 refinement):
//  - "renderJournalPageSheet": fired by MEJ's shell at the end of
//    renderSubSheet (apps/enhanced-journal.js:691) with the subsheet, its
//    root element, and a context carrying `enhancedjournal`.
//  - "renderEnhancedJournalSheet": the standard ApplicationV2 inheritance-
//    chain render hook, fired when an MEJ sheet renders standalone
//    (popped out) - the shell path never calls _onRender, so these two
//    hooks are disjoint in practice; the injector is idempotent anyway.
import { MODULE_ID, I18N, MEDIA_PAGE_TYPES, CAMPAIGN_DOCUMENT_TYPE, CAMPAIGN_TYPE, HUB_PAGE_ID, KNOWLEDGE_COLLAPSED_SETTING } from "../constants.mjs";
import { getTags, getAttributes, normalizeTagInput } from "../logic/knowledge-flags.mjs";
import { backlinksForEntry } from "../search/live-index.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";
import { knowledgeSummary } from "../logic/knowledge-summary.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { listNotes, notesEntryOf, addNote } from "../data/notes-store.mjs";
import { campaignEntries } from "../data/campaign-store.mjs";
import { linkNoteText, canMentionInNotes, enrichNoteText } from "./note-links.mjs";
import { openSessionPage as openCampaignSession } from "./current-session.mjs";
import { streamRows } from "../logic/tonight.mjs";
import { historyGroups } from "../logic/history.mjs";
import { noteAboutPrefix, fitsNoteLimit } from "../logic/note-about.mjs";
import { validNoteText } from "../logic/notes.mjs";
import { isSessionDoc } from "../logic/mej-type.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { confirmDelete } from "../apps/confirm-delete.mjs";
import { currentWorldComponents } from "../logic/campaign-calendar.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

/** The page this sheet fronts, if the companion owns its presentation: an MEJ-typed page, or a native media page the companion mounts (spec E §1). */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  // Shell pages (the campaign portal, the synthetic Hub page) are a third kind
  // this predicate had no notion of: they carry the MEJ type flag on purpose,
  // so search/index/export treat them as first-class, but their whole body IS
  // the Hub - there is nothing to tag, no attributes and no "mentioned in".
  // Guard on the native subtype, never on the MEJ flag, which is load-bearing.
  // MEJ's fixType() normalizes a mounted page's in-memory `.type` to the bare
  // key, so accept all three forms (same reasoning as CampaignHubPage's own
  // isCampaignPage check).
  if (doc.type === CAMPAIGN_DOCUMENT_TYPE || doc.type === CAMPAIGN_TYPE
      || doc._source?.type === CAMPAIGN_DOCUMENT_TYPE || doc.id === HUB_PAGE_ID) return null;
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
  // refreshTrackedPanels depends on: injectPanel clears the panels INSIDE the
  // element it is given, so when one tracked element is nested in another (a
  // page container inside the shell root), refreshing them oldest-first has
  // the outer pass strip the inner pass's freshly-built panel and the inner
  // pass rebuild it, leaving BOTH populated - two panels on screen. Keeping
  // the most recently injected element last preserves the old, correct
  // ordering; the ref is stored on the record so this stays O(1) instead of
  // the scan it replaced. (The duplicate that actually shipped was a
  // different one - two injections into the SAME element, see the token
  // below - but this ordering is still what keeps nesting single-panelled.)
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

// One live injection per element wins, and it is the newest one. injectPanel
// awaits its template, so the panel it appends belongs to a DOM state it read
// before that await - the reason every DOM mutation below happens in a single
// synchronous block AFTER the await, guarded by this token.
//
// The bug this closes (Task 4b): the stale-panel removal used to sit BEFORE
// the await and the append AFTER it, a check-then-act straddling a suspension
// point. Captured live with injectPanel instrumented, on a plain
// create-then-open of one entry:
//
//   enter    #1 hook:renderJournalPageSheet  panels=0
//   enter    #2 refreshTrackedPanels         panels=0   (+4ms)
//   appended #1 hook                         panels=1
//   appended #2 refreshTrackedPanels         panels=2
//
// Both calls target the same element - the render hook injects into it, and
// trackPanel() (above) registers it at the top of injectPanel, so the
// debounced refresh the create fires finds it while the first injection is
// still awaiting its template. Both saw zero panels, both appended.
//
// Two panels are 260px of a ~520px sheet: they squeeze MEJ's .sheet-container
// until section.sheet-body is clientHeight 0 and every control below the
// header stops being painted (the 09-secrets audience-button "intercept").
// And the pair was self-sustaining, because the removal below used to be a
// querySelector - one panel per pass, so removing one and appending one left
// the count at two forever. It removes ALL of them now.
const injectionTokens = new WeakMap();

async function injectPanel(sheet, element, { shellHosted = false } = {}) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  trackPanel(sheet, element, shellHosted);
  const token = (injectionTokens.get(element) ?? 0) + 1;
  injectionTokens.set(element, token);

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
  const tags = getTags(page);
  // Party notes about this entry, already audience-filtered by listNotes.
  // Stored note text is escaped plus @UUID shorthand only (linkNoteText), so
  // the enriched output is safe for {{{ }}}.
  const campaign = campaignOf(page);
  const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const noteRows = campaign ? streamRows(listNotes(campaign, { mentionsUuid: entryUuid }), game.user, { formatTime }).reverse() : [];
  const partyNotes = {
    // The button needs write access AND audience containment: the link prefix
    // is code-built, so it must not name an entry some notes reader cannot see.
    canWrite: !!campaign && !!notesEntryOf(campaign)?.isOwner && canMentionInNotes(campaign, page.parent ?? page),
    rows: await Promise.all(noteRows.map(async (r) => ({ ...r, text: await enrichNoteText(r.text) })))
  };
  // Every session in the campaign at any subfolder depth, as this user can see it (campaignEntries).
  const sessions = campaign ? campaignEntries(campaign).filter((e) => isSessionDoc(e) && e.pages.contents[0]).map((e) => ({
    uuid: e.uuid, name: e.name, order: sessionData(e.pages.contents[0]).sessionNumber ?? Number.MAX_SAFE_INTEGER
  })) : [];
  const history = historyGroups(backlinks, sessions);
  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/knowledge-panel.hbs`,
    {
      pageUuid: page.uuid, canEdit, tags, attributes, backlinks, partyNotes, history,
      collapsed: game.settings.get(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING),
      summary: knowledgeSummary(
        { tags: tags.length, attributes: attributes.length, backlinks: backlinks.length, notes: partyNotes.rows.length },
        (key, data) => game.i18n.format(key, data)
      )
    }
  );
  // DOMParser rather than createContextualFragment (S1). This html is our own
  // Handlebars output, so it is escaped and the exposure is far smaller than
  // at the two sites that parse page bodies - but keeping one parser across
  // the module leaves no live-context parse for the next reader to copy. The
  // panel is plain markup (no custom elements to upgrade), and appendChild
  // adopts it into the live document along with the listeners bound below.
  const panel = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  bindPanel(panel, page, sheet, shellHosted);
  bindRailTab(panel);
  // A newer injection started while this one was rendering: it read at least
  // as fresh a document state, so let it own the element and drop this panel
  // rather than appending a second one.
  if (injectionTokens.get(element) !== token) return;
  element.querySelectorAll(":scope .mej-cc-knowledge").forEach((stale) => stale.remove());
  mountRail(element, panel);
}

/**
 * Mount the panel as a right-hand rail (spec 2026-10-16 §3). The sheet body -
 * MEJ's .sheet-container, or the companion's own .mej-cc-media-page - sits
 * alone in its parent (MEJ's .journal-subsheet in the shell, .window-content
 * on a popped-out sheet); that parent is marked .mej-cc-rail-row, which lays
 * it out as a flex row, and the panel is appended beside the body. The body
 * is never moved: re-parenting it disconnects and reconnects every
 * <prose-mirror> inside, and Foundry 13's connectedCallback then throws in
 * EditorView.updateState ("Cannot read properties of null (reading
 * 'matchesNode')", stock gate 2026-10-17). Marking is idempotent across
 * re-injections. In the shell a re-render replaces the parent wholesale; a
 * popped-out window keeps its .window-content, where the mark alone changes
 * nothing visible (the body is the row's only flex item and fills it). A page
 * with no panel is never marked. A sheet with no body, or whose body
 * shares its parent with other content (an unexpected template), gets the
 * panel appended to the sheet as before.
 */
function mountRail(element, panel) {
  const body = element.querySelector(".sheet-container, .mej-cc-media-page");
  const row = body?.parentElement;
  const alone = row && element.contains(row)
    && [...row.children].every((child) => child === body || child.classList.contains("mej-cc-knowledge"));
  if (!alone) {
    element.appendChild(panel);
    return;
  }
  row.classList.add("mej-cc-rail-row");
  row.appendChild(panel);
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

// "Note about this": a party note prefixed with a link to the entry being
// viewed. The prefix is built by code (noteAboutPrefix); the user's text goes
// through linkNoteText like any note. No page text is ever copied in.
let noteAboutBusy = false;

function bindNoteAbout(panel, page) {
  panel.querySelector('[data-action="noteAbout"]')?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation(); // the button sits in a <summary>; don't toggle the section
    if (noteAboutBusy) return;
    const campaign = campaignOf(page);
    if (!campaign) return;
    noteAboutBusy = true;
    try {
      const entry = page.parent ?? page;
      const refuse = () => ui.notifications.warn(game.i18n.localize(`${I18N}.notes.aboutHidden`));
      if (!canMentionInNotes(campaign, entry)) return refuse();
      const raw = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.format(`${I18N}.notes.aboutTitle`, { name: entry.name }) },
        content: `<textarea name="text" rows="3" maxlength="2000" style="width:100%" placeholder="${foundry.utils.escapeHTML(game.i18n.localize(`${I18N}.notes.capturePlaceholder`))}"></textarea>`,
        ok: { label: game.i18n.localize(`${I18N}.notes.capture`), callback: (ev, button) => button.form.elements.text.value },
        rejectClose: false
      });
      const text = validNoteText(raw);
      if (!text) return;
      // Audience can change while the dialog is open: check again before writing.
      if (!canMentionInNotes(campaign, entry)) return refuse();
      const stored = `${noteAboutPrefix(entry.uuid, entry.name)} ${linkNoteText(campaign, text)}`;
      if (!fitsNoteLimit(stored)) {
        ui.notifications.warn(game.i18n.localize(`${I18N}.notes.badText`));
        return;
      }
      try {
        await addNote(campaign, {
          text: stored,
          sessionUuid: openCampaignSession(campaign)?.uuid ?? null,
          worldDate: currentWorldComponents()
        });
        ui.notifications.info(game.i18n.localize(`${I18N}.notes.captured`));
      } catch (err) {
        ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
      }
    } finally {
      noteAboutBusy = false;
    }
  });
}

function bindPanel(panel, page, sheet, shellHosted) {
  bindNoteAbout(panel, page);
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
  panel.querySelectorAll(".mej-cc-attr-delete").forEach((a) => a.addEventListener("click", async () => {
    const row = a.closest("[data-attr-id]");
    const name = row?.querySelector(".mej-cc-attr-key")?.value ?? "";
    if (!(await confirmDelete({ kind: "attribute", name }))) return;
    row?.remove();
    commitAttributes();
  }));
  panel.querySelectorAll(".mej-cc-attr-key, .mej-cc-attr-value, .mej-cc-attr-hidden").forEach((input) =>
    input.addEventListener("change", commitAttributes)
  );
  bindBacklinks(panel);
}

// Whole-rail open/closed (spec 2026-09-04 §D, rail form 2026-10-16 §3): one
// client setting, read on every injection, so the state follows the user
// across sheets, re-renders and reloads. The inner <details> keep their own
// open/closed state. A real <button> toggles on Enter/Space natively.
function bindRailTab(panel) {
  const tab = panel.querySelector(".mej-cc-knowledge-tab");
  if (!tab) return;
  tab.addEventListener("click", async (event) => {
    event.preventDefault();
    const collapsed = !panel.classList.contains("collapsed");
    panel.classList.toggle("collapsed", collapsed);
    tab.setAttribute("aria-expanded", String(!collapsed));
    try {
      await game.settings.set(MODULE_ID, KNOWLEDGE_COLLAPSED_SETTING, collapsed);
    } catch (err) {
      console.error(`${MODULE_ID} | saving the knowledge rail state failed`, err);
    }
  });
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
  // A note added, edited or removed (the notes entry's per-note flag keys).
  Hooks.on("updateJournalEntry", (entry, changes) => {
    if (changes?.flags?.[MODULE_ID]?.notes !== undefined) scheduleRefresh();
  });
  Hooks.on("createJournalEntryPage", () => scheduleRefresh());
  // Pages embedded in JournalEntry.create({pages: [...]}) never fire
  // createJournalEntryPage - and that shape IS every real creation path here
  // (MEJ's New Entry dialog, auto-capture, the import wizard). Same Foundry
  // behavior live-index.mjs's initSearchHooks documents and works around.
  Hooks.on("createJournalEntry", () => scheduleRefresh());
  Hooks.on("deleteJournalEntryPage", () => scheduleRefresh());
  Hooks.on("deleteJournalEntry", () => scheduleRefresh());
}
