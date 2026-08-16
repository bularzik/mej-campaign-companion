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
import { MODULE_ID, I18N } from "../constants.mjs";
import { getTags, getAttributes, normalizeTagInput } from "../logic/knowledge-flags.mjs";
import { backlinksForEntry } from "../search/live-index.mjs";

function asElement(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  return html[0] instanceof HTMLElement ? html[0] : null; // jQuery
}

/** The page this sheet fronts, only if it's a real MEJ-typed JournalEntryPage. */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  return game.MonksEnhancedJournal?.getMEJType?.(doc) ? doc : null;
}

async function injectPanel(sheet, element) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  element.querySelector(":scope .mej-cc-knowledge")?.remove();

  const entryUuid = page.parent?.uuid ?? page.uuid;
  const canEdit = game.user.isGM;
  const backlinks = backlinksForEntry(entryUuid).map((row) => ({
    ...row, icon: `fas ${game.MonksEnhancedJournal.getIcon(row.type)}`
  }));
  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/knowledge-panel.hbs`,
    { pageUuid: page.uuid, canEdit, tags: getTags(page), attributes: getAttributes(page), backlinks }
  );
  const panel = document.createRange().createContextualFragment(html).firstElementChild;
  bindPanel(panel, page, sheet);
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

function bindPanel(panel, page, sheet) {
  if (!game.user.isGM) {
    bindBacklinks(panel);
    return;
  }
  const rerender = () => queueMicrotask(() => sheet.render?.({ parts: ["main"] }));

  panel.querySelector(".mej-cc-tag-input")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    const added = normalizeTagInput(event.target.value);
    if (!added.length) return;
    const tags = [...new Set([...getTags(page), ...added])];
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
  });
  panel.querySelectorAll(".mej-cc-tag-remove").forEach((a) => a.addEventListener("click", async () => {
    const tags = getTags(page).filter((t) => t !== a.dataset.tag);
    await page.update({ [`flags.${MODULE_ID}.tags`]: tags });
  }));
  panel.querySelector(".mej-cc-attr-add")?.addEventListener("click", async () => {
    const rows = [...getAttributes(page), { id: foundry.utils.randomID(8), key: game.i18n.localize(`${I18N}.knowledge.newKey`), value: "", playerHidden: false }];
    await page.update({ [`flags.${MODULE_ID}.attributes`]: rows });
  });
  panel.querySelectorAll(".mej-cc-attr-delete").forEach((a) => a.addEventListener("click", async () => {
    a.closest("[data-attr-id]").remove();
    await saveAttributes(panel, page);
  }));
  panel.querySelectorAll(".mej-cc-attr-key, .mej-cc-attr-value, .mej-cc-attr-hidden").forEach((input) =>
    input.addEventListener("change", () => saveAttributes(panel, page))
  );
  bindBacklinks(panel);
  void rerender; // page.update triggers updateJournalEntryPage -> MEJ re-renders the sheet
}

function bindBacklinks(panel) {
  panel.querySelectorAll(".mej-cc-backlink-row").forEach((li) => li.addEventListener("click", async () => {
    const entry = await fromUuid(li.dataset.uuid);
    if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
  }));
}

export function registerKnowledgePanel() {
  Hooks.on("renderJournalPageSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html)).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });
  Hooks.on("renderEnhancedJournalSheet", (sheet, html) => {
    injectPanel(sheet, asElement(html)).catch((err) => console.error(`${MODULE_ID} | knowledge panel injection failed`, err));
  });
}
