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
import {
  MODULE_ID, I18N, COMPANION_IMPORT_TYPES, AUTO_LINK_SETTING, PLAYERS_WRITE_SESSIONS_SETTING,
  HUB_CAMPAIGN_SCOPE_SETTING
} from "../constants.mjs";
import { campaignOfFolder, destinationFolderOptions, resolveDestinationId } from "../logic/campaigns.mjs";
import { splitSections, suggestType, buildImportPlan, mergeSections, splitSectionAt } from "../logic/doc-import.mjs";
import { buildSessionPageData } from "../logic/session-page-data.mjs";
import { loadVendorGlobal } from "../integrations/vendor-loader.mjs";
import { uploadInlineImages } from "./import-upload.mjs";
import { createMejEntry } from "../data/mej-entry.mjs";
import { ensureTimelineJournal } from "../data/timeline-journal.mjs";
import { getCampaigns, createCampaign, baselineOwnership } from "../data/campaign-store.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { queueFiling } from "../logic/filing-queue.mjs";
import { validateCampaignComponents } from "../logic/campaign-date.mjs";
import { calendarBounds } from "../logic/campaign-calendar.mjs";
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { countEntityLinks } from "../logic/retro-link.mjs";
import { dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceViewerIdsForImport, filterCandidatesForAudience } from "../logic/link-audience.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

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

  // destination/subfolder/audience default to "unset" (null / true / "default")
  // and get resolved against the live campaign list / a sensible fallback
  // inside #destinationOptions / #audienceOptions each render - see those
  // methods' doc comments for why. Once the GM actually touches one of
  // those three review-form controls, the change listener wired up in
  // _onRender writes the real value in here, so a mergeUp/splitSection
  // re-render (or any other future re-render) reconstructs the form with
  // whatever the GM last chose instead of silently resetting to the
  // first-in-DOM-order default (the bug this fixes: a GM who picks a
  // campaign then merges/splits a row was getting silently routed back to
  // whatever campaign happened to render first).
  state = {
    step: "source", docTitle: null, sections: [], rows: [],
    destination: null, subfolder: true, audience: "default"
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isSource = this.state.step === "source";
    context.isReview = this.state.step === "review";
    context.docTitle = this.state.docTitle;
    context.destinationOptions = this.#destinationOptions(this.state.destination);
    context.subfolder = this.state.subfolder;
    context.audienceOptions = this.#audienceOptions(this.state.audience);
    context.sessionsDetected = this.state.sections.filter((s) => s.isSession).length;
    context.rows = this.state.rows.map((row, index) => ({
      ...row, index,
      canMergeUp: index > 0,
      canSplit: (this.state.sections[index]?.blocks?.length ?? 0) > 1,
      typeOptions: this.#typeOptions(row.type)
    }));
    return context;
  }

  // Explicit presentation order (spec A §2): prose first, session next, then
  // the typed sheets roughly by how often docx sections map to them, Skip
  // last. Every entry is in COMPANION_IMPORT_TYPES; the retired "text"
  // pseudo-type is gone — journalentry ("Text and Image") IS the prose type.
  static #TYPE_ORDER = [
    "journalentry", "session", "person", "place", "organization", "quest",
    "encounter", "event", "poi", "shop", "loot", "list"
  ];

  #typeOptions(selected) {
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    const options = [
      ...ImportWizard.#TYPE_ORDER.map((t) => ({
        value: t,
        label: t === "session"
          ? game.i18n.localize(`${I18N}.sheettype.session`)
          : game.i18n.localize(labels[t] ?? t)
      })),
      { value: "skip", label: game.i18n.localize(`${I18N}.import.typeSkip`) }
    ];
    return options.map((o) => ({ ...o, selected: o.value === selected }));
  }

  /**
   * Destination `<select>` options: every campaign folder AND its descendant
   * subfolders (indented per depth via non-breaking spaces - the template
   * escapes labels, so markup indentation isn't an option), plus a trailing
   * "New Campaign…" (`__new`) sentinel. `selectedId` is `this.state.
   * destination`, which starts out null (no explicit GM choice yet); when
   * null, or when it names a folder that's since disappeared, this falls
   * back to the Hub's currently scoped campaign (the same client setting the
   * Hub picker persists) and only then to the first option - so an import
   * started while working in a campaign defaults into that campaign.
   */
  #destinationOptions(selectedId) {
    const folders = game.folders.filter((f) => f.type === "JournalEntry");
    const rows = destinationFolderOptions(getCampaigns(), folders);
    const options = [
      ...rows.map((r) => ({ value: r.id, label: `${"\u00A0\u00A0\u00A0".repeat(r.depth)}${r.name}` })),
      { value: "__new", label: game.i18n.localize(`${I18N}.import.destinationNew`) }
    ];
    const active = game.settings.get(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING);
    const resolved = resolveDestinationId(options.map((o) => o.value), selectedId, active) ?? "__new";
    return options.map((o) => ({ ...o, selected: o.value === resolved }));
  }

  /** Audience `<select>` options ("default" | "gm" | "players"), `selected` flag per this.state.audience. */
  #audienceOptions(selected) {
    const options = [
      { value: "default", label: game.i18n.localize(`${I18N}.import.audienceDefault`) },
      { value: "gm", label: game.i18n.localize(`${I18N}.import.audienceGm`) },
      { value: "players", label: game.i18n.localize(`${I18N}.import.audiencePlayers`) }
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
    // Mirror destination/subfolder/audience into this.state as the GM picks
    // them, so a mergeUp/splitSection re-render (see those handlers below)
    // reconstructs the form from the GM's actual choice via #destinationOptions
    // / #audienceOptions above, instead of silently reverting to the
    // first-in-DOM-order default.
    const form = this.element.querySelector("form.mej-cc-import-review");
    if (form) {
      form.elements.destination?.addEventListener("change", () => {
        this.state.destination = form.elements.destination.value;
      });
      form.elements.subfolder?.addEventListener("change", () => {
        this.state.subfolder = form.elements.subfolder.checked;
      });
      form.elements.audience?.addEventListener("change", () => {
        this.state.audience = form.elements.audience.value;
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

  /** "default" (campaign baseline) | "gm" | "players". */
  #formAudience() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    const v = form?.elements.audience?.value;
    return v === "players" || v === "gm" ? v : "default";
  }

  /** { folderId: string|"__new", subfolder: boolean } - folderId may be a campaign folder or a subfolder inside one. */
  #formDestination() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    return {
      folderId: form?.elements.destination?.value ?? "__new",
      subfolder: form?.elements.subfolder?.checked !== false
    };
  }

  /**
   * Import-time link candidates, bounded by containment against the chosen
   * audience (spec: links are validated against the audience the created
   * entries will actually have). Ambiguous names are dropped and reported
   * into the wizard's warnings list (shown in the result dialog).
   */
  #linkCandidates(audience, warnings) {
    const users = game.users.contents;
    const audienceViewers = audienceViewerIdsForImport(audience, users);
    const all = game.journal
      .filter((e) => mejType(e))
      .map((e) => ({ name: e.name, uuid: e.uuid, viewerIds: viewerIds(e, users, isVisibleToUser) }));
    const contained = filterCandidatesForAudience(all, audienceViewers)
      .filter((c) => (c.name?.trim().length ?? 0) >= 3)
      .map((c) => ({ name: c.name, uuid: c.uuid }))
      .sort((a, b) => b.name.length - a.name.length);
    const { kept, ambiguousNames } = dropAmbiguousNames(contained);
    for (const n of ambiguousNames) {
      warnings.push(game.i18n.format(`${I18N}.import.ambiguousSkipped`, { name: n }));
    }
    return kept;
  }

  static #onCancel() {
    this.close();
  }

  static #onBackToSource() {
    this.state = {
      step: "source", docTitle: null, sections: [], rows: [],
      destination: null, subfolder: true, audience: "default"
    };
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
   * wizard's OWN plan-row type ("session"/every COMPANION_IMPORT_TYPES
   * entry - see doc-import.mjs), not a Foundry document type - do not
   * confuse it with the `type:` field written into the pages[] array below.
   * The retired "text" pseudo-type never reaches here — buildImportPlan
   * normalizes it to "journalentry" (logic/doc-import.mjs), which the
   * generic createMejEntry tail below handles.
   * "session" is the companion's own JournalEntryPage subtype - the actual
   * page payload shape (native SESSION_DOCUMENT_TYPE, session flags, AND the
   * MEJ interop flag search/Hub/auto-link need to see it) is owned by
   * logic/session-page-data.mjs's buildSessionPageData(), which is pure and
   * unit-tested - see its own doc comment for the full citation trail on
   * why both the prefixed native type and the MEJ flag are required. Every
   * other type goes through createMejEntry (data/mej-entry.mjs), the same
   * helper auto-capture.mjs uses for Encounters.
   *
   * `folderId` (the destination resolved in #onCreate - the chosen/created
   * campaign, or a subfolder inside it) is threaded into whichever of the
   * two JournalEntry.create payloads below actually runs; null/undefined
   * leaves the entry unfiled, same as `ownership`'s null case above it.
   */
  async #createPage(page, campaignDate, ownership, folderId) {
    // JournalEntry.create() returns the created document directly (not an
    // array) for a single plain-object `data` argument - an array result
    // only happens when `data` itself is an array. The "session" branch below
    // destructured it as `const [entry] = await JournalEntry.create({...})`,
    // which tried to iterate the returned Document; confirmed live via
    // Task 14's e2e suite this threw "TypeError: (intermediate value) is
    // not iterable" on every real call (caught by #onCreate's per-row
    // try/catch, so it silently landed every "session" section in
    // results.failed instead of actually creating anything) - the same bug
    // class already found and fixed in data/mej-entry.mjs's createMejEntry.
    if (page.type === "session") {
      const entry = await JournalEntry.create({
        name: page.name,
        ...(ownership ? { ownership } : {}),
        ...(folderId ? { folder: folderId } : {}),
        pages: [buildSessionPageData(page.name, page.html, campaignDate, parseSessionNumber(page.name))]
      });
      return entry.pages.contents[0];
    }
    return createMejEntry(page.type, page.name, page.html, {}, ownership, folderId);
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

    // Disabled up front, not just around the create loop further down: the
    // destination resolution immediately below is itself a single-shot side
    // effect (it can create a campaign Folder and, with "subfolder" checked,
    // a second Folder inside it) - a second click landing mid-await here
    // would otherwise create duplicate campaigns/subfolders rather than
    // just duplicate pages.
    target.disabled = true;

    let campaign, targetFolderId;
    try {
      const dest = this.#formDestination();
      // The chosen option may be a campaign folder or a subfolder inside one
      // (see #destinationOptions); the governing campaign - which decides the
      // timeline journal and the "Campaign default" audience baseline below -
      // is the nearest flagged ancestor. A stale/non-campaign pick (folder
      // deleted or re-parented mid-wizard) degrades to the "__new" path
      // rather than filing entries outside any campaign.
      let chosen = dest.folderId !== "__new" ? game.folders.get(dest.folderId) ?? null : null;
      campaign = campaignOfFolder(chosen);
      if (!campaign) {
        chosen = null;
        campaign = await createCampaign(this.state.docTitle || game.i18n.localize(`${I18N}.import.title`));
      }
      if (!campaign) throw new Error("createCampaign returned null (not GM?)");
      targetFolderId = chosen?.id ?? campaign.id;
      if (dest.subfolder) {
        const sub = await Folder.create({ name: this.state.docTitle || campaign.name, type: "JournalEntry", folder: targetFolderId });
        targetFolderId = sub.id;
      }
    } catch (error) {
      console.error(`${MODULE_ID} | import destination setup failed`, error);
      target.disabled = false;
      return ui.notifications.error(game.i18n.localize(`${I18N}.import.destinationError`));
    }

    const audience = this.#formAudience();
    const ownership =
      audience === "players" ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      : audience === "default" && campaign ? { default: baselineOwnership(campaign) }
      : null;  // "gm", or "default" with no campaign -> Foundry default (GM-only)
    // Import-time auto-link (spec Part 2): same engine as the typing path,
    // empty baseline = whole document eligible. Gated on the same autoLink
    // world setting; failure never blocks the import (observer posture).
    //
    // Per-row effective audience: campaign-companion.mjs's own
    // preCreateJournalEntry hook (via shouldOwnSessionEntry,
    // logic/session-ownership.mjs) grants "session" rows default-OWNER
    // (player-visible) ownership whenever the playersWriteSessions world
    // setting is ON, regardless of the audience chosen here - silently
    // overriding a "GM only" import for those rows. Link "session" rows
    // against "players"-audience candidates in that case so a GM-only
    // import with playersWriteSessions ON can't produce a player-visible
    // page linking to GM-only entities; every other row keeps the chosen
    // audience's candidates.
    let linkedCount = 0;
    const linkAudience = audience === "default"
      ? (campaign && baselineOwnership(campaign) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ? "players" : "gm")
      : audience;
    if (game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) {
      try {
        const candidates = this.#linkCandidates(linkAudience, plan.warnings);
        const playersWriteSessions = game.settings.get(MODULE_ID, PLAYERS_WRITE_SESSIONS_SETTING);
        const seenWarnings = new Set(plan.warnings);
        let sessionCandidates = null;
        const candidatesForPage = (page) => {
          if (!playersWriteSessions || page.type !== "session") return candidates;
          if (sessionCandidates === null) {
            const scratch = [];
            sessionCandidates = this.#linkCandidates("players", scratch);
            for (const w of scratch) {
              if (seenWarnings.has(w)) continue;
              seenWarnings.add(w);
              plan.warnings.push(w);
            }
          }
          return sessionCandidates;
        };
        for (const page of plan.pages) {
          const rowCandidates = candidatesForPage(page);
          if (!rowCandidates.length) continue;
          const linked = autoLinkAdded("", page.html, rowCandidates);
          if (linked !== page.html) {
            linkedCount += rowCandidates.reduce(
              (n, c) => n + countEntityLinks(linked, c.uuid) - countEntityLinks(page.html, c.uuid), 0);
            page.html = linked;
          }
        }
      } catch (error) {
        console.error(`${MODULE_ID} | import auto-link failed`, error);
      }
    }

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
          const created = await this.#createPage(page, campaignDate, ownership, targetFolderId);
          results.created++;
          if (page.timepoint) {
            // Spec D: this resolves the campaign's DEFAULT timeline; auto-filing
            // never prompts and never follows the Hub's currently-viewed one.
            timeline ??= await ensureTimelineJournal(campaign);
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
    } catch (error) {
      // Defence in depth for the failure mode C3 fixed at its source: this
      // block used to carry only a `finally`, so anything thrown outside the
      // per-row try above (the inline-image pass was the real case) escaped
      // #onCreate entirely - skipping this.close() and #showResult below, so
      // the GM saw no error and no result at all while documents had already
      // been created. Report what did happen rather than vanishing.
      console.error(`${MODULE_ID} | import aborted partway through`, error);
      plan.warnings.push(game.i18n.localize(`${I18N}.import.abortedPartway`));
    } finally {
      target.disabled = false;
    }

    this.close();
    await ImportWizard.#showResult(results, plan.warnings, linkedCount);
  }

  static async #showResult(results, warnings, linkedCount = 0) {
    const esc = foundry.utils.escapeHTML;
    const parts = [`<p>${game.i18n.format(`${I18N}.import.created`, {
      pages: results.created, timepoints: results.timepoints
    })}</p>`];
    if (linkedCount) {
      parts.push(`<p>${game.i18n.format(`${I18N}.import.linked`, { count: linkedCount })}</p>`);
    }
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
