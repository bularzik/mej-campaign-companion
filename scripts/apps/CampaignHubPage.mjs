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
import { MODULE_ID, HUB_PAGE_ID, SAVED_QUERIES_SETTING, PLAYER_GROUPS_SETTING, HUB_CAMPAIGN_SCOPE_SETTING, CAMPAIGN_FLAG, CAMPAIGN_DOCUMENT_TYPE, I18N, guideUrl, AUTO_CAPTURE_CAMPAIGN_SETTING, ADOPTION_PROMPTED_SETTING, TIMELINE_JOURNAL_SETTING } from "../constants.mjs";
import { getTimelineJournal, ensureTimelineJournal, resolveTimelineJournal } from "../data/timeline-journal.mjs";
import { getCampaigns, campaignEntries, unfiledEntries, createCampaign, baselineOwnership, applyBaselineToMembers, setEntryHidden, campaignPortal, ensureCampaignPortal } from "../data/campaign-store.mjs";
import { campaignOf, campaignIdOf, isCampaignFolder, canAttachToTimeline, campaignFlagOf, adoptionPlan } from "../logic/campaigns.mjs";
import * as Timepoints from "../data/timepoints.mjs";
import { queueFiling } from "../logic/filing-queue.mjs";
import { classifyDropData, filenameFromSrc } from "../logic/timeline-links.mjs";
import { getCalendarMonths, calendarBounds, hasCalendar, formatCampaignDate, currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { parseCampaignDateInput, formatCreateDate } from "../logic/campaign-date.mjs";
import { buildDoctypeFilter } from "../logic/doctype-filter.mjs";
import { buildSessionPageData } from "../logic/session-page-data.mjs";
import { buildSortMenu } from "../logic/sort-menu.mjs";
import { buildIndexSource, filterIndexRows } from "../logic/hub-index.mjs";
import { buildTimelineRows, buildOrderOptions } from "../logic/hub-timeline.mjs";
import { searchScoped, mentionBadgeCounts, runQueryAll, gmSecretRecords } from "../search/live-index.mjs";
import { parseQuery } from "../logic/query-grammar.mjs";
import { filterTrackerRows } from "../logic/secrets-tracker.mjs";
import { normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups, upsertGroup, deleteGroup } from "../logic/player-groups.mjs";
import { visibleRelRows } from "../logic/rel-reveals.mjs";
import { sessionData } from "../sheets/session-data.mjs";
import { promptAudience, sendRevealWhisper } from "./audience-dialog.mjs";
import { ImportWizard } from "./import-wizard.mjs";
import { openExportDialog } from "./export-dialog.mjs";
import { mejType, openHub } from "../integrations/mej-adapter.mjs";
import { prepareGraphContext, drawGraphPane } from "./hub-graph-pane.mjs";

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
  toolsMenuOpen: false,
  timelineOrder: "manual",
  restoreIndexFilterFocus: false,
  searchQuery: "",
  restoreSearchFocus: false,
  secretsType: "",
  secretsState: "all",
  secretsPlayer: "",
  campaignId: null,
  graphMode: "all",
  graphCenterUuid: null,
  graphBacklinks: false,
  pendingTab: null
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
      toggleToolsMenu: CampaignHubPage.onToggleToolsMenu,
      setTimelineOrder: CampaignHubPage.onSetTimelineOrder,
      addTimepoint: CampaignHubPage.onAddTimepoint,
      renameTimepoint: CampaignHubPage.onRenameTimepoint,
      deleteTimepoint: CampaignHubPage.onDeleteTimepoint,
      openLink: CampaignHubPage.onOpenLink,
      removeLink: CampaignHubPage.onRemoveLink,
      toggleLinkShowPlayers: CampaignHubPage.onToggleLinkShowPlayers,
      newSession: CampaignHubPage.onNewSession,
      openImportWizard: CampaignHubPage.onOpenImportWizard,
      openExportDialog: CampaignHubPage.onOpenExportDialog,
      setGraphMode: CampaignHubPage.onSetGraphMode,
      openHelp: CampaignHubPage.onOpenHelp,
      addDashboard: CampaignHubPage.onAddDashboard,
      editDashboard: CampaignHubPage.onEditDashboard,
      deleteDashboard: CampaignHubPage.onDeleteDashboard,
      secretsSetFilter: CampaignHubPage.onSecretsSetFilter,
      trackerAudience: CampaignHubPage.onTrackerAudience,
      addGroup: CampaignHubPage.onAddGroup,
      editGroup: CampaignHubPage.onEditGroup,
      deleteGroup: CampaignHubPage.onDeleteGroup,
      searchAllCampaigns: CampaignHubPage.onSearchAllCampaigns,
      editCampaign: CampaignHubPage.onEditCampaign,
      toggleEntryHidden: CampaignHubPage.onToggleEntryHidden,
      setCaptureCampaign: CampaignHubPage.onSetCaptureCampaign,
      adoptWorld: CampaignHubPage.onAdoptWorld,
      dismissAdoption: CampaignHubPage.onDismissAdoption,
      fileIntoCampaign: CampaignHubPage.onFileIntoCampaign,
      fileAllShown: CampaignHubPage.onFileAllShown
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/hub.hbs`,
      templates: ["templates/generic/tab-navigation.hbs"],
      scrollable: [".mej-cc-index-list", ".mej-cc-timeline-list", ".mej-cc-search-list", ".mej-cc-dashboards-list", ".mej-cc-secrets-list"]
    }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "index", icon: "fa-solid fa-list" },
        { id: "timeline", icon: "fa-solid fa-timeline" },
        { id: "graph", icon: "fa-solid fa-circle-nodes" },
        { id: "search", icon: "fa-solid fa-magnifying-glass" },
        { id: "dashboards", icon: "fa-solid fa-table-columns" },
        { id: "secrets", icon: "fa-solid fa-user-secret" }
      ],
      initial: "index",
      labelPrefix: `${I18N}.hub.tabs`
    }
  };

  // Graph tab's computed nodes/edges for this render pass, set in
  // _prepareBodyContext and reused by activateListeners' draw call (same
  // "compute once, draw from the cached graph" pattern the popup used for
  // its truncated-notice/drawn-graph sync - see hub-graph-pane.mjs).
  #graphData = null;

  // Spec C §2: which portal document's mount already applied the one-time
  // campaign scope (see _prepareBodyContext below) - null until a portal
  // mount has happened.
  #portalScopedFor = null;

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

  // GM-only "secrets" tab (spec §7): players must not even see the tab
  // header. EnhancedJournalSheet._preparePartContext sets `context.subtabs`
  // AFTER calling _prepareBodyContext (it reads `this._prepareTabs("primary")`
  // itself, right after), so deleting the key from context inside
  // _prepareBodyContext would be a no-op - context.subtabs doesn't exist yet
  // at that point. Overriding _prepareTabs instead (same pattern the base
  // class already uses to drop its own "relationships" tab for non-GMs)
  // removes the tab entry before the tab-navigation partial ever sees it.
  _prepareTabs(group) {
    // A pending tab (showGraphFor) is consumed pre-render: setting the
    // group's active tab BEFORE super computes the tab contexts makes the
    // initial render come up on that tab natively - patching the DOM after
    // mount via changeTab() proved unreliable in shell-subsheet hosting
    // (state updated, DOM untouched; see task-5 report addendum).
    if (group === "primary" && this.state.pendingTab) {
      this.tabGroups.primary = this.state.pendingTab;
      this.state.pendingTab = null;
    }
    const tabs = super._prepareTabs(group);
    if (group === "primary" && !game.user.isGM) delete tabs.secrets;
    return tabs;
  }

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);
    const isGM = game.user.isGM;
    context.isGM = isGM;

    // Spec C §2: a portal mount scopes the Hub to its campaign - once per
    // mount, so the user can re-scope with the picker afterwards without
    // the portal fighting them. The shell's synthetic hub page and the
    // native window's synthetic document never have the campaign subtype,
    // so plain Hub opens are untouched.
    if (this.document?.type === CAMPAIGN_DOCUMENT_TYPE && this.#portalScopedFor !== this.document.uuid) {
      this.#portalScopedFor = this.document.uuid;
      const portalCampaign = campaignOf(this.document);
      if (portalCampaign) {
        this.state.campaignId = portalCampaign.id;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, portalCampaign.id);
      }
    }

    const { campaign, unfiled } = this.#scope();
    let stacks;
    if (unfiled) {
      stacks = [];
    } else if (campaign) {
      const journal = isGM ? await ensureTimelineJournal(campaign) : resolveTimelineJournal(campaign);
      stacks = [{ name: null, ...this.#timelineContext(journal, isGM) }];
    } else {
      const campaigns = getCampaigns();
      if (!campaigns.length) {
        // Pre-adoption world: legacy singleton behavior, unchanged.
        const journal = isGM ? await ensureTimelineJournal() : getTimelineJournal();
        stacks = [{ name: null, ...this.#timelineContext(journal, isGM) }];
      } else {
        // Spec §2: All mode stacks per-campaign timelines, never interleaved.
        // No lazy creation here - creating N journals on a render would be a
        // side-effect storm; a campaign's timeline is created when scoped to it.
        stacks = campaigns.map((c) => ({ name: c.name, ...this.#timelineContext(resolveTimelineJournal(c), isGM) }));
        const legacy = getTimelineJournal();
        if (legacy && !campaignOf(legacy)) {
          stacks.push({ name: game.i18n.localize(`${I18N}.hub.scope.unfiled`), ...this.#timelineContext(legacy, isGM) });
        }
      }
    }
    if (isGM && !getCampaigns().length && !game.settings.get(MODULE_ID, ADOPTION_PROMPTED_SETTING)) {
      const legacyId = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING) || null;
      context.adoption = adoptionPlan(game.journal.contents, mejType, legacyId).length > 0;
    }
    const scopeContext = this.#campaignScopeContext();
    context.header = { scopeOptions: scopeContext.options, isCampaignScope: scopeContext.isCampaignScope, toolsMenuOpen: this.state.toolsMenuOpen };
    context.index = this.#indexContext();
    context.timeline = { stacks };
    const graphPrep = prepareGraphContext(this.#scopedEntries(), this.state);
    this.#graphData = graphPrep.graph;
    context.graph = graphPrep.context;
    context.search = this.#searchContext();
    context.dashboards = this.#dashboardsContext(isGM);
    // Secrets tracker (spec §7): GM-only pane. The tab header itself is
    // hidden from players by _prepareTabs above; context.secrets stays
    // undefined for non-GM so the template's `{{#if secrets}}` guard never
    // renders the pane body either, even if a player somehow lands on the tab.
    if (isGM) context.secrets = await this.#secretsContext();

    return context;
  }

  #typeLabel(type) {
    if (type === "journal") return game.i18n.localize(`${I18N}.hub.journalType`);
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    return labels[type] ? game.i18n.localize(labels[type]) : type;
  }

  #typeIcon(type) {
    // "journal" (the doctype-filter's synthetic label for an untyped page -
    // see #typeLabel above) has no entry in MEJ's own type-icon map, so
    // getIcon() would return undefined and render "fas undefined".
    if (type === "journal") return "fas fa-book";
    return `fas ${game.MonksEnhancedJournal.getIcon(type)}`;
  }

  /** Resolve HUB_STATE.campaignId to a scope. Lazily seeded from the client setting; stale folder ids reset to All. */
  #scope() {
    if (this.state.campaignId === null) {
      this.state.campaignId = game.settings.get(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING);
    }
    const id = this.state.campaignId;
    if (id === "unfiled") return { campaign: null, unfiled: true };
    const folder = id ? game.folders.get(id) : null;
    if (id && (!folder || !isCampaignFolder(folder))) {
      this.state.campaignId = "";
      return { campaign: null, unfiled: false };
    }
    return { campaign: folder ?? null, unfiled: false };
  }

  /**
   * Spec §2: the entries the current scope covers. Zero-campaign worlds see
   * everything (pre-adoption behavior). RULING: All-with-campaigns means
   * everything - every campaign's members AND unfiled entries, campaign
   * members first - not just what's filed. #indexContext's `badge` map
   * already resolves an unfiled row's campaign as null (campaignOf() finds
   * no folder), so unfiled rows fall through with no campaign badge for
   * free; every other #scopedEntries() consumer (search, dashboards,
   * secrets tracker) inherits this the same way, automatically.
   */
  #scopedEntries() {
    const { campaign, unfiled } = this.#scope();
    if (unfiled) return unfiledEntries({ user: game.user });
    if (campaign) return campaignEntries(campaign, { user: game.user });
    const campaigns = getCampaigns();
    if (!campaigns.length) return unfiledEntries({ user: game.user });
    return [...campaigns.flatMap((c) => campaignEntries(c, { user: game.user })), ...unfiledEntries({ user: game.user })];
  }

  #campaignScopeContext() {
    const campaigns = getCampaigns();
    const current = this.state.campaignId ?? "";
    const options = [
      { value: "", label: game.i18n.localize(`${I18N}.hub.scope.all`), selected: current === "" },
      ...campaigns.map((c) => ({ value: c.id, label: c.name, selected: current === c.id }))
    ];
    if (unfiledEntries({ user: game.user }).length) {
      options.push({ value: "unfiled", label: game.i18n.localize(`${I18N}.hub.scope.unfiled`), selected: current === "unfiled" });
    }
    if (game.user.isGM) {
      options.push({ value: "__new", label: game.i18n.localize(`${I18N}.hub.scope.newCampaign`), selected: false });
    }
    return { hasCampaigns: campaigns.length > 0, options, isCampaignScope: !!current && current !== "unfiled" };
  }

  #indexContext() {
    const { campaign, unfiled } = this.#scope();
    const entries = this.#scopedEntries();
    const source = buildIndexSource(entries, game.user, mejType, this.#typeIcon.bind(this));
    const rows = filterIndexRows(source, this.state, this.#typeLabel.bind(this));
    const mentionCounts = mentionBadgeCounts();
    const badge = !campaign && !unfiled;
    const campaignNames = badge ? new Map(entries.map((e) => [e.uuid, campaignOf(e)?.name ?? null])) : null;
    for (const row of rows) {
      row.mentions = mentionCounts.get(row.uuid) ?? 0;
      if (badge) row.campaign = campaignNames.get(row.uuid);
    }
    const byUuid = new Map(entries.map((e) => [e.uuid, e]));
    for (const row of rows) {
      row.hidden = (byUuid.get(row.uuid)?.ownership?.default ?? null) === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    }
    const allTypes = [...new Set(source.map((r) => r.type))].sort((a, b) => this.#typeLabel(a).localeCompare(this.#typeLabel(b)));
    return {
      rows,
      total: source.length,
      query: this.state.query,
      typeMenuOpen: this.state.typeMenuOpen,
      sortMenuOpen: this.state.sortMenuOpen,
      doctypeFilter: buildDoctypeFilter(allTypes, this.state.types, this.#typeLabel.bind(this), this.#typeIcon.bind(this), game.i18n.localize(`${I18N}.hub.allTypes`)),
      sortMenu: buildSortMenu(this.state.sort, (k) => game.i18n.localize(`${I18N}.hub.sort.${k}`)),
      isUnfiledScope: unfiled
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
    const scopeId = this.state.campaignId || null;
    const { hits, spillover } = searchScoped(this.state.searchQuery, scopeId);
    const results = hits.map((hit) => ({
      uuid: hit.uuid,
      name: hit.name,
      icon: this.#typeIcon(hit.type),
      typeLabel: this.#typeLabel(hit.type),
      matches: hit.matches.map((m) => ({ fieldLabel: this.#fieldLabel(m.field), snippet: m.snippet }))
    }));
    return {
      query: this.state.searchQuery,
      hasQuery: this.state.searchQuery.trim().length > 0,
      results,
      spillover
    };
  }

  #timelineContext(journal, isGM) {
    if (!journal) {
      // Players before a GM has ever opened the hub: no timeline journal
      // exists yet. Render an explicit empty state rather than erroring.
      return { hasJournal: false, rows: [], order: this.state.timelineOrder, orderOptions: [], canEdit: false, journalId: null };
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
      canEdit,
      journalId: journal.id
    };
  }

  // Saved dashboard queries (Task 9): each stored {id, name, query,
  // showPlayers} is re-run live through runQueryAll() on every render (never
  // cached), so results always reflect the current index and the current
  // user's permissions - runQueryAll() itself does the GM/OBSERVER filtering
  // (see live-index.mjs). Players only ever see rows for queries with
  // showPlayers === true; a GM sees every saved query regardless of that
  // flag. A stored query that no longer parses (e.g. after a tag rename)
  // renders as an error row via the catch below, rather than crashing the
  // whole Hub render (spec §6).
  /** Spec §2: post-filter dashboard/query rows to the current campaign scope, same rule as searchScoped(). */
  #scopeFilterRows(rows) {
    const id = this.state.campaignId;
    if (!id) return rows;
    return rows.filter((r) => {
      const entry = fromUuidSync(r.uuid);
      const cid = campaignIdOf(entry);
      return id === "unfiled" ? cid === null : cid === id;
    });
  }

  #dashboardsContext(isGM) {
    const saved = game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [];
    const rows = saved.filter((q) => isGM || q.showPlayers === true).map((q) => {
      try {
        const results = this.#scopeFilterRows(runQueryAll(q.query)).map((hit) => ({
          uuid: hit.uuid, name: hit.name,
          icon: this.#typeIcon(hit.type), typeLabel: this.#typeLabel(hit.type)
        }));
        return { ...q, error: null, results };
      } catch (err) {
        // A stored query that no longer parses renders as an error row, not a crash (spec §6).
        return { ...q, error: game.i18n.localize(`${I18N}.hub.dashboards.badQuery`), results: [] };
      }
    });
    return { rows, isGM };
  }

  /**
   * Secrets tracker (spec §7, GM-only): every secret in the campaign in one
   * flat list - block-level secret sections (via the live index, spec §9),
   * Session page checklist items, and hidden/secret relationships - each
   * normalized to a common row shape so filterTrackerRows() (a pure,
   * Foundry-free module) can apply the type/state/"what does player X
   * know" filters uniformly across all three kinds.
   */
  async #secretsContext() {
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const rows = [];
    // Campaign scoping (spec §2): every row kind the tracker emits is
    // bounded by the Hub's campaign picker, so compute the scope once and
    // share it between the block-secrets pass and the page walk below.
    const scopedEntries = this.#scopedEntries();
    const scopedUuids = new Set(scopedEntries.map((e) => e.uuid));
    // 1. Block secrets, via the index (spec §9).
    for (const rec of gmSecretRecords()) {
      if (!scopedUuids.has(rec.uuid)) continue;
      const entry = fromUuidSync(rec.uuid);
      const reveals = entry?.getFlag(MODULE_ID, "secretReveals") ?? {};
      for (const s of rec.secrets) {
        rows.push({ kind: "block", entryUuid: rec.uuid, entryName: rec.name, entryType: rec.type, secretId: s.id, preview: s.preview, audience: normalizeAudience(reveals[s.id]), revealedAll: s.revealedAll });
      }
    }
    // 2. Session checklist items + 3. hidden/secret relationships - walk
    // MEJ pages once (single-page convention, same as graph-app's graphRows()).
    // Scoped to the Hub's campaign picker (spec §2) so the tracker only
    // shows the current scope's entries.
    for (const entry of scopedEntries) {
      for (const page of entry.pages?.contents ?? []) {
        const type = mejType(page);
        if (!type) continue;
        if (type === "session") {
          for (const s of page.flags?.[MODULE_ID]?.session?.secrets ?? []) {
            rows.push({ kind: "session", entryUuid: entry.uuid, entryName: entry.name, entryType: type, secretId: s.id, preview: s.text ?? "", audience: normalizeAudience(s.audience), revealedAll: s.revealed === true });
          }
        }
        const relReveals = entry.getFlag(MODULE_ID, "relReveals") ?? {};
        const relRows = visibleRelRows(page.flags?.["monks-enhanced-journal"]?.relationships, relReveals, { userId: game.user.id, groups, isGM: true });
        for (const r of relRows.filter((r) => r.hidden || r.secretText)) {
          // A relationship can carry two independently-revealable overlays -
          // the hidden ROW itself, and its separate secret label - which the
          // sheet UI exposes as two separate reveal buttons when both apply.
          // Emit one tracker row per overlay actually present here, each
          // tagged with the relKind onTrackerAudience needs to write back to
          // the matching overlay key. Only the secret-label overlay can be
          // "revealed to everyone" via MEJ's native rel.revealed flag (a
          // hidden row has no such all-or-nothing native toggle - it's only
          // ever revealed via the relReveals.row per-player/group overlay).
          const relKinds = [];
          if (r.hidden) relKinds.push("row");
          if (r.secretText) relKinds.push("secret");
          for (const relKind of relKinds) {
            const preview = relKind === "secret" ? r.secretText : (r.label || entry.name);
            rows.push({ kind: "relationship", relKind, entryUuid: entry.uuid, entryName: entry.name, entryType: type, secretId: r.id, preview, audience: normalizeAudience(relReveals[r.id]?.[relKind]), revealedAll: relKind === "secret" && r.revealed === true });
          }
        }
        break;
      }
    }
    const filtered = filterTrackerRows(rows, { type: this.state.secretsType, state: this.state.secretsState, playerId: this.state.secretsPlayer, groups });
    const audienceLabel = (row) => {
      if (row.revealedAll) return game.i18n.localize(`${I18N}.secrets.everyone`);
      const a = row.audience;
      const names = [
        ...game.users.filter((u) => a.users.includes(u.id)).map((u) => u.name),
        ...groups.filter((g) => a.groups.includes(g.id)).map((g) => g.name)
      ];
      return a.all ? game.i18n.localize(`${I18N}.secrets.everyone`) : names.join(", ");
    };
    return {
      rows: filtered.map((row) => ({
        ...row,
        icon: this.#typeIcon(row.entryType),
        audienceLabel: audienceLabel(row),
        // Block rows on a session-type page are recap-sourced (session
        // pages carry body text in system.recap, not text.content) - the
        // player re-enrichment path (injectPlayerSecrets in
        // hooks/secrets-ui.mjs) only re-enriches
        // .editor-display[data-key="text.content"], so a reveal on one of
        // these never actually displays to the player it was granted to
        // (I1b, recap re-enrichment unsupported this release). Don't offer
        // a reveal control the tracker can't make good on.
        canAudience: row.kind !== "block" || (!!row.secretId && row.entryType !== "session")
      })),
      types: [...new Set(rows.map((r) => r.entryType))].sort().map((t) => ({ value: t, label: this.#typeLabel(t), selected: t === this.state.secretsType })),
      state: this.state.secretsState,
      players: game.users.filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, selected: u.id === this.state.secretsPlayer })),
      groups: groups.map((g) => ({ ...g, memberNames: g.members.map((m) => game.users.get(m)?.name ?? m).join(", ") }))
    };
  }

  /** Name + query + showPlayers prompt; returns {name, query, showPlayers} or null. */
  static async #promptDashboard(initial = {}, { titleKey }) {
    const esc = foundry.utils.escapeHTML;
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `
        <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.dashboards.name`)}</label>
          <input type="text" name="name" value="${esc(initial.name ?? "")}" required autofocus></div>
        <div class="form-group"><label>${game.i18n.localize(`${I18N}.hub.dashboards.query`)}</label>
          <input type="text" name="query" value="${esc(initial.query ?? "")}" placeholder="type:person tag:villain text"></div>
        <p class="hint">${game.i18n.localize(`${I18N}.hub.dashboards.queryHint`)}</p>
        <div class="form-group"><label><input type="checkbox" name="showPlayers"${initial.showPlayers ? " checked" : ""}>
          ${game.i18n.localize(`${I18N}.hub.dashboards.showPlayers`)}</label></div>`,
      ok: {
        label: `${I18N}.hub.save`,
        callback: (event, button) => {
          const form = button.form.elements;
          const name = form.name.value.trim();
          const query = form.query.value.trim();
          if (!name || !query) return null;
          try {
            parseQuery(query);
          } catch {
            ui.notifications.warn(game.i18n.localize(`${I18N}.hub.dashboards.badQuery`));
            return null;
          }
          return { name, query, showPlayers: form.showPlayers.checked === true };
        }
      },
      rejectClose: false
    });
  }

  static async onAddDashboard() {
    if (!game.user.isGM) return;
    const result = await CampaignHubPage.#promptDashboard({}, { titleKey: `${I18N}.hub.dashboards.add` });
    if (!result) return;
    const saved = [...(game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [])];
    saved.push({ id: foundry.utils.randomID(8), ...result });
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }

  static async onEditDashboard(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-dashboard-id]")?.dataset.dashboardId;
    const saved = [...(game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? [])];
    const existing = saved.find((q) => q.id === id);
    if (!existing) return;
    const result = await CampaignHubPage.#promptDashboard(existing, { titleKey: `${I18N}.hub.dashboards.edit` });
    if (!result) return;
    Object.assign(existing, result);
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }

  static async onDeleteDashboard(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-dashboard-id]")?.dataset.dashboardId;
    const saved = (game.settings.get(MODULE_ID, SAVED_QUERIES_SETTING) ?? []).filter((q) => q.id !== id);
    await game.settings.set(MODULE_ID, SAVED_QUERIES_SETTING, saved);
    this.render({ parts: ["main"] });
  }

  static onSecretsSetFilter(event, target) {
    if (!game.user.isGM) return;
    const { filter, value } = target.dataset;
    if (filter === "type") this.state.secretsType = this.state.secretsType === value ? "" : value;
    else if (filter === "state") this.state.secretsState = value;
    else if (filter === "player") this.state.secretsPlayer = this.state.secretsPlayer === value ? "" : value;
    this.render({ parts: ["main"] });
  }

  /**
   * Quick reveal from the tracker: route to the right storage per kind.
   * The session branch mirrors SessionSheet.onSecretAudience's fix (Task 9
   * report): re-read the live page's secrets AFTER the dialog closes rather
   * than reusing the pre-dialog snapshot, so a concurrent edit made while
   * the dialog was open (co-GM, another window) isn't silently reverted by
   * writing back a stale array. The block/relationship branches write a
   * single scoped flag key (`secretReveals.<id>` / `relReveals.<id>.<kind>`)
   * rather than replacing a whole collection, so they carry no equivalent
   * clobber risk and need no re-read.
   */
  /**
   * Raw inner HTML of a native secret block by section id (M5), read from
   * the entry's MEJ page body - system.recap for session pages, text.content
   * otherwise (same fallback field-extractors.mjs's bodyText() uses; MEJ
   * entries are single-page journals per this file's other single-page
   * lookups). Returns null if the entry has no MEJ page, the body is empty,
   * or the section id can no longer be found (deleted between render and
   * click) - callers fall back to the tracker row's stored preview text.
   */
  static #secretSectionHtml(entry, secretId) {
    if (!secretId) return null;
    const page = entry.pages?.contents?.find((p) => mejType(p));
    const body = page ? (page.system?.recap ?? page.text?.content ?? "") : "";
    if (!body) return null;
    const fragment = document.createRange().createContextualFragment(`<div>${body}</div>`);
    const section = fragment.querySelector(`section.secret[id="${CSS.escape(secretId)}"]`);
    return section ? section.innerHTML : null;
  }

  static async onTrackerAudience(event, target) {
    if (!game.user.isGM) return;
    const row = target.closest("[data-secret-kind]");
    const { secretKind, entryUuid, secretId } = row.dataset;
    const entry = await fromUuid(entryUuid);
    if (!entry) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    if (secretKind === "block") {
      const previous = normalizeAudience((entry.getFlag(MODULE_ID, "secretReveals") ?? {})[secretId]);
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.revealTitle`), audience: previous, groups });
      if (!audience) return;
      await entry.update({ [`flags.${MODULE_ID}.secretReveals.${secretId}`]: audience });
      // Whisper the secret's actual content, not the 140-char index preview
      // (M5) - chat enrichment happens at render time, so the raw inner
      // HTML pulled straight off the page's body is fine unenriched. Falls
      // back to the preview if the page or the section itself can no
      // longer be located (e.g. deleted between render and click).
      const html = CampaignHubPage.#secretSectionHtml(entry, secretId)
        ?? `<p>${foundry.utils.escapeHTML(row.dataset.preview ?? "")}</p>`;
      await sendRevealWhisper({ audience, previousAudience: previous, groups, html, entryUuid, entryName: entry.name });
    } else if (secretKind === "session") {
      const page = entry.pages.contents.find((p) => mejType(p) === "session");
      if (!page) return;
      const item = sessionData(page).secrets.find((s) => s.id === secretId);
      if (!item) return;
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`), audience: item.audience, groups });
      if (!audience) return;
      // Re-read fresh data after the dialog closes (Task 9 pattern) rather
      // than reusing the pre-dialog snapshot - see method doc comment.
      const current = sessionData(page).secrets;
      if (!current.find((s) => s.id === secretId)) return;
      await page.update({ [`flags.${MODULE_ID}.session.secrets`]: current.map((s) => (s.id === secretId ? { ...s, audience } : s)) });
      await sendRevealWhisper({ audience, previousAudience: item.audience, groups, html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`, entryUuid, entryName: entry.name });
    } else if (secretKind === "relationship") {
      const overlay = (entry.getFlag(MODULE_ID, "relReveals") ?? {})[secretId] ?? {};
      const kind = row.dataset.relKind ?? "row";
      const previous = normalizeAudience(overlay[kind]);
      const audience = await promptAudience({ title: game.i18n.localize(`${I18N}.secrets.relRevealTitle`), audience: previous, groups });
      if (!audience) return;
      await entry.update({ [`flags.${MODULE_ID}.relReveals.${secretId}.${kind}`]: audience });
      await sendRevealWhisper({ audience, previousAudience: previous, groups, html: `<p>${foundry.utils.escapeHTML(row.dataset.preview ?? entry.name)}</p>`, entryUuid, entryName: entry.name });
    }
    this.render({ parts: ["main"] });
  }

  /** Name + member-checkbox dialog; returns {name, members} or null. */
  static async #promptGroup(initial = {}, { titleKey }) {
    const esc = foundry.utils.escapeHTML;
    const players = game.users.filter((u) => !u.isGM);
    const memberRows = players.map((u) =>
      `<label class="mej-cc-audience-row"><input type="checkbox" name="member-${u.id}"${(initial.members ?? []).includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`
    ).join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: titleKey },
      content: `<div class="form-group"><label>${game.i18n.localize(`${I18N}.secrets.groupName`)}</label>
          <input type="text" name="name" value="${esc(initial.name ?? "")}" required autofocus></div>
        <fieldset><legend>${game.i18n.localize(`${I18N}.secrets.groupMembers`)}</legend>${memberRows}</fieldset>`,
      ok: {
        label: `${I18N}.hub.save`,
        callback: (event, button) => {
          const name = button.form.elements.name.value.trim();
          if (!name) return null;
          return { name, members: players.filter((u) => button.form.elements[`member-${u.id}`]?.checked).map((u) => u.id) };
        }
      },
      rejectClose: false
    });
  }

  static async onAddGroup() {
    if (!game.user.isGM) return;
    const result = await CampaignHubPage.#promptGroup({}, { titleKey: `${I18N}.secrets.addGroup` });
    if (!result) return;
    const groups = upsertGroup(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), { id: foundry.utils.randomID(8), ...result });
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, groups);
    this.render({ parts: ["main"] });
  }

  static async onEditGroup(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const existing = groups.find((g) => g.id === id);
    if (!existing) return;
    const result = await CampaignHubPage.#promptGroup(existing, { titleKey: `${I18N}.secrets.editGroup` });
    if (!result) return;
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, upsertGroup(groups, { id, ...result }));
    this.render({ parts: ["main"] });
  }

  static async onDeleteGroup(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-group-id]")?.dataset.groupId;
    await game.settings.set(MODULE_ID, PLAYER_GROUPS_SETTING, deleteGroup(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING), id));
    this.render({ parts: ["main"] });
  }

  /**
   * Create an empty Session entry and open it. This is the creation path in
   * native mode, where MEJ's own New Entry dialog cannot offer the Session
   * type (its registry only knows about it when the extension API is
   * present). Routed through JournalEntry.create like every other companion
   * creation path, so the preCreateJournalEntry ownership hook still applies
   * the playersWriteSessions setting.
   */
  static async onNewSession() {
    if (!game.user.isGM) return;
    try {
      const name = game.i18n.localize(`${I18N}.hub.newSession`);
      const { campaign: scoped } = this.#scope();
      // RULING: onNewSession must always prompt when the scope doesn't
      // already imply a campaign (Unfiled/All) - see promptCampaignChoice's
      // doc comment for why the sole-campaign short-circuit is wrong here.
      const campaign = scoped ?? await CampaignHubPage.promptCampaignChoice(name, { alwaysPrompt: true });
      // Zero-campaign world: campaign stays null -> legacy loose creation, unchanged.
      const destination = campaign
        ? { folder: campaign.id, ownership: { default: baselineOwnership(campaign) } }
        : {};
      const entry = await JournalEntry.create({
        name,
        ...destination,
        pages: [buildSessionPageData(name, "", null, null)]
      });
      const page = entry?.pages?.contents?.[0];
      if (page) await page.sheet.render(true);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | creating a session failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.hub.newSessionFailed`));
    }
  }

  /**
   * GM-only "Auto-capture campaign" entry point (spec §4): pick which
   * campaign receives auto-captured Encounters and shared media. Stored as
   * a world setting (AUTO_CAPTURE_CAMPAIGN_SETTING) that hooks/auto-capture.mjs
   * reads directly - not scoped to the Hub's own campaignId state, since
   * capture happens independent of which scope a GM happens to have open.
   */
  static async onSetCaptureCampaign() {
    if (!game.user.isGM) return;
    const campaign = await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.captureTarget`));
    if (!campaign) return;
    await game.settings.set(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, campaign.id);
    ui.notifications.info(game.i18n.format(`${I18N}.hub.captureTargetSet`, { name: campaign.name }));
  }

  /**
   * GM-only "New Campaign" entry point (spec §1/§2): creates a root-level
   * campaign folder and switches the Hub's scope to it. `campaign-store.mjs`
   * itself re-checks game.user.isGM before writing (createCampaign() returns
   * null for a non-GM), so this action is safe to leave wired regardless of
   * seat, same convention as onOpenImportWizard/onOpenExportDialog below.
   */
  static async onNewCampaign() {
    const esc = foundry.utils.escapeHTML;
    const baselineOptions = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
        <input type="text" name="name" value="" autofocus></div>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${baselineOptions}</select></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.hub.newCampaign`) },
      content,
      ok: {
        callback: (event, button) => ({
          name: button.form.elements.name.value.trim(),
          baseline: button.form.elements.baseline.value
        })
      },
      rejectClose: false
    });
    if (!result?.name) return;
    const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
    if (campaign) {
      this.state.campaignId = campaign.id;
      await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, campaign.id);
      this.render({ parts: ["main"] });
    }
  }

  /**
   * GM-only "Campaign settings" entry point (spec §5): edit the campaign's
   * ownership baseline, optionally bulk-applying it to every current member
   * right away. Renaming a campaign is renaming the folder - Foundry's
   * native folder UI covers it, so there's no name field here.
   */
  static async onEditCampaign() {
    const { campaign } = this.#scope();
    if (!campaign || !game.user.isGM) return;
    const esc = foundry.utils.escapeHTML;
    const currentKey = campaignFlagOf(campaign)?.ownershipDefault ?? "observer";
    const options = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === currentKey ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${options}</select></div>
      <div class="form-group"><label><input type="checkbox" name="applyNow" checked>
        ${esc(game.i18n.localize(`${I18N}.hub.applyBaselineNow`))}</label></div>`;
    // Spec C §2: the campaign settings dialog is also where a GM who deleted
    // (or never had) the campaign's portal entry can get one back. Absent
    // when a portal already exists - nothing to restore.
    const buttons = [];
    if (!campaignPortal(campaign)) {
      buttons.push({
        action: "restorePortal",
        label: `${I18N}.hub.restorePortal`,
        callback: async () => {
          await ensureCampaignPortal(campaign);
          this.render({ parts: ["main"] });
          // Explicit false, not a bare return: DialogV2._onSubmit does
          // `(await button.callback(...)) ?? button.action` (dialog.mjs
          // :264-276), so an undefined-returning callback resolves the
          // dialog's promise to the STRING "restorePortal" - truthy, so
          // `if (!result) return;` below would fall through into
          // campaign.setFlag(...) with result.baseline undefined.
          return false;
        }
      });
    }
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: campaign.name },
      content,
      buttons,
      ok: { callback: (event, button) => ({
        baseline: button.form.elements.baseline.value,
        applyNow: button.form.elements.applyNow.checked
      }) },
      rejectClose: false
    });
    if (!result) return;
    await campaign.setFlag(MODULE_ID, CAMPAIGN_FLAG, { ownershipDefault: result.baseline });
    if (result.applyNow) {
      const n = await applyBaselineToMembers(campaign);
      ui.notifications.info(game.i18n.format(`${I18N}.hub.baselineApplied`, { count: n }));
    }
    this.render({ parts: ["main"] });
  }

  /**
   * GM-only world adoption (spec §6): create a campaign folder from an
   * existing pre-adoption world's content. Moves adoptionPlan()'s ids
   * (root-level MEJ-typed entries + the legacy singleton timeline journal,
   * see that function's doc comment for the foldered/untyped exclusions)
   * into the new campaign, clears the legacy TIMELINE_JOURNAL_SETTING
   * (the moved journal is found from then on via its own `timeline` flag,
   * per campaignTimelineJournal() - no data rewrite needed), and scopes
   * the Hub to the new campaign.
   */
  static async onAdoptWorld() {
    if (!game.user.isGM) return;
    const esc = foundry.utils.escapeHTML;
    const baselineOptions = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <p>${esc(game.i18n.localize(`${I18N}.hub.adoptExplain`))}</p>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
        <input type="text" name="name" value="${esc(game.world.title)}"></div>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${baselineOptions}</select></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.hub.adoptGo`) },
      content,
      ok: { callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        baseline: button.form.elements.baseline.value
      }) },
      rejectClose: false
    });
    if (!result?.name) return;
    const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
    if (!campaign) return;
    const legacyId = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING) || null;
    const ids = adoptionPlan(game.journal.contents, mejType, legacyId);
    if (ids.length) await JournalEntry.updateDocuments(ids.map((id) => ({ _id: id, folder: campaign.id })));
    if (legacyId) await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, "");
    await game.settings.set(MODULE_ID, ADOPTION_PROMPTED_SETTING, true);
    this.state.campaignId = campaign.id;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, campaign.id);
    ui.notifications.info(game.i18n.format(`${I18N}.hub.adopted`, { count: ids.length, name: campaign.name }));
    this.render({ parts: ["main"] });
  }

  /** GM-only dismissal of the adoption banner (spec §6), without creating a campaign. */
  static async onDismissAdoption() {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, ADOPTION_PROMPTED_SETTING, true);
    this.render({ parts: ["main"] });
  }

  /** GM-only, Unfiled-scope-only: file a single index row into a chosen campaign (spec §6). */
  static async onFileIntoCampaign(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    const campaign = entry ? await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.fileInto`)) : null;
    if (!campaign) return;
    await entry.update({ folder: campaign.id });
    this.render({ parts: ["main"] });
  }

  /** GM-only, Unfiled-scope-only: file every currently-filtered Unfiled row into a chosen campaign (spec §6). */
  static async onFileAllShown() {
    if (!game.user.isGM) return;
    // The currently-filtered Unfiled rows: recompute exactly what the pane shows.
    const entries = this.#scopedEntries();
    const source = buildIndexSource(entries, game.user, mejType, this.#typeIcon.bind(this));
    const rows = filterIndexRows(source, this.state, this.#typeLabel.bind(this));
    if (!rows.length) return;
    const campaign = await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.fileAllShown`));
    if (!campaign) return;
    const ids = rows.map((r) => foundry.utils.parseUuid(r.uuid).id);
    await JournalEntry.updateDocuments(ids.map((id) => ({ _id: id, folder: campaign.id })));
    ui.notifications.info(game.i18n.format(`${I18N}.hub.adopted`, { count: ids.length, name: campaign.name }));
    this.render({ parts: ["main"] });
  }

  /** GM-only hide/reveal toggle (spec §5) on an index row: NONE <-> the entry's campaign baseline. */
  static async onToggleEntryHidden(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    if (!entry) return;
    const isHidden = (entry.ownership?.default ?? null) === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    await setEntryHidden(entry, !isHidden);
    this.render({ parts: ["main"] });
  }

  /**
   * GM picks a campaign (used when the scope doesn't already imply one).
   * Returns Folder|null; null = user cancelled or zero campaigns exist.
   * By default short-circuits to the sole campaign when exactly one exists
   * (fileIntoCampaign/fileAllShown/capture-target: there's nothing to
   * choose between, so no dialog is the right call). `alwaysPrompt: true`
   * (onNewSession only) disables that short-circuit - RULING: a new
   * session's destination is a real decision even with one campaign in the
   * world, since the alternative is staying unfiled, and skipping the
   * dialog would mean skipping the cancel-to-stay-unfiled path too.
   */
  static async promptCampaignChoice(title, { alwaysPrompt = false } = {}) {
    const campaigns = getCampaigns();
    if (!campaigns.length) return null;
    if (campaigns.length === 1 && !alwaysPrompt) return campaigns[0];
    const esc = foundry.utils.escapeHTML;
    // Pre-select the Hub's currently scoped campaign (the client setting the
    // picker persists) - the GM prompted while working inside a campaign
    // almost always means THAT campaign; falls back to first-in-list when the
    // scope is All/Unfiled or stale.
    const active = game.settings.get(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING);
    const preselect = campaigns.some((c) => c.id === active) ? active : campaigns[0].id;
    const options = campaigns.map((c) =>
      `<option value="${c.id}"${c.id === preselect ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `<div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.scope.label`))}</label><select name="campaign">${options}</select></div>`,
      ok: { callback: (event, button) => button.form.elements.campaign.value },
      rejectClose: false
    });
    return result ? game.folders.get(result) ?? null : null;
  }

  // Search-tab spillover affordance (spec §2): clears the campaign scope so
  // a query's out-of-scope matches (searchScoped's spillover count) become
  // visible too. Available to any seat - search scoping applies to
  // players and GMs alike.
  static async onSearchAllCampaigns() {
    this.state.campaignId = "";
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, "");
    this.render({ parts: ["main"] });
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

  // GM-only "Export" entry point (Task 12), same guarding convention as
  // onOpenImportWizard above: the action is wired regardless of GM status
  // (Foundry always wires data-action handlers), the button is only
  // rendered for a GM (context.isGM), and openExportDialog() itself
  // re-checks game.user.isGM as a second guard.
  static onOpenExportDialog() {
    openExportDialog();
  }

  // Help button (Index toolbar, outside the isGM guard): opens the published
  // user guide matching this seat in a new browser tab.
  static onOpenHelp() {
    window.open(guideUrl(game.user.isGM), "_blank", "noopener");
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

  static onToggleToolsMenu() {
    this.state.toolsMenuOpen = !this.state.toolsMenuOpen;
    this.state.typeMenuOpen = false;
    this.state.sortMenuOpen = false;
    this.render({ parts: ["main"] });
  }

  static async onSetTimelineOrder(event, target) {
    const order = target.dataset.order;
    if (!["manual", "created", "campaign"].includes(order)) return;
    this.state.timelineOrder = order;
    this.render({ parts: ["main"] });
  }

  static onSetGraphMode(event, target) {
    const mode = target.dataset.mode;
    if (!["ego", "all"].includes(mode)) return;
    this.state.graphMode = mode;
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
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
    const raw = Number(target.dataset.position);
    const position = target.dataset.position != null && Number.isInteger(raw) ? raw : null;
    const result = await CampaignHubPage.#promptTimepoint(
      { campaignDate: currentWorldComponents() },
      { titleKey: `${I18N}.hub.addTimepoint` }
    );
    if (!result) return;
    await queueFiling(() => Timepoints.addTimepoint(journal, result.label, position, result.campaignDate ?? null));
    this.render({ parts: ["main"] });
  }

  static async onRenameTimepoint(event, target) {
    if (!game.user.isGM) return;
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
    const id = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const current = Timepoints.getTimepoints(journal).find((t) => t.id === id);
    if (!current) return;
    const result = await CampaignHubPage.#promptTimepoint(
      { label: current.label, campaignDate: current.campaignDate ?? null },
      { titleKey: `${I18N}.hub.editTimepoint`, okKey: `${I18N}.hub.save` }
    );
    if (!result) return;
    await queueFiling(() => Timepoints.editTimepoint(journal, id, { label: result.label, campaignDate: result.campaignDate }));
    this.render({ parts: ["main"] });
  }

  static async onDeleteTimepoint(event, target) {
    if (!game.user.isGM) return;
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
    const id = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const label = Timepoints.getTimepoints(journal).find((t) => t.id === id)?.label ?? "";
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.hub.deleteTimepoint`) },
      content: `<p>${game.i18n.format(`${I18N}.hub.deleteTimepointConfirm`, { label: foundry.utils.escapeHTML(label) })}</p>`
    });
    if (!confirmed) return;
    await queueFiling(() => Timepoints.deleteTimepoint(journal, id));
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
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
    const timepointId = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const linkId = target.closest("[data-link-id]")?.dataset.linkId;
    await queueFiling(() => Timepoints.removeLink(journal, timepointId, linkId));
    this.render({ parts: ["main"] });
  }

  static async onToggleLinkShowPlayers(event, target) {
    if (!game.user.isGM) return;
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
    const timepointId = target.closest("[data-timepoint-id]")?.dataset.timepointId;
    const linkId = target.closest("[data-link-id]")?.dataset.linkId;
    await queueFiling(() => Timepoints.toggleLinkShowPlayers(journal, timepointId, linkId));
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
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain")) ?? {};
    } catch {
      data = {};
    }

    if (data.kind === REORDER_KIND) {
      return queueFiling(() => Timepoints.moveTimepoint(journal, data.id, Number(target.dataset.position)))
        .then(() => this.render({ parts: ["main"] }));
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
      if (!canAttachToTimeline(doc, journal)) {
        return ui.notifications.warn(game.i18n.localize(`${I18N}.hub.wrongCampaign`));
      }
      await queueFiling(() => Timepoints.addLink(journal, timepointId, { uuid: drop.uuid, name: doc.name, type: drop.type }));
      return this.render({ parts: ["main"] });
    }
    // drop.kind === "image"
    const showPlayers = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.hub.showImageToPlayers`) },
      content: `<p>${game.i18n.format(`${I18N}.hub.showImageToPlayersPrompt`, { name: foundry.utils.escapeHTML(filenameFromSrc(drop.src)) })}</p>`,
      rejectClose: false
    });
    if (showPlayers === null) return; // dialog dismissed
    await queueFiling(() => Timepoints.addLink(journal, timepointId, { src: drop.src, name: filenameFromSrc(drop.src), showPlayers: showPlayers === true }));
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

    // Deviation from brief: use `html` (as every other listener in this
    // method does), not `this.element` - this.element is never assigned for
    // a subsheet hosted in the shell (see the restore-focus comment on
    // search below), so querying it here would throw for that hosting mode.
    const scopeSelect = html.querySelector('select[name="campaign-scope"]');
    if (scopeSelect && !scopeSelect.dataset.ccBound) {
      scopeSelect.dataset.ccBound = "1";
      scopeSelect.addEventListener("change", async (event) => {
        if (event.target.value === "__new") {
          // Action-as-option: revert the visible selection immediately;
          // onNewCampaign itself switches scope only after a successful
          // create, so dialog-cancel leaves the previous scope untouched.
          event.target.value = this.state.campaignId ?? "";
          return CampaignHubPage.onNewCampaign.call(this);
        }
        this.state.campaignId = event.target.value;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, event.target.value);
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

    const backlinksToggle = html.querySelector('[data-action-change="toggleGraphBacklinks"]');
    if (backlinksToggle && !backlinksToggle.dataset.ccBound) {
      backlinksToggle.dataset.ccBound = "1";
      backlinksToggle.addEventListener("change", () => {
        this.state.graphBacklinks = backlinksToggle.checked;
        this.render({ parts: ["main"] });
      });
    }
    const graphSvg = html.querySelector(".mej-cc-graph-svg");
    if (graphSvg && this.#graphData) {
      drawGraphPane(graphSvg, this.#graphData, {
        centerUuid: this.state.graphCenterUuid,
        onOpen: async (uuid) => {
          const entry = await fromUuid(uuid);
          if (entry) game.MonksEnhancedJournal.openJournalEntry(entry);
        }
      });
    }
    // pendingTab (showGraphFor) used to be consumed here via
    // `this.changeTab.call(this.enhancedjournal || this, tab, "primary")` -
    // the `.call(this.enhancedjournal || this, ...)` rebind itself is a
    // real, correct fix for a shell-hosted subsheet's missing `#content`
    // (MEJ's own EnhancedJournalSheet.js:1747 does the same for its
    // click-driven tab switches), but calling it here, mid-mount, patches
    // `tabGroups` state fine while leaving the live DOM untouched (proved
    // unreliable live - see task-5 report addendum). Consumed in
    // _prepareTabs() instead now, so the initial render comes up on the
    // right tab natively rather than patching after the fact.
  }
}

/**
 * Entity-header entry point (spec B §2): open the Hub on the Graph tab,
 * ego-centered on `uuid`. If the entity belongs to a campaign, scope
 * switches to that campaign first so the ego view is in-context.
 */
export async function showGraphFor(uuid) {
  const doc = await fromUuid(uuid);
  const entry = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
  const cid = entry ? campaignIdOf(entry) : null;
  if (cid) {
    HUB_STATE.campaignId = cid;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, cid);
  }
  HUB_STATE.graphCenterUuid = entry?.uuid ?? uuid;
  HUB_STATE.graphMode = "ego";
  HUB_STATE.pendingTab = "graph";
  await openHub();
}
