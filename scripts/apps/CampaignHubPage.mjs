// CampaignHubPage - registered as a shell page (api.registerShellPage, see
// API.md) rather than a JournalEntryPage sheet type. Unlike SessionSheet its
// `document` is MEJ's ephemeral BlankJournal placeholder, not a real,
// persisted document - all Hub UI state (filters, sort, timeline order, open
// menus) lives on the module-level HUB_STATE object below (read/written via
// the `this.state` getter - see its comment for why it isn't an instance
// field), and CRUD writes go through Task 6's timepoints.mjs against the
// world's singleton timeline JournalEntry.
//
// Same rendering caveats as SessionSheet.mjs: the shell calls
// _replaceHTML/activateListeners()/subRender() directly, never _onRender(),
// and (per API.md's shell-page limitations) shell pages get no per-type
// theming and no subsheet part-state preservation - style via
// styles/campaign-companion.css under .mej-cc-hub, and don't rely on
// _syncPartState.
import { EnhancedJournalSheet } from "/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js";
import { MODULE_ID, HUB_PAGE_ID, I18N } from "../constants.mjs";
import { getTimelineJournal, ensureTimelineJournal } from "../data/timeline-journal.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { classifyDropData, filenameFromSrc } from "../logic/timeline-links.mjs";
import { getCalendarMonths, calendarBounds, hasCalendar, formatCampaignDate, currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { parseCampaignDateInput, formatCreateDate } from "../logic/campaign-date.mjs";
import { buildDoctypeFilter } from "../logic/doctype-filter.mjs";
import { buildSortMenu } from "../logic/sort-menu.mjs";
import { buildIndexSource, filterIndexRows } from "../logic/hub-index.mjs";
import { buildTimelineRows, buildOrderOptions } from "../logic/hub-timeline.mjs";
import { searchAll } from "../search/live-index.mjs";
import { ImportWizard } from "./import-wizard.mjs";

const REORDER_KIND = `${MODULE_ID}.timepoint`;

// Module-level UI state (filters, sort, timeline order, open menus, and a
// one-shot flag for restoring the index-filter input's focus/caret after a
// re-render). The Hub has no backing document to key state off of, and
// MEJ's shell decides whether to reconstruct the subsheet instance by
// comparing `this.subsheet.type != this.document.type`
// (apps/enhanced-journal.js's renderSubSheet) - an INSTANCE read. The
// `get type()` override below makes that comparison work so the instance
// normally survives renders, but hoisting state up here means it survives
// even if the shell reconstructs the instance for some other reason.
// Single Hub instance is assumed - MEJ only ever mounts one shell page per
// id inside its own tab, so this isn't shared across concurrent Hubs.
const HUB_STATE = {
  types: new Set(),
  query: "",
  sort: "name",
  typeMenuOpen: false,
  sortMenuOpen: false,
  timelineOrder: "manual",
  restoreIndexFilterFocus: false,
  searchQuery: "",
  restoreSearchFocus: false
};

export class CampaignHubPage extends EnhancedJournalSheet {
  static DEFAULT_OPTIONS = {
    window: {
      title: `${I18N}.hub.title`,
      icon: "fa-solid fa-timeline"
    },
    actions: {
      openIndexRow: CampaignHubPage.onOpenIndexRow,
      toggleTypeMenu: CampaignHubPage.onToggleTypeMenu,
      toggleSortMenu: CampaignHubPage.onToggleSortMenu,
      setTimelineOrder: CampaignHubPage.onSetTimelineOrder,
      addTimepoint: CampaignHubPage.onAddTimepoint,
      renameTimepoint: CampaignHubPage.onRenameTimepoint,
      deleteTimepoint: CampaignHubPage.onDeleteTimepoint,
      openLink: CampaignHubPage.onOpenLink,
      removeLink: CampaignHubPage.onRemoveLink,
      toggleLinkShowPlayers: CampaignHubPage.onToggleLinkShowPlayers,
      openImportWizard: CampaignHubPage.onOpenImportWizard
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/hub.hbs`,
      templates: ["templates/generic/tab-navigation.hbs"],
      scrollable: [".mej-cc-index-list", ".mej-cc-timeline-list", ".mej-cc-search-list"]
    }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "index", icon: "fa-solid fa-list" },
        { id: "timeline", icon: "fa-solid fa-timeline" },
        { id: "search", icon: "fa-solid fa-magnifying-glass" }
      ],
      initial: "index",
      labelPrefix: `${I18N}.hub.tabs`
    }
  };

  static get type() {
    return HUB_PAGE_ID;
  }

  // Instance mirror of the static getter above. MEJ's shell (renderSubSheet,
  // apps/enhanced-journal.js) decides whether to reuse or reconstruct the
  // mounted subsheet by comparing `this.subsheet.type != this.document.type`
  // - an INSTANCE property read. No MEJ sheet class defines one (only
  // `static get type()`), so without this override it reads `undefined` and
  // the shell reconstructs a fresh instance on every render. That's mostly
  // harmless now that UI state lives on module-level HUB_STATE rather than
  // an instance field, but a fresh instance still means losing anything
  // instance-scoped (event-listener dedupe flags, etc.), so fix the
  // comparison itself rather than relying solely on the state hoist.
  get type() {
    return this.constructor.type;
  }

  static get defaultObject() {
    return {};
  }

  get canPlaySound() {
    return false;
  }

  // Client-only UI state (filters, sort, open menus, timeline order) -
  // module-level HUB_STATE (see above), not an instance field, so it
  // survives subsheet reconstruction by the shell.
  get state() {
    return HUB_STATE;
  }

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);
    const isGM = game.user.isGM;
    context.isGM = isGM;

    // Lazily create the world's singleton timeline journal on first GM hub
    // open (per Task 6/7). getTimelineJournal() alone covers players, and
    // covers a GM once it already exists - ensureTimelineJournal() only
    // writes when it doesn't.
    const journal = isGM ? await ensureTimelineJournal() : getTimelineJournal();

    context.index = this.#indexContext();
    context.timeline = this.#timelineContext(journal, isGM);
    context.search = this.#searchContext();

    return context;
  }

  #typeLabel(type) {
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    return labels[type] ? game.i18n.localize(labels[type]) : type;
  }

  #typeIcon(type) {
    return `fas ${game.MonksEnhancedJournal.getIcon(type)}`;
  }

  #indexContext() {
    const source = buildIndexSource(game.journal.contents, game.user, game.MonksEnhancedJournal.getMEJType, this.#typeIcon.bind(this));
    const rows = filterIndexRows(source, this.state, this.#typeLabel.bind(this));
    const allTypes = [...new Set(source.map((r) => r.type))].sort((a, b) => this.#typeLabel(a).localeCompare(this.#typeLabel(b)));
    return {
      rows,
      total: source.length,
      query: this.state.query,
      typeMenuOpen: this.state.typeMenuOpen,
      sortMenuOpen: this.state.sortMenuOpen,
      doctypeFilter: buildDoctypeFilter(allTypes, this.state.types, this.#typeLabel.bind(this), this.#typeIcon.bind(this), game.i18n.localize(`${I18N}.hub.allTypes`)),
      sortMenu: buildSortMenu(this.state.sort, (k) => game.i18n.localize(`${I18N}.hub.sort.${k}`))
    };
  }

  #fieldLabel(field) {
    const key = `${I18N}.hub.search.fields.${field}`;
    const localized = game.i18n.localize(key);
    return localized === key ? field : localized;
  }

  // live-index.mjs's searchAll() already GM/player-filters both the field
  // set (search-index.mjs's `gm` option) and the result set itself
  // (testUserPermission LIMITED on the resolved entry) - this just shapes
  // the hits for the template (type icon/label, localized field names).
  #searchContext() {
    const results = searchAll(this.state.searchQuery).map((hit) => ({
      uuid: hit.uuid,
      name: hit.name,
      icon: this.#typeIcon(hit.type),
      typeLabel: this.#typeLabel(hit.type),
      matches: hit.matches.map((m) => ({ fieldLabel: this.#fieldLabel(m.field), snippet: m.snippet }))
    }));
    return {
      query: this.state.searchQuery,
      hasQuery: this.state.searchQuery.trim().length > 0,
      results
    };
  }

  #timelineContext(journal, isGM) {
    if (!journal) {
      // Players before a GM has ever opened the hub: no timeline journal
      // exists yet. Render an explicit empty state rather than erroring.
      return { hasJournal: false, rows: [], order: this.state.timelineOrder, orderOptions: [], canEdit: false };
    }
    const canEdit = isGM;
    const order = this.state.timelineOrder;
    const timepoints = Timepoints.getTimepoints(journal);
    const rows = buildTimelineRows(timepoints, order, {
      canEdit,
      formatDate: (tp) => (order === "campaign" ? formatCampaignDate(tp.campaignDate) : formatCreateDate(tp.createdAt)),
      resolveRowLinks: (tp) =>
        Timepoints.resolveLinks(tp, game.user).map((entry) => ({
          ...entry,
          broken: entry.kind === "broken",
          thumb: entry.img || null,
          canToggleVisibility: canEdit && entry.kind === "image"
        }))
    });
    return {
      hasJournal: true,
      rows,
      order,
      showDateColumn: order !== "manual",
      orderOptions: buildOrderOptions(order, (m) => game.i18n.localize(`${I18N}.hub.order.${m}`)),
      canEdit
    };
  }

  // GM-only "Import Document" entry point (Task 11) - lives on the Index
  // tab's toolbar, next to the type filter/sort controls (see hub.hbs). The
  // action itself is registered regardless of GM status (Foundry always
  // wires data-action handlers); the button is only rendered for a GM
  // (context.isGM, set in _prepareBodyContext above), and ImportWizard.open()
  // re-checks game.user.isGM itself as a second guard.
  static onOpenImportWizard() {
    ImportWizard.open();
  }

  static onOpenIndexRow(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    fromUuid(uuid).then((entry) => {
      if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
    });
  }

  static onToggleTypeMenu() {
    this.state.typeMenuOpen = !this.state.typeMenuOpen;
    this.state.sortMenuOpen = false;
    this.render({ parts: ["main"] });
  }

  static onToggleSortMenu() {
    this.state.sortMenuOpen = !this.state.sortMenuOpen;
    this.state.typeMenuOpen = false;
    this.render({ parts: ["main"] });
  }

  static async onSetTimelineOrder(event, target) {
    const order = target.dataset.order;
    if (!["manual", "created", "campaign"].includes(order)) return;
    this.state.timelineOrder = order;
    this.render({ parts: ["main"] });
  }

  // Timepoint label + optional campaign-date prompt. Mirrors campaign-record's
  // hub-mixin #promptTimepoint (see mej-campaign-companion's task-7 reference).
  static async #promptTimepoint(initial = {}, { titleKey, okKey = `${I18N}.hub.create` } = {}) {
    const label = initial.label ?? "";
    const cd = initial.campaignDate ?? null;
    const months = getCalendarMonths();
    const bounds = calendarBounds();
    const esc = foundry.utils.escapeHTML;

    const monthOptions = months
      .map((m) => `<option value="${m.index}"${cd && cd.month === m.index ? " selected" : ""}>${esc(m.name)}</option>`)
      .join("");
    const timeValue = cd && cd.hour != null ? `${String(cd.hour).padStart(2, "0")}:${String(cd.minute ?? 0).padStart(2, "0")}` : "";

    const dateFields = hasCalendar()
      ? `<fieldset class="mej-cc-campaign-date">
          <legend>${game.i18n.localize(`${I18N}.hub.campaignDate`)}</legend>
          <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.campaignYear`)}</label>
            <input type="number" name="year" value="${cd ? cd.year : ""}" step="1"></div>
          <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.campaignMonth`)}</label>
            <select name="month"><option value="">—</option>${monthOptions}</select></div>
          <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.campaignDay`)}</label>
            <input type="number" name="day" value="${cd ? cd.day : ""}" min="1" step="1"></div>
          <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.campaignTime`)}</label>
            <input type="text" name="time" value="${esc(timeValue)}" placeholder="HH:MM"></div>
        </fieldset>`
      : `<p class="notes">${game.i18n.localize(`${I18N}.hub.campaignDateUnavailable`)}</p>`;

    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `<div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.timepointLabel`)}</label>
          <input type="text" name="label" value="${esc(label)}" required autofocus></div>${dateFields}`,
      ok: {
        label: okKey,
        callback: (event, button) => {
          const form = button.form.elements;
          const newLabel = form.label.value.trim();
          if (!newLabel) return null;
          if (!hasCalendar()) return { label: newLabel, campaignDate: undefined };
          const { components, error } = parseCampaignDateInput(
            { year: form.year.value, month: form.month.value, day: form.day.value, time: form.time.value },
            bounds
          );
          if (error) {
            ui.notifications.warn(game.i18n.localize(error));
            return null;
          }
          return { label: newLabel, campaignDate: components };
        }
      },
      rejectClose: false
    });
  }

  static async onAddTimepoint(event, target) {
    if (!game.user.isGM) return;
    const journal = await ensureTimelineJournal();
    if (!journal) return;
    const raw = Number(target.dataset.position);
    const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;
    const result = await CampaignHubPage.#promptTimepoint(
      { campaignDate: currentWorldComponents() },
      { titleKey: `${I18N}.hub.addTimepoint` }
    );
    if (!result) return;
    await Timepoints.addTimepoint(journal, result.label, position, result.campaignDate ?? null);
    this.render({ parts: ["main"] });
  }

  static async onRenameTimepoint(event, target) {
    if (!game.user.isGM) return;
    const journal = getTimelineJournal();
    if (!journal) return;
    const id = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const current = Timepoints.getTimepoints(journal).find((t) => t.id === id);
    if (!current) return;
    const result = await CampaignHubPage.#promptTimepoint(
      { label: current.label, campaignDate: current.campaignDate ?? null },
      { titleKey: `${I18N}.hub.editTimepoint`, okKey: `${I18N}.hub.save` }
    );
    if (!result) return;
    await Timepoints.editTimepoint(journal, id, { label: result.label, campaignDate: result.campaignDate });
    this.render({ parts: ["main"] });
  }

  static async onDeleteTimepoint(event, target) {
    if (!game.user.isGM) return;
    const journal = getTimelineJournal();
    if (!journal) return;
    const id = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const label = Timepoints.getTimepoints(journal).find((t) => t.id === id)?.label ?? "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.hub.deleteTimepoint`) },
      content: `<p>${game.i18n.format(`${I18N}.hub.deleteTimepointConfirm`, { label: foundry.utils.escapeHTML(label) })}</p>`
    });
    if (!confirmed) return;
    await Timepoints.deleteTimepoint(journal, id);
    this.render({ parts: ["main"] });
  }

  static async onOpenLink(event, target) {
    const chip = target.closest("[data-link-id]");
    const { uuid, src, name } = chip.dataset;
    if (src) {
      return new foundry.applications.apps.ImagePopout({ src, window: { title: name } }).render(true);
    }
    const doc = await fromUuid(uuid);
    if (!doc) return ui.notifications.warn(game.i18n.localize(`${I18N}.hub.brokenLink`));
    if (doc.documentName === "JournalEntry" || doc.documentName === "JournalEntryPage") {
      return game.MonksEnhancedJournal.openJournalEntry(doc);
    }
    doc.sheet?.render(true);
  }

  static async onRemoveLink(event, target) {
    if (!game.user.isGM) return;
    const journal = getTimelineJournal();
    if (!journal) return;
    const timepointId = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const linkId = target.closest("[data-link-id]")?.dataset.linkId;
    await Timepoints.removeLink(journal, timepointId, linkId);
    this.render({ parts: ["main"] });
  }

  static async onToggleLinkShowPlayers(event, target) {
    if (!game.user.isGM) return;
    const journal = getTimelineJournal();
    if (!journal) return;
    const timepointId = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const linkId = target.closest("[data-link-id]")?.dataset.linkId;
    await Timepoints.toggleLinkShowPlayers(journal, timepointId, linkId);
    this.render({ parts: ["main"] });
  }

  _canDragDrop() {
    return game.user.isGM;
  }

  _dragDrop(html) {
    super._dragDrop(html);

    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: "[data-drag-timepoint]",
      dropSelector: "[data-drop-timepoint]",
      permissions: {
        dragstart: () => game.user.isGM,
        drop: () => game.user.isGM
      },
      callbacks: {
        dragstart: this.#onTimepointDragStart.bind(this),
        drop: this.#onTimepointDrop.bind(this)
      }
    }).bind(html);
  }

  #onTimepointDragStart(event) {
    const row = event.target.closest("[data-drag-timepoint]");
    if (!row) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({ kind: REORDER_KIND, id: row.dataset.timepointId }));
  }

  async #onTimepointDrop(event) {
    if (!game.user.isGM) return;
    const target = event.target.closest("[data-drop-timepoint]");
    if (!target) return;
    const journal = getTimelineJournal();
    if (!journal) return;

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain")) ?? {};
    } catch {
      data = {};
    }

    if (data.kind === REORDER_KIND) {
      return Timepoints.moveTimepoint(journal, data.id, Number(target.dataset.position)).then(() => this.render({ parts: ["main"] }));
    }

    const timepointId = target.dataset.timepointId;
    const drop = classifyDropData(
      data,
      event.dataTransfer.getData("text/uri-list"),
      [...(event.dataTransfer?.files ?? [])]
    );
    if (drop?.kind === "files") {
      ui.notifications.warn(game.i18n.localize(`${I18N}.hub.dropFilesUnsupported`));
      return;
    }
    if (!drop) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.hub.cannotAttach`));
      return;
    }
    if (drop.kind === "document") {
      const doc = await fromUuid(drop.uuid);
      if (!doc) {
        ui.notifications.warn(game.i18n.localize(`${I18N}.hub.cannotAttach`));
        return;
      }
      await Timepoints.addLink(journal, timepointId, { uuid: drop.uuid, name: doc.name, type: drop.type });
      return this.render({ parts: ["main"] });
    }
    // drop.kind === "image"
    const showPlayers = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.hub.showImageToPlayers`) },
      content: `<p>${game.i18n.format(`${I18N}.hub.showImageToPlayersPrompt`, { name: foundry.utils.escapeHTML(filenameFromSrc(drop.src)) })}</p>`,
      rejectClose: false
    });
    if (showPlayers === null) return; // dialog dismissed
    await Timepoints.addLink(journal, timepointId, { src: drop.src, name: filenameFromSrc(drop.src), showPlayers: showPlayers === true });
    this.render({ parts: ["main"] });
  }

  async activateListeners(html) {
    await super.activateListeners(html);

    const typeMenu = html.querySelector(".mej-cc-doctype-menu");
    if (typeMenu && !typeMenu.dataset.ccBound) {
      typeMenu.dataset.ccBound = "1";
      typeMenu.addEventListener("change", (event) => {
        const cb = event.target.closest('input[name="doctype-check"]');
        if (!cb) return;
        if (cb.checked) this.state.types.add(cb.value);
        else this.state.types.delete(cb.value);
        this.render({ parts: ["main"] });
      });
    }

    const sortMenu = html.querySelector(".mej-cc-sort-menu");
    if (sortMenu && !sortMenu.dataset.ccBound) {
      sortMenu.dataset.ccBound = "1";
      sortMenu.addEventListener("change", (event) => {
        const radio = event.target.closest('input[name="sort-select"]');
        if (!radio) return;
        this.state.sort = radio.value;
        this.state.sortMenuOpen = false;
        this.render({ parts: ["main"] });
      });
    }

    const search = html.querySelector('input[name="index-filter"]');
    if (search) {
      // EnhancedJournalSheet#render has no return statement (it returns
      // undefined), and this.element is never assigned for a subsheet
      // hosted in the shell - both would make a `.then()`-chained
      // focus/caret restore throw. Restore from here instead: activateListeners
      // is handed the fresh `html` on every render (self-triggered or not),
      // so a one-shot flag on the module-level state is enough to know a
      // restore is due.
      if (HUB_STATE.restoreIndexFilterFocus) {
        HUB_STATE.restoreIndexFilterFocus = false;
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
      if (!search.dataset.ccBound) {
        search.dataset.ccBound = "1";
        search.addEventListener(
          "input",
          foundry.utils.debounce((event) => {
            HUB_STATE.query = event.target.value;
            HUB_STATE.restoreIndexFilterFocus = true;
            this.render({ parts: ["main"] });
          }, 250)
        );
      }
    }

    const searchInput = html.querySelector('input[name="search-query"]');
    if (searchInput) {
      // Same restore-focus-from-activateListeners pattern as the index
      // filter above (see its comment) - the search input re-renders on
      // every keystroke (debounced), so losing focus/caret each time would
      // make typing unusable.
      if (HUB_STATE.restoreSearchFocus) {
        HUB_STATE.restoreSearchFocus = false;
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
      if (!searchInput.dataset.ccBound) {
        searchInput.dataset.ccBound = "1";
        searchInput.addEventListener(
          "input",
          foundry.utils.debounce((event) => {
            HUB_STATE.searchQuery = event.target.value;
            HUB_STATE.restoreSearchFocus = true;
            this.render({ parts: ["main"] });
          }, 150)
        );
      }
    }
  }
}
