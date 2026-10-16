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
import { sessionHeaderContext } from "../logic/session-header.mjs";
import { isRelayableImageType, MAX_RELAY_FILE_BYTES, enforcedImageName } from "../logic/media-relay.mjs";
import { fieldsToStrip } from "../logic/session-submit.mjs";
import { shouldCommitGmNotes } from "../logic/gm-notes-commit.mjs";
import { relayUploadMedia, relayFilename } from "../hooks/media-relay.mjs";
import { uploadCompanionFile } from "../apps/import-upload.mjs";
import { getCalendarMonths, sessionMonthOptions, currentWorldComponents } from "../logic/campaign-calendar.mjs";
import { campaignOf } from "../logic/campaigns.mjs";
import { listNotes, notesEntryOf, addNote, updateNote, deleteNote } from "../data/notes-store.mjs";
import { linkNoteText, enrichNoteText } from "../hooks/note-links.mjs";
import { noteToPlainText } from "../logic/note-text.mjs";
import { currentSession } from "../logic/current-session.mjs";
// The hooks module's openSessionPage (the campaign's open Session page); a different openSessionPage lives in integrations/mej-adapter.mjs.
import { openSessionPage as openCampaignSession, startSession, endSession } from "../hooks/current-session.mjs";
import { tonightContext, streamRows } from "../logic/tonight.mjs";
import { validNoteText } from "../logic/notes.mjs";
import { NOTE_DRAFTS, sessionDraftKey, trackDraft, restoreDraft, clearDraft, keepDraft } from "../logic/input-draft.mjs";
import { canSee, normalizeAudience } from "../logic/reveal-state.mjs";
import { applyChecklistAudience, checklistSeed } from "../logic/checklist-reveal.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const FLAG_SESSION = `flags.${MODULE_ID}.session`;

// Commit the GM-notes editor through the element's PUBLIC value property.
// `get value` is the live editor content while the editor is active (core's
// own _getValue, foundry.mjs 13.351:72762 / 14.368:97393) and the stored
// value otherwise; `set value` stores it and fires the bubbling "change"
// that MEJ's submit-on-change form turns into a submit with this element as
// event.target (AbstractFormInputElement 13.351:70329 / 14.368:41256), which
// SessionSheet._prepareSubmitData's stale-field guard keeps because the
// target names system.gmNotes. Those are the same two steps core's own
// save() performs for a non-toggled editor - but save() is private (#save)
// on Foundry 13, where calling it threw and the notes were never written
// (v13 sweep report, cause I). _refresh() after the set is a no-op while
// the editor is active. A throw here is a real defect, so it is logged and
// shown; the caller's .editing toggle runs regardless.
function commitGmNotes(editor, stored) {
  if (!editor) return;
  try {
    const live = editor.value;
    if (shouldCommitGmNotes(live, stored)) editor.value = live;
  } catch (err) {
    console.error(`${MODULE_ID} | GM notes could not be saved`, err);
    ui.notifications.error(game.i18n.localize(`${I18N}.session.gmNotesSaveFailed`));
  }
}

export class SessionSheet extends EnhancedJournalSheet {
  static DEFAULT_OPTIONS = {
    window: {
      title: `${I18N}.sheettype.session`,
      icon: "fa-solid fa-dice-d20"
    },
    actions: {
      editRecap: SessionSheet.onEditRecap,
      editGmNotes: SessionSheet.onEditGmNotes,
      addSecret: SessionSheet.onAddSecret,
      deleteSecret: SessionSheet.onDeleteSecret,
      updateSecretText: SessionSheet.onUpdateSecretText,
      secretAudience: SessionSheet.onSecretAudience,
      removeAttendee: SessionSheet.onRemoveAttendee,
      openPrepBoard: SessionSheet.onOpenPrepBoard,
      captureSessionNote: SessionSheet.onCaptureSessionNote,
      editNote: SessionSheet.onEditNote,
      deleteNote: SessionSheet.onDeleteNote,
      startSession: SessionSheet.onStartSession,
      endSession: SessionSheet.onEndSession
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/session.hbs`,
      templates: [
        "modules/monks-enhanced-journal/templates/sheets/partials/sheet-detailed-header.hbs",
        "modules/monks-enhanced-journal/templates/sheets/partials/sheet-relationships.hbs",
        "modules/monks-enhanced-journal/templates/sheets/partials/sheet-notes.hbs",
        "templates/generic/tab-navigation.hbs",
        `modules/${MODULE_ID}/templates/hub-tonight.hbs`
      ],
      scrollable: [
        ".editor-display",
        ".editor-content",
        ".attendees-list",
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

  async _prepareBodyContext(context, options) {
    context = await super._prepareBodyContext(context, options);

    const isGM = game.user.isGM;
    const session = sessionData(this.document);

    // MEJ's shared header partial (session.hbs:4) iterates `fields`; see
    // logic/session-header.mjs for what core leaves there and why.
    Object.assign(context, sessionHeaderContext({
      src: context.data?.src ?? null,
      editable: context.editable ?? this.isEditable
    }));

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

    const enrichmentOptions = { relativeTo: this.document, secrets: this.document.isOwner, async: true };
    context.enrichedRecap = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.document.system?.recap ?? "",
      enrichmentOptions
    );

    // gmNotes: excluded from the context entirely for non-GM users - a
    // player's client never receives this HTML in any form, DOM or otherwise.
    if (isGM) {
      context.enrichedGmNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        this.document.system?.gmNotes ?? "",
        enrichmentOptions
      );
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

    // Notes stream + Tonight strip (Plan B). Stored note text is escaped plus
    // @UUID shorthand only (linkNoteText), so enriched output is safe for {{{ }}}.
    const campaign = campaignOf(this.document);
    if (campaign) {
      const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const rows = streamRows(listNotes(campaign, { sessionUuid: this.document.uuid }), game.user, { formatTime });
      context.notesStream = {
        canWrite: !!notesEntryOf(campaign)?.isOwner,
        rows: await Promise.all(rows.map(async (r) => ({ ...r, text: await enrichNoteText(r.text) })))
      };
      const open = openCampaignSession(campaign);
      const cs = currentSession(campaign);
      // The strip only reports state here (canWrite false: no capture box of its own); the stream's box is the capture.
      const tonight = tonightContext({
        campaign, session: open && cs ? { uuid: open.uuid, name: open.name, startedAt: cs.startedAt } : null,
        notes: listNotes(campaign), user: game.user, formatTime, canWrite: false
      });
      if (tonight) tonight.recent = await Promise.all(tonight.recent.map(async (n) => ({ ...n, text: await enrichNoteText(n.text) })));
      context.tonight = tonight;
    } else {
      context.notesStream = { canWrite: false, rows: [] };
      context.tonight = null;
    }

    return context;
  }

  _documentControls() {
    let ctrls = [
      { label: '<i class="fas fa-search"></i>', type: "text" },
      { id: "search", type: "input", label: game.i18n.localize("MonksEnhancedJournal.SearchDescription"), visible: !!this.enhancedjournal, callback: this.searchText },
      { id: "show", label: game.i18n.localize("MonksEnhancedJournal.ShowToPlayers"), icon: "fas fa-eye", visible: game.user.isGM, action: "showPlayers" },
      { id: "edit", label: game.i18n.localize("MonksEnhancedJournal.EditDescription"), icon: "fas fa-pencil-alt", visible: this.isEditable, action: "editRecap" }
    ];
    return ctrls.concat(super._documentControls());
  }

  _canDragDrop(selector) {
    return game.user.isGM || this.document.isOwner;
  }

  _dragDrop(html) {
    super._dragDrop(html);

    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".attendees-list",
      permissions: {
        drop: () => game.user.isGM || this.document.isOwner
      },
      callbacks: {
        drop: this._onDropAttendee.bind(this)
      }
    }).bind(html);

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

  async _onDropAttendee(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type === "Actor") await this.addActor(data);
  }

  async _onDropRecapImage(event) {
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type?.startsWith("image/"));
    if (!files.length) return; // not a file drop (e.g. a stray Actor drag) - nothing for us to do
    event.preventDefault();
    event.stopPropagation();
    for (const file of files) await this._ingestRecapImage(file);
  }

  async _onPasteRecapImage(event) {
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
    // Review round 2, finding 4 (plan-mandated, overrides the original
    // brief): appending to the persisted recap and re-rendering while the
    // live collaborative editor is open would tear that editor down on the
    // very next save, silently losing whatever the owner was mid-typing.
    // Owners with upload permission still have the editor's own image
    // tools available while editing.
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
      this.render();
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
  }

  // Mirrors EnhancedJournalSheet.onEditDescription (sheets/EnhancedJournalSheet.js)
  // exactly, targeting the "recap" editor id instead of "description" - this
  // is both the inline editor-edit pencil's action (data-action="editRecap"
  // in the description tab) AND, via _documentControls()'s "edit" control,
  // the shell header's toolbar pencil button. Sharing one handler for both
  // paths keeps the header button's tab-switch and its pencil/save icon
  // state in sync with the inline button rather than letting the two drift.
  static onEditRecap(event, target) {
    if (!this.isEditable) return null;

    let navElement = $(".sheet-tabs.tabs", this.trueElement).get(0);
    if (this.tabGroups["primary"])
      this.changeTab.call(this.enhancedjournal || this, "description", "primary", { event, navElement });

    // The recap prose-mirror is `toggled` (template comment explains why):
    // its own activation/collaborative join only ever starts here, on the
    // pencil, never at render time. Setting `open` false when leaving edit
    // calls the element's own save() (prosemirror-editor.mjs), which fires
    // "change" (picked up by MEJ's submitOnChange -> our _prepareSubmitData
    // stale-field guard, event.target is this element) and then destroys
    // the editor/ends the collab session - matching a manual save exactly.
    //
    // Review round 2, finding 2: `opening` is derived from the element's
    // own `open` property, not from the `.editing` CSS class - core's
    // save() also runs from the editor's own native save button, Ctrl+S,
    // and disconnectedCallback, all of which close the editor WITHOUT this
    // action ever running (the activateListeners "close" handler below is
    // what keeps `.editing`/the nav icon in sync for those paths). Reading
    // the class here instead of the element itself would let this action
    // and that handler fight over which one is "current". State is set
    // explicitly (not a blind two-argument-less toggle) from that one
    // source of truth.
    const editor = this.trueElement?.querySelector?.(".editor-parent[data-editor-id='recap'] prose-mirror")
      ?? $(".editor-parent[data-editor-id='recap'] prose-mirror", this.trueElement).get(0);
    const opening = !(editor?.open ?? false);
    $(".editor-parent[data-editor-id='recap']", this.trueElement).toggleClass("editing", opening);
    $(".nav-button.edit i", this.enhancedjournal?.element || this.element).toggleClass("fa-pencil-alt", !opening).toggleClass("fa-save", opening);
    if (editor) editor.open = opening;
  }

  static onEditGmNotes(event, target) {
    const editing = $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).hasClass("editing");
    // Unlike the recap editor, gmNotes is not toggled (no collaborative
    // join to manage) - it activates at render time and just stays active,
    // so the pencil here is purely a CSS show/hide. That means the pencil is
    // ALSO this editor's only commit point: nothing else ever saves it (no
    // toggle -> no open=false -> save() chain the way the recap editor gets
    // from onEditRecap above). Commit explicitly, BEFORE removing .editing,
    // while closing - see commitGmNotes above for why that goes through the
    // element's public `value` and not its save() (private on Foundry 13).
    if (editing) {
      const editor = this.trueElement?.querySelector?.("prose-mirror[name='system.gmNotes']");
      commitGmNotes(editor, this.document?.system?.gmNotes);
    }
    $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).toggleClass("editing", !editing);
  }

  // MEJ's shell hosts this sheet as a subsheet (see the header comment) and
  // never wires an automatic re-render on document update for it the way a
  // normally-rendered ApplicationV2 sheet gets for free - confirmed live via
  // Task 14's e2e suite (a secret added via document.update() alone never
  // appeared in the DOM without an explicit render(), even 6+ seconds
  // later). Every handler below that mutates document data via a raw
  // document.update()/setFlag() (as opposed to going through the form
  // submission pipeline, which does its own re-render) must call
  // this.render() itself, matching the existing pattern in
  // _ingestRecapImage() above.
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
    await sendRevealWhisper({
      audience, previousAudience: checklistSeed(item), groups,
      html: `<p>${foundry.utils.escapeHTML(item.text)}</p>`,
      entryUuid: this.document.parent?.uuid ?? this.document.uuid,
      entryName: this.document.parent?.name ?? this.document.name
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
    this.render();
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
  // input would write back whatever recap HTML this client rendered -
  // stale the moment another owner saved. Only the editor that raised the
  // submit, or an editor that is currently open, may write its field; every
  // other submit leaves the rest of the rich text fields alone. The change
  // event bubbles from the <prose-mirror> itself, so event.target is that
  // element. "Currently open" is read straight off the live elements
  // (`open === true` and the `active` class core adds once
  // #activateEditor() finishes - see prosemirror-editor.mjs) rather than
  // trusted from anywhere else: gmNotes is untoggled and so active from
  // render (its field is effectively never stripped), while the recap
  // editor is toggled and only active while a participant has it open -
  // exactly the case where its live value is fresher than whatever this
  // client last rendered.
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const target = event?.target;
    const targetName = target?.closest?.("prose-mirror")?.getAttribute("name") ?? target?.name ?? null;
    const activeFields = [...form.querySelectorAll("prose-mirror[name]")]
      .filter((el) => el.open === true && el.classList.contains("active"))
      .map((el) => el.getAttribute("name"));
    for (const field of fieldsToStrip(targetName, activeFields)) foundry.utils.deleteProperty(submitData, field);
    // The notes capture box lives inside this form but is not a document field.
    delete submitData["session-note"];
    return submitData;
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
  // owner-check is needed here.
  _disableFields(form) {
    super._disableFields(form);
    $(".editor-parent[data-editor-id='recap'] prose-mirror", form).prop("disabled", true);
    // MEJ's sweep disables every input/button on a page this user cannot edit.
    // The notes capture box is gated by the notes entry's ownership instead
    // (the box only renders when notesStream.canWrite, and the store enforces
    // it), so a player who merely observes this page can still note. The
    // strip's GM Start/End buttons are re-enabled for a GM for the same reason.
    $('input[name="session-note"], [data-action="captureSessionNote"]', form).prop("disabled", false);
    if (game.user.isGM) $('[data-cc-tonight] [data-action="startSession"], [data-cc-tonight] [data-action="endSession"]', form).prop("disabled", false);
  }

  // Header comment at the top of this file: any DOM listener beyond the
  // native data-action bindings must be attached here (or subRender), never
  // assumed from an _onRender() override. Paste has no native data-action
  // equivalent, so it's bound directly.
  async activateListeners(html) {
    await super.activateListeners(html);
    $(".editor-parent[data-editor-id='recap']", html).on("paste", this._onPasteRecapImage.bind(this));

    // Review round 2, finding 2. Core fires "close" on a toggled
    // <prose-mirror> (prosemirror-editor.mjs save()) whenever it
    // deactivates - not only via onEditRecap above, but also from the
    // editor's own native save button, Ctrl+S, and disconnectedCallback
    // (confirmed against that file: save() dispatches "close" for every
    // toggled deactivation path). Any of those leaves `.editing` on the
    // parent stuck and MEJ's own CSS then hides both the read view and the
    // pencil (`.editing .editor-display, .editing .editor-edit { display:
    // none }`) while our own CSS hides the element's native toggle button -
    // no way back in without this. Idempotent (removing an absent class is
    // a no-op), so it's safe regardless of which path fired it, including
    // a re-render mid-close.
    $(".editor-parent[data-editor-id='recap'] prose-mirror", html).on("close", () => {
      $(".editor-parent[data-editor-id='recap']", html).removeClass("editing");
      $(".nav-button.edit i", this.enhancedjournal?.element || this.element).removeClass("fa-save").addClass("fa-pencil-alt");
    });

    // Notes capture box: Enter files the note; its change events must not
    // reach the sheet's submit-on-change form.
    $('input[name="session-note"]', html)
      .on("change", (event) => event.stopPropagation())
      .on("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this._captureNote(event.currentTarget);
      });
    // Every other author's note re-renders this view; keep the typed text, focus and caret.
    const noteInput = $('input[name="session-note"]', html).get(0);
    if (noteInput && !noteInput.dataset.ccDraft) {
      noteInput.dataset.ccDraft = "1";
      const key = sessionDraftKey(this.document.uuid);
      trackDraft(noteInput, NOTE_DRAFTS, key);
      restoreDraft(noteInput, NOTE_DRAFTS, key);
    }
  }

  // --- Notes stream (Plan B) ------------------------------------------------

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
    this.render();
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
    this.render();
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
    this.render();
  }

  static async onStartSession() {
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
    sheet.render();
  }
}
