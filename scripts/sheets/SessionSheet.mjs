// SessionSheet - registered with MEJ's extension API (see API.md,
// api.registerSheetType). Modeled on MEJ's own EventSheet
// (sheets/EventSheet.js) for PARTS/TABS/_prepareBodyContext shape.
//
// MEJ's tabbed shell renders subsheets by calling _replaceHTML directly and
// then manually invoking activateListeners()/subRender() - it never calls
// _onRender() for a subsheet hosted inside the shell (see apps/enhanced-journal.js,
// EnhancedJournal#_replaceHTML). Any DOM listener beyond the native
// data-action click bindings (which the core _replaceHTML step still wires)
// MUST be attached from activateListeners()/subRender(), never assumed to
// come from an _onRender() override, or it will silently never bind while
// the sheet is hosted inside MEJ's shell.
import { EnhancedJournalSheet } from "/modules/monks-enhanced-journal/sheets/EnhancedJournalSheet.js";
import { renderAwaitable } from "./awaitable-render.mjs";
import { MODULE_ID, I18N, RELAY_UPLOAD_DIR, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { sessionData } from "./session-data.mjs";
import { confirmDelete } from "../apps/confirm-delete.mjs";
import { attendeePlayerName } from "../logic/attendee-player.mjs";
import { isRelayableImageType, MAX_RELAY_FILE_BYTES, enforcedImageName } from "../logic/media-relay.mjs";
import { fieldsToStrip } from "../logic/session-submit.mjs";
import { bindAutosave, flushSessionEditors, focusSessionEditor, editorValue } from "./session-autosave.mjs";
import { patchSessionRegions } from "./session-regions.mjs";
import { relayUploadMedia, relayFilename } from "../hooks/media-relay.mjs";
import { uploadCompanionFile } from "../apps/import-upload.mjs";
import { getCalendarMonths, sessionMonthOptions, currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { listNotes, readNotes, notesEntryOf, addNote, updateNote, deleteNote } from "../data/notes-store.mjs";
import { linkNoteText, enrichNoteText, openNoteLink } from "../hooks/note-links.mjs";
import { noteToPlainText } from "../logic/note-text.mjs";
import { currentSession } from "../logic/current-session.mjs";
// The hooks module's openSessionPage (the campaign's open Session page); a different openSessionPage lives in integrations/mej-adapter.mjs.
import { openSessionPage as openCampaignSession, startSession, endSession } from "../hooks/current-session.mjs";
import { streamRows } from "../logic/tonight.mjs";
import { sessionStatus, sessionButton, elapsedLabel, hasVisibleText } from "../logic/session-state.mjs";
import { groundTone } from "../logic/sheet-ground.mjs";
import { recapDraft, tableTalkPlan } from "../logic/recap-draft.mjs";
import { validNoteText, notesForSession } from "../logic/notes.mjs";
import { NOTE_DRAFTS, sessionDraftKey, trackDraft, restoreDraft, clearDraft, keepDraft } from "../logic/input-draft.mjs";
import { canSee, normalizeAudience } from "../logic/reveal-state.mjs";
import { applyChecklistAudience, checklistSeed } from "../logic/checklist-reveal.mjs";
import { fileRevealChange, revealLabel } from "../hooks/reveal-filing.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const FLAG_SESSION = `flags.${MODULE_ID}.session`;
const noteTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export class SessionSheet extends EnhancedJournalSheet {
  static DEFAULT_OPTIONS = {
    window: {
      title: `${I18N}.sheettype.session`,
      icon: "fa-solid fa-dice-d20"
    },
    actions: {
      focusRecap: SessionSheet.onFocusRecap,
      addSecret: SessionSheet.onAddSecret,
      deleteSecret: SessionSheet.onDeleteSecret,
      updateSecretText: SessionSheet.onUpdateSecretText,
      secretAudience: SessionSheet.onSecretAudience,
      removeAttendee: SessionSheet.onRemoveAttendee,
      manageAttendees: SessionSheet.onManageAttendees,
      openPrepBoard: SessionSheet.onOpenPrepBoard,
      captureSessionNote: SessionSheet.onCaptureSessionNote,
      editNote: SessionSheet.onEditNote,
      deleteNote: SessionSheet.onDeleteNote,
      startSession: SessionSheet.onStartSession,
      endSession: SessionSheet.onEndSession,
      openNoteLink: SessionSheet.onOpenNoteLink,
      toggleTableTalk: SessionSheet.onToggleTableTalk,
      addTableTalkToRecap: SessionSheet.onAddTableTalkToRecap,
      viewImage: SessionSheet.onViewImage,
      // Shadows MEJ's own addImage, which only opens the picker while the page has no image.
      addImage: SessionSheet.onAddImage
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/session.hbs`,
      templates: [
        "modules/monks-enhanced-journal/templates/sheets/partials/sheet-relationships.hbs",
        "templates/generic/tab-navigation.hbs",
        `modules/${MODULE_ID}/templates/session-header.hbs`,
        `modules/${MODULE_ID}/templates/table-talk.hbs`
      ],
      scrollable: [
        ".editor-display",
        ".editor-content",
        ".secrets-list",
        ".mej-cc-notes-list"
      ]
    }
  };

  /**
   * See awaitable-render.mjs. A Session page opened under a STOCK MEJ (no
   * extension API) is mounted through JournalEntrySheet's page-view path,
   * which awaits render() — without this, MEJ 13.06 throws in
   * _renderPageView and shows an empty page body.
   */
  async render(options = {}, _options = {}) {
    return renderAwaitable(this, EnhancedJournalSheet, options, _options);
  }

  static TABS = {
    primary: {
      tabs: [
        { id: "description", icon: "fa-solid fa-file-signature" },
        { id: "session", icon: "fa-solid fa-dice-d20" },
        { id: "relationships", icon: "fa-solid fa-users" },
        { id: "notes", icon: "fa-solid fa-paperclip" }
      ],
      initial: "description",
      labelPrefix: `${I18N}.tabs`
    }
  };

  static get type() {
    return "session";
  }

  static get defaultObject() {
    return { sessionNumber: null, campaignDate: null, attendees: [], secrets: [] };
  }

  get canPlaySound() {
    return false;
  }

  /**
   * A full render replaces the editors, so whatever is typed is saved first
   * (session-autosave.mjs). A region patch (session-regions.mjs, `ccPatch`)
   * reuses this context but leaves the editors alone. On MEJ's shell the
   * subsheet's old DOM is already gone by now; its editors saved themselves
   * on the way out (core's save on disconnect, routed to the same writer).
   */
  async _prepareContext(options) {
    if (!options?.ccPatch) flushSessionEditors(this, "close");
    return super._prepareContext(options);
  }

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);

    const isGM = game.user.isGM;
    const session = sessionData(this.document);

    // Month <select> options for the campaign-date field (I5): always 0-based, matching
    // both the module's storage contract and the Hub's own #promptTimepoint dialog - see
    // sessionMonthOptions' doc comment for why a plain 1-12 number input was wrong here.
    context.monthOptions = sessionMonthOptions(getCalendarMonths());

    context.relationships = await this.getRelationships();
    context.has = { relationships: Object.keys(context.relationships || {})?.length > 0 };
    context.placeholder = `${I18N}.placeholder.session`;

    // Secrets are only meaningful once revealed to players - a non-GM
    // context must never carry an unrevealed secret's text (same
    // data-minimization requirement as gmNotes below: excluded from the
    // context object entirely, not just hidden by the template/CSS).
    //
    // Phase C (spec §4): a player sees a checklist item when it's revealed
    // to all (revealed: true, which wins) OR their audience matches. The
    // sanitized non-GM shape still drops `revealed`/`audience` internals.
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    context.secrets = isGM
      ? session.secrets.map((s) => {
          // audienceCount alone can't represent "revealed to everyone via
          // the audience dialog" (all: true carries no users/groups) - the
          // GM badge needs its own audienceAll flag so that case still
          // renders a marker instead of silently showing no badge.
          const a = normalizeAudience(s.audience);
          return { ...s, audienceAll: s.revealed === true || a.all === true, audienceCount: a.users.length + a.groups.length };
        })
      : session.secrets
          .filter((s) => s.revealed || canSee(s.audience, game.user.id, groups))
          .map(({ id, text, revealedAt }) => ({ id, text, revealedAt }));

    // context.session must carry the same sanitized secrets as context.secrets
    // for non-GM users - the template only reads context.secrets today, but
    // the exclusion principle has to hold on the context object as a whole,
    // not depend on which property happens to be read.
    context.session = isGM ? session : { ...session, secrets: context.secrets };

    context.attendeeDetails = (
      await Promise.all(
        session.attendees.map(async (uuid) => {
          const actor = await fromUuid(uuid).catch(() => null);
          return actor ? { uuid, name: actor.name, img: actor.img, player: attendeePlayerName(actor, game.users) } : { uuid, name: uuid, img: "icons/svg/mystery-man.svg" };
        })
      )
    );

    // Recap, GM Prep and My Notes are always editable (spec 2026-10-19 §4.4):
    // their displays show the stored text, or text this client has written
    // but not yet had confirmed (a save in flight, a failed save, My Notes
    // waiting for a GM), so nothing typed disappears on a re-render.
    const enrichmentOptions = { relativeTo: this.document, secrets: this.document.isOwner, async: true };
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const recapValue = editorValue(this.document, "recap");
    context.enrichedRecap = await TextEditor.enrichHTML(recapValue, enrichmentOptions);
    context.myNotes = {
      enriched: await TextEditor.enrichHTML(editorValue(this.document, "myNotes"), { ...enrichmentOptions, secrets: true })
    };

    // gmNotes: excluded from the context entirely for non-GM users - a
    // player's client never receives this HTML in any form, DOM or otherwise.
    if (isGM) {
      context.enrichedGmNotes = await TextEditor.enrichHTML(editorValue(this.document, "gmNotes"), enrichmentOptions);
    } else if (context.data?.system) {
      // context.data comes from the base class's this.document.toObject(false)
      // (a plain deep-cloned object, safe to mutate) and carries system.gmNotes
      // unconditionally - strip it for the same reason enrichedGmNotes is
      // never computed above. Foundry still syncs the whole document
      // client-side regardless, so this is defense-in-depth at the render
      // layer, not real access control - but the context must stay
      // consistent with the stated exclusion principle.
      delete context.data.system.gmNotes;
    }

    // Header (spec 2026-10-19 §4.2). Status is the same for every viewer, so
    // Table talk is counted over all of this session's notes, not the
    // viewer's visible ones.
    const campaign = campaignOf(this.document);
    const running = campaign ? currentSession(campaign) : null;
    const sessionNotes = campaign ? notesForSession(readNotes(campaign), this.document.uuid) : [];
    const recap = this.document.system?.recap ?? "";
    const status = sessionStatus({
      startedAt: session.startedAt, endedAt: session.endedAt,
      isCurrent: running?.uuid === this.document.uuid,
      hasTableTalk: sessionNotes.length > 0,
      recap
    });
    const live = status === "live";
    const button = campaign ? sessionButton(status, isGM) : null;
    context.header = {
      status, live,
      statusLabel: live ? game.i18n.localize(`${I18N}.session.statusLive`) : status === "ended" ? game.i18n.localize(`${I18N}.session.statusEnded`) : "",
      startedAt: live ? running.startedAt : null,
      elapsed: live ? elapsedLabel(Date.now() - running.startedAt) : "",
      button: button ? { ...button, icon: button.action === "endSession" ? "fa-stop" : "fa-play" } : null,
      attendees: context.attendeeDetails,
      canManageAttendees: game.user.isGM || !!this.document.isOwner,
      number: session.sessionNumber ?? null,
      src: context.data?.src || null
    };
    context.recapEmpty = !hasVisibleText(recapValue);

    // Table talk (spec 2026-10-19 §4.3). Stored note text is escaped plus
    // @UUID shorthand only (linkNoteText), so enriched output is safe for
    // {{{ }}}. Open follows "live" unless this sheet's user toggled it.
    const rows = campaign
      ? await Promise.all(streamRows(listNotes(campaign, { sessionUuid: this.document.uuid }), game.user, { formatTime: noteTime })
        .map(async (r) => ({ ...r, text: await enrichNoteText(r.text) })))
      : [];
    // tableTalkAddedAt is not in SESSION_DEFAULTS (wave ruling): read with a fallback.
    const plan = tableTalkPlan(sessionNotes, { addedAt: session.tableTalkAddedAt ?? null, recapHasText: !context.recapEmpty });
    context.tableTalk = {
      open: this._ccTableTalkOpen ?? live,
      live,
      count: rows.length,
      rows,
      canWrite: campaign ? !!notesEntryOf(campaign)?.isOwner : false,
      canAddToRecap: !!(context.editable ?? this.isEditable) && rows.length > 0,
      added: plan.added
    };

    return context;
  }

  _documentControls() {
    let ctrls = [
      { label: '<i class="fas fa-search"></i>', type: "text" },
      { id: "search", type: "input", label: game.i18n.localize("MonksEnhancedJournal.SearchDescription"), visible: !!this.enhancedjournal, callback: this.searchText },
      { id: "show", label: game.i18n.localize("MonksEnhancedJournal.ShowToPlayers"), icon: "fas fa-eye", visible: game.user.isGM, action: "showPlayers" },
      { id: "edit", label: game.i18n.localize("MonksEnhancedJournal.EditDescription"), icon: "fas fa-pencil-alt", visible: this.isEditable, action: "focusRecap" }
    ];
    return ctrls.concat(super._documentControls());
  }

  _canDragDrop(selector) {
    return game.user.isGM || this.document.isOwner;
  }

  _dragDrop(html) {
    super._dragDrop(html);

    // Anywhere a GM would naturally drop a character: the header and the two
    // prose tabs. Relationships and the editors keep their own drops (§4.6).
    this._attendeeDropZone(".mej-cc-session-header, .tab[data-tab='description'], .tab[data-tab='session']").bind(html);

    // Image files dropped on the shared recap (spec 2026-09-04 §A). Owners
    // only - the editor is read-only for everyone else. File drops carry no
    // `type` TextEditor.getDragEventData() would recognize, so this reads
    // event.dataTransfer.files directly rather than reusing _onDropAttendee.
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".editor-parent[data-editor-id='recap']",
      permissions: {
        drop: () => this.document.isOwner
      },
      callbacks: {
        drop: this._onDropRecapImage.bind(this)
      }
    }).bind(html);
  }

  _attendeeDropZone(dropSelector) {
    return new foundry.applications.ux.DragDrop.implementation({
      dropSelector,
      permissions: {
        drop: () => game.user.isGM || this.document.isOwner
      },
      callbacks: {
        drop: this._onDropAttendee.bind(this)
      }
    });
  }

  async _onDropAttendee(event) {
    // Let the editors and the Relationships tab handle their own drops.
    if (event.target?.closest?.(".editor-parent, prose-mirror, .tab[data-tab='relationships']")) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type === "Actor") await this.addActor(data);
  }

  async _onDropRecapImage(event) {
    // An uploader typing in the recap who drops into the editor: its own image
    // plugin inserts the file (DragDrop has already called preventDefault, so
    // that cannot be read off the event).
    if (event.target?.closest?.("prose-mirror") && game.user.can("FILES_UPLOAD")) return;
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type?.startsWith("image/"));
    if (!files.length) return; // not a file drop (e.g. a stray Actor drag) - nothing for us to do
    event.preventDefault();
    event.stopPropagation();
    for (const file of files) await this._ingestRecapImage(file);
  }

  async _onPasteRecapImage(event) {
    // A paste the live editor's own image plugin already took (an uploader typing in it).
    if (event.isDefaultPrevented?.() || event.originalEvent?.defaultPrevented) return;
    const files = [...(event.originalEvent?.clipboardData?.files ?? event.clipboardData?.files ?? [])]
      .filter((f) => f.type?.startsWith("image/"));
    if (!files.length) return;
    // Owner check before preventDefault (review round 2, minor): a
    // non-owner's paste is never ours to swallow - _ingestRecapImage
    // already no-ops for them, but calling preventDefault first blocked
    // whatever default paste behavior they might otherwise have had.
    if (!this.document.isOwner) return;
    event.preventDefault();
    for (const file of files) await this._ingestRecapImage(file);
  }

  /**
   * Upload (directly if the user already holds FILES_UPLOAD, otherwise
   * relayed through the active GM - see hooks/media-relay.mjs) and append
   * the result to the shared recap. Both paths land in the same
   * RELAY_UPLOAD_DIR() and share the same type/size validation up front.
   * Owners only: a non-owner's drop/paste is ignored before any upload.
   */
  async _ingestRecapImage(file) {
    if (!this.document.isOwner) return;
    // Review round 2, finding 4: while this user is typing in the recap its
    // collaborative editor holds the text, and a direct write would be
    // overwritten by that editor's next save - so the drop waits until they
    // click out (the editor saves and unmounts then). Owners with upload
    // permission still have the editor's own image tools while typing.
    if ($(".editor-parent[data-editor-id='recap']", this.trueElement).hasClass("editing")) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageWhileEditing`));
      return;
    }
    if (!isRelayableImageType(file.type)) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageTypeRejected`));
      return;
    }
    if (file.size > MAX_RELAY_FILE_BYTES) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageTooLarge`));
      return;
    }
    // A player without FILES_UPLOAD needs an active GM online to relay the
    // upload (hooks/media-relay.mjs's relayUploadMedia) - fail fast with a
    // clear message instead of letting the request time out silently 30s
    // later against nobody.
    if (!game.user.can("FILES_UPLOAD") && !game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageNoGM`));
      return;
    }
    try {
      // Never trust the caller's extension on the direct-upload path either: force it to
      // match the validated MIME, same as the relay path's GM-side enforcedImageName call
      // (hooks/media-relay.mjs handleUploadRequest) - a mismatched pair (evil.html, image/png)
      // must not land on disk as .html regardless of which upload path is taken.
      const name = enforcedImageName(file.name, file.type) ?? file.name;
      const path = game.user.can("FILES_UPLOAD")
        ? await uploadCompanionFile(new File([file], relayFilename(name), { type: file.type }), RELAY_UPLOAD_DIR())
        : await relayUploadMedia(this.document.uuid, file);
      const current = this.document.system?.recap ?? "";
      const img = document.createElement("img");
      img.src = path;
      await this.document.update({ "system.recap": `${current}<p>${img.outerHTML}</p>` });
    } catch (error) {
      console.error(`${MODULE_ID} | image drop/paste into recap failed`, error);
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageUploadFailed`));
    }
  }

  // Redirect MEJ's generic single-actor drop handling (header portrait
  // dropzone, and the base _onDrop's Actor branch) into our attendees list
  // instead of the base class's single `flags.monks-enhanced-journal.actor`
  // flag, which is meaningless for this type.
  async addActor(data) {
    const doc = await this.getDocument(data);
    if (!doc) return;

    const session = sessionData(this.document);
    if (session.attendees.includes(doc.uuid)) return;

    const attendees = [...session.attendees, doc.uuid];
    await this.document.update({ [`${FLAG_SESSION}.attendees`]: attendees });
    ui.notifications.info(game.i18n.format(`${I18N}.session.attendeeAdded`, { name: doc.name }));
    patchSessionRegions(this);
  }

  // The shell toolbar's "edit" control (MEJ expects that id, so it stays):
  // switch to Recap and start typing in it.
  static onFocusRecap(event) {
    if (!this.isEditable) return;
    focusSessionEditor(this, "recap", event);
  }

  /** Open one of the sheet's editors for typing (the prep board's GM Prep link). */
  focusEditor(editorId) {
    focusSessionEditor(this, editorId);
  }

  // MEJ's shell hosts this sheet as a subsheet (see the header comment) and
  // never wires an automatic re-render on document update for it the way a
  // normally-rendered ApplicationV2 sheet gets for free - confirmed live via
  // Task 14's e2e suite (a secret added via document.update() alone never
  // appeared in the DOM without an explicit render(), even 6+ seconds
  // later). Every handler below that mutates document data via a raw
  // document.update()/setFlag() (as opposed to going through the form
  // submission pipeline, which does its own re-render) must refresh the view
  // itself: patchSessionRegions(this) when the change shows in the header or
  // Table talk (spec 2026-10-19 §4.4 - a re-render would take the editors
  // from under the user), this.render() for the Details lists below, whose
  // editors save themselves before the render replaces them.
  static async onAddSecret(event, target) {
    if (!game.user.isGM) return;
    const session = sessionData(this.document);
    const secrets = [...session.secrets, { id: foundry.utils.randomID(), text: "", revealed: false, revealedAt: null }];
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    this.render();
  }

  static async onDeleteSecret(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const item = session.secrets.find((s) => s.id === id);
    if (!(await confirmDelete({ kind: "secret", name: item?.text ?? "" }))) return;
    const secrets = session.secrets.filter((s) => s.id !== id);
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    this.render();
  }

  // The one reveal control for a checklist item (spec §4/§8, 2026-10-15
  // §5.7). "Everyone" is carried by the item's `revealed` flag, named
  // players/groups by `audience`; applyChecklistAudience keeps them in step.
  // Reveal whispers the item text to new recipients.
  static async onSecretAudience(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const item = session.secrets.find((s) => s.id === id);
    if (!item) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const audience = await promptAudience({
      title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`),
      audience: checklistSeed(item), groups
    });
    if (!audience) return;
    // Re-read fresh data after the dialog closes rather than reusing the
    // pre-dialog `session` snapshot: a co-GM or another window may have
    // mutated secrets while this dialog was open, and writing back the
    // stale array would silently revert that concurrent edit. The item may
    // even have been deleted in the meantime - bail with no write if so.
    // The whisper still uses the pre-dialog seed as previousAudience:
    // that's the audience the GM actually saw and compared against in the
    // dialog (an already-everyone item whispers nobody again).
    const current = sessionData(this.document).secrets;
    if (!current.find((s) => s.id === id)) return;
    const secrets = current.map((s) => (s.id === id ? applyChecklistAudience(s, audience) : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    const entryName = this.document.parent?.name ?? this.document.name;
    await fileRevealChange({ entry: this.document.parent, target: this.document, kind: "checklist", id, previous: checklistSeed(item), audience, label: revealLabel("checklist", entryName) });
    await sendRevealWhisper({
      audience, previousAudience: checklistSeed(item), groups,
      html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
      entryUuid: this.document.parent?.uuid ?? this.document.uuid,
      entryName
    });
    this.render();
  }

  static async onUpdateSecretText(event, target) {
    if (!game.user.isGM) return;
    const id = target.dataset.id;
    const session = sessionData(this.document);
    const secrets = session.secrets.map((s) => (s.id === id ? { ...s, text: target.value } : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    // No this.render() here: this fires on "change" (blur), and re-rendering
    // would just redundantly redraw the same text the user already sees -
    // unlike add/delete/toggle, there's no new/removed/changed-shape row.
  }

  static async onRemoveAttendee(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    // Name comes from the clicked row itself (the sheet's own markup), which
    // is element-agnostic; fall back to the actor name when it is missing.
    const name = target.closest("[data-uuid]")?.querySelector?.(".mej-cc-attendee-name")?.textContent?.trim()
      || fromUuidSync(uuid)?.name || "";
    if (!(await confirmDelete({ kind: "attendee", name }))) return;
    const session = sessionData(this.document);
    const attendees = session.attendees.filter((a) => a !== uuid);
    await this.document.update({ [`${FLAG_SESSION}.attendees`]: attendees });
    patchSessionRegions(this);
  }

  static async onManageAttendees() {
    if (!(game.user.isGM || this.document.isOwner)) return;
    const { openAttendeeDialog } = await import("../apps/attendee-dialog.mjs");
    await openAttendeeDialog(this);
  }

  static async onOpenPrepBoard() {
    if (!game.user.isGM) return;
    try {
      const { openPrepBoard } = await import("../apps/prep-board-app.mjs");
      await openPrepBoard({ pageUuid: this.document.uuid });
    } catch (error) {
      console.error(`${MODULE_ID} | prep board open failed`, error);
    }
  }

  // Stale-field guard (spec 2026-09-04, Deviations). MEJ's submitOnChange
  // form resubmits every field, so a submit raised by the session-number
  // input would write back whatever recap HTML this client rendered - stale
  // the moment another owner saved. Only the editor that raised the submit
  // may write its field. The editors save themselves now
  // (session-autosave.mjs writes their one field directly and cancels core's
  // own save), so in practice every editor field is stripped from a form
  // submit; the guard stays for any path that still raises one.
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const target = event?.target;
    const targetName = target?.closest?.("prose-mirror")?.getAttribute("name") ?? target?.name ?? null;
    for (const field of fieldsToStrip(targetName)) foundry.utils.deleteProperty(submitData, field);
    // The notes capture box lives inside this form but is not a document field.
    delete submitData["session-note"];
    return submitData;
  }

  // MEJ's close() asks "You have changes - close anyway?" whenever any
  // <prose-mirror> reports isDirty(), which core's dirty flag never clears.
  // These editors save themselves on close, so there is nothing to ask.
  checkForChanges() {
    flushSessionEditors(this, "close");
    return false;
  }

  // MEJ closes the subsheet before switching its entry tab and before closing
  // the window; both save whatever is typed first.
  async close(options) {
    flushSessionEditors(this, "close");
    return super.close(options);
  }

  // EnhancedJournalSheet's generic disable pass (_toggleDisabled, called
  // before this whenever !this.isEditable) only targets
  // `input, select, textarea, button` - it never reaches a `<prose-mirror>`
  // custom element itself, which is where Foundry's own disabled state
  // actually lives (form-element.mjs: `get/set disabled` reflects the
  // `disabled` attribute on the host element, via `:disabled` matching for
  // formAssociated custom elements). Confirmed live: without this, a
  // non-owner's recap editor rendered fully live-editable
  // (disabled === false) despite the sheet as a whole being non-editable.
  // Only ever called when !this.isEditable (see the base class), so no
  // owner-check is needed here. The recap renders no editor at all for a
  // viewer who cannot edit it (session.hbs), so nothing of it needs disabling.
  _disableFields(form) {
    super._disableFields(form);
    // MEJ's sweep disables every input/button on a page this user cannot edit.
    // The notes capture box is gated by the notes entry's ownership instead
    // (the box only renders when tableTalk.canWrite, and the store enforces
    // it), so a player who merely observes this page can still note. The
    // header's GM Start/End button is re-enabled for a GM for the same reason.
    $('input[name="session-note"], [data-action="captureSessionNote"]', form).prop("disabled", false);
    if (game.user.isGM) $('.mej-cc-session-header .mej-cc-session-button', form).prop("disabled", false);
  }

  // Header comment at the top of this file: any DOM listener beyond the
  // native data-action bindings must be attached here (or subRender), never
  // assumed from an _onRender() override. Paste has no native data-action
  // equivalent, so it's bound directly.
  async activateListeners(html) {
    await super.activateListeners(html);
    this._applyGround(html);
    // A section's actions sit on its <summary>, whose default click action
    // folds the <details>. Cancel only that default: stopping propagation
    // instead would also keep the click from the application's delegated
    // data-action handler.
    $("details.mej-cc-section > summary .mej-cc-section-actions", html).on("click", (event) => event.preventDefault());
    $(".editor-parent[data-editor-id='recap']", html).on("paste", this._onPasteRecapImage.bind(this));
    bindAutosave(this, html);
    this._bindRegions(html);
  }

  /**
   * Listeners inside the header and Table talk regions. Run on every render
   * and again by session-regions.mjs after it swaps a region in (the
   * data-action clicks are delegated by the application and need nothing).
   */
  _bindRegions(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    this._startElapsedClock(root);
    const header = root.querySelector(".mej-cc-session-header");
    if (header && !header.dataset.ccDrop) {
      header.dataset.ccDrop = "1";
      this._attendeeDropZone(".mej-cc-session-header").bind(header);
    }
    if (!this.isEditable) {
      for (const region of root.querySelectorAll("[data-cc-region]")) {
        for (const el of region.querySelectorAll("input, select, textarea, button")) el.disabled = true;
      }
      this._disableFields(root);
    }
    // Notes capture box: Enter files the note; its change events must not
    // reach the sheet's submit-on-change form.
    const noteInput = root.querySelector('input[name="session-note"]');
    if (noteInput && !noteInput.dataset.ccDraft) {
      noteInput.dataset.ccDraft = "1";
      noteInput.addEventListener("change", (event) => event.stopPropagation());
      noteInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this._captureNote(event.currentTarget);
      });
      // A full re-render replaces the box; keep the typed text, focus and caret.
      const key = sessionDraftKey(this.document.uuid);
      trackDraft(noteInput, NOTE_DRAFTS, key);
      restoreDraft(noteInput, NOTE_DRAFTS, key);
    }
  }

  // The sheet sits on MEJ's own ground (spec 2026-10-19 §4.1) and paints none
  // of its own, so its ink has to follow whatever paints underneath. With an
  // image chosen the [background-image] token blocks already do that; with
  // none, MEJ 13.06 still paints parchment under a dark scheme while 14.x
  // paints a dark ground, which CSS alone cannot tell apart - so read the
  // computed ground off the nearest ancestor that paints one.
  _applyGround(html) {
    const root = $(".session-container", html).get(0);
    if (!root) return;
    const measure = () => {
      let backgroundImage = "none";
      for (let el = root.parentElement; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundImage;
        if (bg && bg !== "none") { backgroundImage = bg; break; }
        if (el.classList.contains("monks-enhanced-journal")) break;
      }
      const themed = root.closest(".theme-dark, .theme-light");
      const isDarkScheme = themed ? themed.classList.contains("theme-dark") : document.body.classList.contains("theme-dark");
      root.dataset.mejCcGround = groundTone({ backgroundImage, isDarkScheme });
    };
    measure();
    // MEJ's shell inserts the subsheet before calling activateListeners, but a
    // popped-out sheet can still be detached here; measure again once laid out.
    if (!root.isConnected) requestAnimationFrame(measure);
  }

  // The live chip's elapsed time ticks once a minute; the timer stops itself
  // once its header leaves the DOM (any re-render replaces it).
  _startElapsedClock(html) {
    clearInterval(this._ccElapsedTimer);
    const chip = $(".mej-cc-session-header .mej-cc-session-status.live[data-started-at]", html).get(0);
    if (!chip) return;
    const startedAt = Number(chip.dataset.startedAt);
    const timer = setInterval(() => {
      if (!chip.isConnected) return clearInterval(timer);
      const label = chip.querySelector(".mej-cc-session-elapsed");
      if (label) label.textContent = elapsedLabel(Date.now() - startedAt);
    }, 60_000);
    this._ccElapsedTimer = timer;
  }

  // Full-size view of the session image for this user only (no Share).
  static onViewImage() {
    const src = this.document.src;
    if (!src) return;
    new foundry.applications.apps.ImagePopout({ src, window: { title: this.document.name } }).render(true);
  }

  // Owners pick (or change) the image; Shift-click removes it.
  static async onAddImage(event) {
    if (!this.document.isOwner) return;
    if (event?.shiftKey) {
      if (this.document.src) {
        await this.document.update({ src: null });
        this.render();
      }
      return;
    }
    this._onEditImage(event);
  }

  // --- Notes stream (Plan B) ------------------------------------------------

  // Table talk drawer toggle: this sheet instance only, never persisted. Flips
  // the class in place (the body is always rendered), so nothing re-renders.
  static onToggleTableTalk(event, target) {
    const section = target.closest(".mej-cc-table-talk");
    if (!section) return;
    const open = !section.classList.contains("open");
    this._ccTableTalkOpen = open;
    section.classList.toggle("open", open);
    target.setAttribute("aria-expanded", String(open));
  }

  // Append the Table talk recap draft (the one End used to offer) to the end
  // of the recap, and stamp when, so the link reads "added" and a second click
  // asks first. Same editing guard as _ingestRecapImage: writing the recap
  // under an open collaborative editor would lose the owner's typing.
  static async onAddTableTalkToRecap() {
    if (!this.isEditable) return;
    const campaign = campaignOf(this.document);
    if (!campaign) return;
    if ($(".editor-parent[data-editor-id='recap']", this.trueElement).hasClass("editing")) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.notes.addWhileEditing`));
      return;
    }
    const current = this.document.system?.recap ?? "";
    const plan = tableTalkPlan(notesForSession(readNotes(campaign), this.document.uuid), {
      addedAt: sessionData(this.document).tableTalkAddedAt ?? null, recapHasText: hasVisibleText(current)
    });
    if (!plan.notes.length) {
      ui.notifications.info(game.i18n.localize(`${I18N}.notes.nothingToAdd`));
      return;
    }
    if (plan.kind === "again" || plan.kind === "maybeDuplicate") {
      const content = plan.kind === "again"
        ? game.i18n.localize(`${I18N}.notes.addAgainConfirm`)
        : game.i18n.format(`${I18N}.notes.addMaybeDuplicateConfirm`, { count: plan.notes.length });
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(`${I18N}.notes.addToRecap`) },
        content: `<p>${content}</p>`,
        rejectClose: false
      });
      if (!ok) return;
    }
    const draft = recapDraft(plan.notes, { formatTime: noteTime });
    await this.document.update({ "system.recap": `${current}${draft}`, [`${FLAG_SESSION}.tableTalkAddedAt`]: Date.now() });
    patchSessionRegions(this);
  }

  static async onOpenNoteLink(event, target) {
    event.preventDefault();
    await openNoteLink(target.dataset.kind, target.dataset.target);
  }

  static async onCaptureSessionNote() {
    await this._captureNote($('input[name="session-note"]', this.trueElement).get(0));
  }

  async _captureNote(input) {
    const raw = input?.value ?? "";
    const text = validNoteText(raw);
    const campaign = campaignOf(this.document);
    if (!text || !campaign) return;
    // Clear before awaiting so a double Enter cannot file the note twice; the
    // kept draft goes too, or the re-render this note triggers would restore it.
    const draftKey = sessionDraftKey(this.document.uuid);
    input.value = "";
    clearDraft(NOTE_DRAFTS, draftKey);
    try {
      await addNote(campaign, { text: linkNoteText(campaign, text), sessionUuid: this.document.uuid, worldDate: currentWorldComponents() });
    } catch (err) {
      input.value = raw;
      keepDraft(NOTE_DRAFTS, draftKey, raw);
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    patchSessionRegions(this);
  }

  static async onEditNote(event, target) {
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    const campaign = campaignOf(this.document);
    const note = campaign ? listNotes(campaign, { sessionUuid: this.document.uuid }).find((n) => n.id === id) : null;
    if (!note) return;
    // Stored text is escaped + @UUID shorthand: show plain text, escape once for the textarea.
    const prefill = noteToPlainText(note.text);
    const plain = foundry.utils.escapeHTML(prefill);
    const text = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.notes.edit`) },
      content: `<textarea name="text" rows="4" maxlength="2000" style="width:100%">${plain}</textarea>`,
      ok: { label: game.i18n.localize(`${I18N}.hub.save`), callback: (ev, button) => button.form.elements.text.value },
      rejectClose: false
    });
    // Unchanged text must not stamp the note as edited.
    if (typeof text !== "string" || text === prefill) return;
    try {
      await updateNote(campaign, id, { text: linkNoteText(campaign, text) });
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    patchSessionRegions(this);
  }

  static async onDeleteNote(event, target) {
    const id = target.closest("[data-note-id]")?.dataset.noteId;
    const campaign = campaignOf(this.document);
    if (!id || !campaign) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.notes.delete`) },
      content: `<p>${game.i18n.localize(`${I18N}.notes.deleteConfirm`)}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    try {
      await deleteNote(campaign, id);
    } catch (err) {
      ui.notifications.warn(game.i18n.localize(err?.reason ? `${I18N}.notes.${err.reason}` : `${I18N}.notes.writeFailed`));
    }
    patchSessionRegions(this);
  }

  static async onStartSession() {
    if (!game.user.isGM) return;
    const campaign = campaignOf(this.document);
    if (!campaign) return;
    // One running session per campaign (spec 2026-10-19 §4.2): another page running asks once, and a yes ends
    // it exactly as its own End would before this page starts. No or close leaves both as they are.
    const running = currentSession(campaign);
    if (running && running.uuid !== this.document.uuid) {
      const other = openCampaignSession(campaign);
      const esc = foundry.utils.escapeHTML;
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(`${I18N}.session.replaceTitle`) },
        content: `<p>${game.i18n.format(`${I18N}.session.replaceBody`, { other: esc(other?.name ?? ""), name: esc(this.document.name) })}</p>`,
        rejectClose: false
      });
      if (!ok) return;
      try {
        await endSession(campaign);
      } catch (err) {
        console.error(`${MODULE_ID} | endSession failed`, err);
        ui.notifications.error(game.i18n.localize(`${I18N}.session.endFailed`));
        return;
      }
    }
    // This sheet's own page becomes the open session (startSession validates it belongs to the campaign).
    await SessionSheet.#runSessionAction(this, startSession, "startFailed", { sessionUuid: this.document.uuid });
  }

  static async onEndSession() {
    await SessionSheet.#runSessionAction(this, endSession, "endFailed");
  }

  static async #runSessionAction(sheet, action, failKey, options) {
    if (!game.user.isGM) return;
    const campaign = campaignOf(sheet.document);
    if (!campaign) return;
    try {
      await action(campaign, options);
    } catch (err) {
      console.error(`${MODULE_ID} | ${action.name} failed`, err);
      ui.notifications.error(game.i18n.localize(`${I18N}.session.${failKey}`));
    }
    patchSessionRegions(sheet);
  }
}
