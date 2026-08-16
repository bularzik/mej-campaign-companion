// Adapted from campaign-record's scripts/apps/import-wizard.mjs +
// import-upload.mjs. The source-picker step, the review table (title/type/
// timepoint columns), and the merge/split row-editing flow are kept as
// campaign-record built them - that UI is what the task brief calls out to
// preserve. What's adapted is everything past "confirm": campaign-record
// imports into one shared "group" JournalEntry (its own document model);
// the companion has no such container, so #onCreate below creates one
// top-level JournalEntry per row instead, using the same MEJ page shape
// auto-capture.mjs uses (data/mej-entry.mjs's createMejEntry) or, for a
// row explicitly typed "session", the companion's own session subtype.
//
// campaign-record's own ImportWizard already extended
// HandlebarsApplicationMixin(ApplicationV2) - no AppV1-\>AppV2 migration was
// needed here; this class is a straight structural port of that one.
import { COMPANION_IMPORT_TYPES, I18N, MODULE_ID, SESSION_DOCUMENT_TYPE } from "../constants.mjs";
import { splitSections, suggestType, buildImportPlan, mergeSections, splitSectionAt } from "../logic/doc-import.mjs";
import { loadVendorGlobal } from "../integrations/vendor-loader.mjs";
import { uploadInlineImages } from "./import-upload.mjs";
import { createMejEntry } from "../data/mej-entry.mjs";
import { ensureTimelineJournal } from "../data/timeline-journal.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { queueFiling } from "../logic/filing-queue.mjs";
import { validateCampaignComponents } from "../logic/campaign-date.mjs";
import { calendarBounds } from "../logic/campaign-calendar.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Convert a .docx File into HTML via the vendored mammoth bundle (script-tag loaded on first use). */
async function parseDocx(file) {
  const mammoth = await loadVendorGlobal("mammoth.browser.min.js", "mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return { html: result.value };
}

/**
 * Best-effort real-world-date -> campaign-date components conversion for a
 * docx session header's parsed ISO date ("YYYY-MM-DD", from
 * logic/doc-import.mjs's parseSectionDate). Numbers pass straight through
 * (year as-is, month 1-based -> 0-based, day as-is): this assumes the active
 * calendar's month numbering/count lines up with the Gregorian calendar the
 * docx header was written against. For a world running a non-Gregorian or
 * <12-month calendar, this is a known, deliberate approximation - there is
 * no general way to convert a real-world date into an arbitrary in-world
 * calendar without a mapping the docx itself doesn't provide.
 */
function isoDateToCampaignComponents(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (![y, m, d].every(Number.isInteger)) return null;
  return { year: y, month: m - 1, day: d, hour: null, minute: null };
}

/**
 * isoDateToCampaignComponents() is a blind numeric passthrough - it has no
 * idea whether the active calendar even has that many months/days (see its
 * doc comment). Validate the result against the world's actual
 * calendarBounds() (logic/campaign-calendar.mjs) before it's ever written:
 * out of bounds -> null (write no campaign date for this row) plus a
 * localized per-section warning surfaced in the result dialog, rather than
 * silently storing a nonsensical month/day.
 */
function safeCampaignDate(iso, label, warnings) {
  const components = isoDateToCampaignComponents(iso);
  if (!components) return null;
  if (validateCampaignComponents(components, calendarBounds())) return components;
  warnings.push(game.i18n.format(`${I18N}.import.dateOutOfRange`, { label }));
  return null;
}

/** Best-effort session number from a header like "Arc 2 Session 3" or "Session Zero". null when absent. */
function parseSessionNumber(title) {
  const m = /session\s+(zero|\d+)/i.exec(title ?? "");
  if (!m) return null;
  return m[1].toLowerCase() === "zero" ? 0 : Number(m[1]);
}

function sectionPreview(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export class ImportWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** GM-only entry point (see CampaignHubPage.mjs / templates/hub.hbs). */
  static open() {
    if (!game.user.isGM) return;
    new ImportWizard().render({ force: true });
  }

  static DEFAULT_OPTIONS = {
    id: "mej-campaign-companion-import",
    classes: ["mej-campaign-companion", "mej-cc-import-wizard-app"],
    window: { title: `${I18N}.import.title`, icon: "fa-solid fa-file-import" },
    position: { width: 640, height: "auto" },
    actions: {
      cancel: ImportWizard.#onCancel,
      backToSource: ImportWizard.#onBackToSource,
      createImport: ImportWizard.#onCreate,
      mergeUp: ImportWizard.#onMergeUp,
      splitSection: ImportWizard.#onSplitSection
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/import-wizard.hbs` }
  };

  state = { step: "source", docTitle: null, sections: [], rows: [] };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isSource = this.state.step === "source";
    context.isReview = this.state.step === "review";
    context.docTitle = this.state.docTitle;
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      canMergeUp: index > 0,
      canSplit: (this.state.sections[index]?.blocks?.length ?? 0) > 1,
      typeOptions: this.#typeOptions(row.type)
    }));
    return context;
  }

  #typeOptions(selected) {
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    const options = [
      { value: "text", label: game.i18n.localize(`${I18N}.import.typeText`) },
      ...COMPANION_IMPORT_TYPES.map((t) => ({
        value: t,
        label: t === "session"
          ? game.i18n.localize(`${I18N}.sheettype.session`)
          : game.i18n.localize(labels[t] ?? t)
      })),
      { value: "skip", label: game.i18n.localize(`${I18N}.import.typeSkip`) }
    ];
    return options.map((o) => ({ ...o, selected: o.value === selected }));
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector('.mej-cc-import-source input[type="file"]');
    if (input) {
      input.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) this.#onFileChosen(file);
      });
    }
  }

  #rowFromSection(section) {
    return {
      title: section.title === "Introduction"
        ? game.i18n.localize(`${I18N}.import.introduction`)
        : section.title,
      type: section.empty ? "skip" : suggestType(section, COMPANION_IMPORT_TYPES).type,
      timepoint: section.isSession,
      date: section.date,
      wordCount: section.wordCount,
      preview: sectionPreview(section.html)
    };
  }

  #setReading(on) {
    const input = this.element.querySelector('.mej-cc-import-source input[type="file"]');
    if (input) input.disabled = on;
    const status = this.element.querySelector(".mej-cc-import-reading");
    if (status) status.hidden = !on;
  }

  async #onFileChosen(file) {
    this.#setReading(true);
    let parsed;
    try {
      parsed = await parseDocx(file);
    } catch (error) {
      console.error(`${MODULE_ID} | docx parse failed`, error);
      this.#setReading(false);
      return ui.notifications.error(game.i18n.localize(`${I18N}.import.parseError`));
    }
    const root = new DOMParser().parseFromString(parsed.html, "text/html").body;
    const { title, sections } = splitSections(root);
    if (!sections.length) {
      this.#setReading(false);
      return ui.notifications.warn(game.i18n.localize(`${I18N}.import.noSections`));
    }
    this.state.docTitle = title ?? file.name.replace(/\.docx$/i, "");
    this.state.sections = sections;
    this.state.rows = sections.map((section) => this.#rowFromSection(section));
    this.state.step = "review";
    this.render();
  }

  /** Read the per-row fields back out of the review form. */
  #formRows() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    return this.state.rows.map((row, i) => ({
      ...row,
      title: form.elements[`title-${i}`].value.trim(),
      type: form.elements[`type-${i}`].value,
      timepoint: form.elements[`timepoint-${i}`].checked
    }));
  }

  static #onCancel() {
    this.close();
  }

  static #onBackToSource() {
    this.state = { step: "source", docTitle: null, sections: [], rows: [] };
    this.render();
  }

  static #onMergeUp(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    if (index <= 0) return;
    this.state.rows = this.#formRows();
    this.state.sections = mergeSections(this.state.sections, index);
    this.state.rows.splice(index, 1);
    const merged = this.state.sections[index - 1];
    this.state.rows[index - 1] = {
      ...this.state.rows[index - 1],
      wordCount: merged.wordCount,
      preview: sectionPreview(merged.html)
    };
    this.render();
  }

  static async #onSplitSection(event, target) {
    const index = Number(target.closest("[data-index]").dataset.index);
    this.state.rows = this.#formRows();
    const cutIndices = await this.#promptSplit(this.state.sections[index]);
    if (!cutIndices?.length) return;
    const before = this.state.sections.length;
    this.state.sections = splitSectionAt(this.state.sections, index, cutIndices);
    const count = this.state.sections.length - before + 1;
    const original = this.state.rows[index];
    const newRows = [];
    for (let i = 0; i < count; i++) {
      const section = this.state.sections[index + i];
      newRows.push(i === 0
        ? { ...original, wordCount: section.wordCount, preview: sectionPreview(section.html) }
        : this.#rowFromSection(section));
    }
    this.state.rows.splice(index, 1, ...newRows);
    this.render();
  }

  async #promptSplit(section) {
    const blocks = section.blocks;
    if (blocks.length < 2) return null;
    const escapeHTML = foundry.utils.escapeHTML;
    const parts = blocks.map((html, i) => {
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      const gap = i > 0
        ? `<label class="mej-cc-import-split-gap"><input type="checkbox" name="cut-${i}"> `
          + `${game.i18n.localize(`${I18N}.import.splitHere`)}</label>`
        : "";
      return `${gap}<p class="mej-cc-import-split-block">${escapeHTML(text)}</p>`;
    });
    const content = `<div class="mej-cc-import-split-modal">${parts.join("")}</div>`;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.format(`${I18N}.import.splitTitle`, { title: section.title }) },
      modal: true,
      content,
      buttons: [
        { action: "cancel", label: `${I18N}.import.cancel` },
        {
          action: "split", label: `${I18N}.import.splitConfirm`, default: true,
          callback: (event, button) => [...button.form.elements]
            .filter((el) => el.name?.startsWith("cut-") && el.checked)
            .map((el) => Number(el.name.slice(4)))
        }
      ],
      rejectClose: false
    });
    return Array.isArray(result) ? result : null;
  }

  /**
   * Create the document for one plan.pages[] row. `page.type` here is the
   * wizard's OWN plan-row type ("text"/"session"/every COMPANION_IMPORT_TYPES
   * entry - see doc-import.mjs), not a Foundry document type - do not
   * confuse it with the `type:` field written into the pages[] array below.
   * "text" is a plain, unflagged text page (no monks-enhanced-journal
   * typing at all - same duality as campaign-record's "text" pseudo-type).
   * "session" is the companion's own JournalEntryPage subtype: the actual
   * native page type is SESSION_DOCUMENT_TYPE
   * (`${MODULE_ID}.session` - module.json's module-declared-subtype
   * registration; a bare "session" is rejected by
   * DocumentTypeField._validateType at create time, see constants.mjs's doc
   * comment), content into system.recap, and this module's own session
   * flags seeded from the parsed header (sessionNumber/campaignDate) - never
   * routed through the monks-enhanced-journal flag mechanism, since it isn't
   * an MEJ type (see sheets/SessionSheet.mjs). Every other type goes through
   * createMejEntry (data/mej-entry.mjs), the same helper auto-capture.mjs
   * uses for Encounters.
   */
  async #createPage(page, campaignDate) {
    if (page.type === "text") {
      const [entry] = await JournalEntry.create({
        name: page.name,
        pages: [{ name: page.name, type: "text", text: { content: page.html } }]
      });
      return entry.pages.contents[0];
    }
    if (page.type === "session") {
      const [entry] = await JournalEntry.create({
        name: page.name,
        pages: [{
          name: page.name,
          type: SESSION_DOCUMENT_TYPE,
          system: { recap: page.html, gmNotes: "" },
          flags: {
            [MODULE_ID]: {
              session: {
                sessionNumber: parseSessionNumber(page.name),
                campaignDate,
                attendees: [],
                secrets: []
              }
            }
          }
        }]
      });
      return entry.pages.contents[0];
    }
    return createMejEntry(page.type, page.name, page.html);
  }

  /**
   * Mirrors buildImportPlan's (doc-import.mjs) skip/merge control flow just
   * far enough to correlate each produced plan.pages[i] back to its origin
   * section's parsed date - buildImportPlan itself is a ported-verbatim pure
   * function shared with campaign-record and isn't touched to carry this
   * through directly.
   */
  #datesForPlanPages(rows) {
    const dates = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type === "skip" || rows[i].type === "merge") continue;
      dates.push(this.state.sections[i]?.date ?? null);
    }
    return dates;
  }

  // Spec deviation from campaign-record, per this port's task brief: dated
  // session-header rows here DO get a campaign-date-stamped timepoint
  // (campaign-record's own wizard always passes null for campaignDate, even
  // though its addTimepoint supports one - see isoDateToCampaignComponents's
  // doc comment above for the approximation this relies on, and
  // safeCampaignDate's for the bounds check that guards it).
  //
  // Per-section failures are collected rather than aborting the loop -
  // documents are only ever created after this confirm step, so there is no
  // partial state to roll back; a failed row simply doesn't get a page.
  //
  // Every timeline mutation (addTimepoint + addLink) is routed through
  // logic/filing-queue.mjs's shared queueFiling(), the same queue
  // hooks/auto-capture.mjs uses - both write the singleton timeline
  // journal's whole timepoints array read-modify-write style, so a combat
  // ending or a Show-Players share firing mid-import would otherwise race
  // this loop's own writes. queueFiling() catches and logs its task's
  // errors internally rather than rejecting (so one failure can't poison
  // later queued tasks from other subsystems - see its header comment), so
  // this loop's own task closes over a local `filingError` to still learn
  // whether ITS filing failed, and re-throws it into this row's own
  // try/catch below.
  static async #onCreate(event, target) {
    const rows = this.#formRows();
    let plan;
    try {
      plan = buildImportPlan(this.state.sections, rows, COMPANION_IMPORT_TYPES);
    } catch (error) {
      console.error(`${MODULE_ID} | import plan failed`, error);
      return ui.notifications.error(game.i18n.localize(`${I18N}.import.parseError`));
    }
    if (!plan.pages.length) {
      return ui.notifications.warn(game.i18n.localize(`${I18N}.import.nothingToImport`));
    }

    target.disabled = true;
    const dates = this.#datesForPlanPages(rows);
    const results = { created: 0, timepoints: 0, failed: [] };
    try {
      // Upload inline images once each (deduped across the whole document).
      const uploadedByUri = new Map();
      for (const page of plan.pages) {
        const { html } = await uploadInlineImages(page.html, plan.warnings, uploadedByUri);
        page.html = html;
      }

      let timeline = null;
      for (let i = 0; i < plan.pages.length; i++) {
        const page = plan.pages[i];
        const campaignDate = safeCampaignDate(dates[i], page.name, plan.warnings);
        try {
          const created = await this.#createPage(page, campaignDate);
          results.created++;
          if (page.timepoint) {
            timeline ??= await ensureTimelineJournal();
            if (timeline) {
              let filingError = null;
              await queueFiling(async () => {
                try {
                  const tp = await Timepoints.addTimepoint(timeline, page.timepoint, null, campaignDate);
                  await Timepoints.addLink(timeline, tp.id, { uuid: created.uuid, name: created.name, type: "JournalEntryPage" });
                } catch (err) {
                  filingError = err;
                }
              });
              if (filingError) throw filingError;
              results.timepoints++;
            }
          }
        } catch (error) {
          console.error(`${MODULE_ID} | import failed for section "${page.name}"`, error);
          results.failed.push(page.name);
        }
      }
    } finally {
      target.disabled = false;
    }

    this.close();
    await ImportWizard.#showResult(results, plan.warnings);
  }

  static async #showResult(results, warnings) {
    const esc = foundry.utils.escapeHTML;
    const parts = [`<p>${game.i18n.format(`${I18N}.import.created`, {
      pages: results.created, timepoints: results.timepoints
    })}</p>`];
    if (results.failed.length) {
      parts.push(`<p>${game.i18n.localize(`${I18N}.import.someFailed`)}</p>`
        + `<ul>${results.failed.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
    }
    if (warnings.length) {
      parts.push(`<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`);
    }
    await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(`${I18N}.import.resultTitle`) },
      content: parts.join(""),
      buttons: [{ action: "ok", label: `${I18N}.import.ok`, default: true }],
      rejectClose: false
    });
  }
}
