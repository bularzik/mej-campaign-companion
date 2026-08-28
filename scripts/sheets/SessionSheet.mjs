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
import { MODULE_ID, I18N, RELAY_UPLOAD_DIR, PLAYER_GROUPS_SETTING } from "../constants.mjs";
import { sessionData } from "./session-data.mjs";
import { buildRecapEntries } from "../logic/player-recap.mjs";
import { isRelayableImageType, MAX_RELAY_FILE_BYTES, enforcedImageName } from "../logic/media-relay.mjs";
import { savePlayerRecap } from "../hooks/player-recap.mjs";
import { relayUploadMedia, relayFilename } from "../hooks/media-relay.mjs";
import { uploadCompanionFile } from "../apps/import-upload.mjs";
import { getCalendarMonths, sessionMonthOptions } from "../logic/campaign-calendar.mjs";
import { canSee, normalizeAudience } from "../logic/reveal-state.mjs";
import { normalizeGroups } from "../logic/player-groups.mjs";
import { promptAudience, sendRevealWhisper } from "../apps/audience-dialog.mjs";

const FLAG_SESSION = `flags.${MODULE_ID}.session`;

/** Dotted flag path (both for form `name=` binding and document.update) for one user's own recap. */
const myRecapFlag = (userId) => `flags.${MODULE_ID}.playerRecaps.${userId}`;

export class SessionSheet extends EnhancedJournalSheet {
  static DEFAULT_OPTIONS = {
    window: {
      title: `${I18N}.sheettype.session`,
      icon: "fa-solid fa-dice-d20"
    },
    actions: {
      editRecap: SessionSheet.onEditRecap,
      editGmNotes: SessionSheet.onEditGmNotes,
      editPlayerRecap: SessionSheet.onEditPlayerRecap,
      addSecret: SessionSheet.onAddSecret,
      deleteSecret: SessionSheet.onDeleteSecret,
      toggleSecret: SessionSheet.onToggleSecret,
      updateSecretText: SessionSheet.onUpdateSecretText,
      secretAudience: SessionSheet.onSecretAudience,
      removeAttendee: SessionSheet.onRemoveAttendee,
      openPrepBoard: SessionSheet.onOpenPrepBoard
    },
    // Overrides EnhancedJournalSheet's own `form.handler` (a literal static
    // reference set at that base class's own DEFAULT_OPTIONS evaluation
    // time - inheriting the field would keep pointing at
    // EnhancedJournalSheet.onSubmit even with a `static onSubmit` override
    // below, since DEFAULT_OPTIONS.form.handler isn't dynamically resolved
    // per-subclass). See SessionSheet.onSubmit's own doc comment for why
    // this override exists at all.
    form: {
      handler: SessionSheet.onSubmit
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
        "templates/generic/tab-navigation.hbs"
      ],
      scrollable: [
        ".editor-display",
        ".editor-content",
        ".attendees-list",
        ".secrets-list"
      ]
    }
  };

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
          return { ...s, audienceAll: a.all, audienceCount: a.users.length + a.groups.length };
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
          return actor ? { uuid, name: actor.name, img: actor.img } : { uuid, name: uuid, img: "icons/svg/mystery-man.svg" };
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

    // Player recaps: every user (GM included) gets their own editable
    // section on any session they can see; every other user's recap (only
    // once they've actually written something - buildRecapEntries omits
    // empty other-user rows) renders read-only with their name attached.
    // flags["mej-campaign-companion"].playerRecaps is a SIBLING flag key to
    // `.session` (session-data.mjs), never nested inside it - Task 5's
    // reserved shape.
    const recaps = this.document.getFlag(MODULE_ID, "playerRecaps") ?? {};
    const users = game.users.contents.map((u) => ({ id: u.id, name: u.name }));
    const recapEntries = buildRecapEntries(recaps, users, game.user.id);
    const selfEntry = recapEntries.find((e) => e.isSelf);
    context.userId = game.user.id;
    context.myRecap = selfEntry?.html ?? "";
    context.enrichedMyRecap = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      context.myRecap, enrichmentOptions
    );
    context.otherRecaps = await Promise.all(
      recapEntries
        .filter((e) => !e.isSelf)
        .map(async (e) => ({
          userId: e.userId,
          name: e.name,
          enrichedHtml: await foundry.applications.ux.TextEditor.implementation.enrichHTML(e.html, enrichmentOptions)
        }))
    );

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

    // Every user (not gated on document ownership - see _canDragDrop's
    // comment above for why that guard doesn't apply here) can drop an
    // image file onto their OWN recap section. File drops carry no `type`
    // TextEditor.getDragEventData() would recognize (that's for Foundry
    // document links), so this is a separate DragDrop instance reading
    // event.dataTransfer.files directly, rather than reusing _onDropAttendee's
    // getDragEventData path.
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".player-recap-self",
      permissions: {
        drop: () => true
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
    event.preventDefault();
    for (const file of files) await this._ingestRecapImage(file);
  }

  /**
   * Upload (directly if the user already holds FILES_UPLOAD, otherwise
   * relayed through the active GM - see hooks/media-relay.mjs) and append
   * the result into the user's own recap. Both paths land in the same
   * RELAY_UPLOAD_DIR() and share the same type/size validation up front, so
   * the player-facing outcome (accepted, or a specific rejection reason) is
   * identical regardless of which upload path is actually used.
   */
  async _ingestRecapImage(file) {
    if (!isRelayableImageType(file.type)) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageTypeRejected`));
      return;
    }
    if (file.size > MAX_RELAY_FILE_BYTES) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.session.recapImageTooLarge`));
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
      const recaps = this.document.getFlag(MODULE_ID, "playerRecaps") ?? {};
      const current = recaps[game.user.id] ?? "";
      const img = document.createElement("img");
      img.src = path;
      await savePlayerRecap(this.document, `${current}<p>${img.outerHTML}</p>`);
      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | image drop/paste into player recap failed`, error);
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
    let editing = $(".editor-parent[data-editor-id='recap']", this.trueElement).hasClass("editing");
    $(".editor-parent[data-editor-id='recap']", this.trueElement).toggleClass("editing", !editing);
    $(".nav-button.edit i", this.enhancedjournal?.element || this.element).toggleClass("fa-pencil-alt", editing).toggleClass("fa-save", !editing);
  }

  static onEditGmNotes(event, target) {
    const editing = $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).hasClass("editing");
    $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).toggleClass("editing", !editing);
  }

  // No isEditable/isOwner gate, unlike onEditRecap - every user (not just
  // the document's owner) can toggle and edit their OWN recap section. The
  // underlying prose-mirror control being reachable at all when
  // !this.isEditable additionally depends on _disableFields's re-enable
  // below (mirroring EnhancedJournalSheet's own precedent for its "notes"
  // tab - see that method's doc comment).
  static onEditPlayerRecap(event, target) {
    const editing = $(".editor-parent[data-editor-id='playerRecap']", this.trueElement).hasClass("editing");
    $(".editor-parent[data-editor-id='playerRecap']", this.trueElement).toggleClass("editing", !editing);
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
    const secrets = session.secrets.filter((s) => s.id !== id);
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    this.render();
  }

  static async onToggleSecret(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const secrets = session.secrets.map((s) => {
      if (s.id !== id) return s;
      const revealed = !s.revealed;
      return { ...s, revealed, revealedAt: revealed ? Date.now() : null };
    });
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    this.render();
  }

  // Per-player/group reveal for one checklist item (spec §4/§8). "Everyone"
  // remains onToggleSecret's revealed flag; this dialog manages the
  // audience field. Reveal whispers the item text to new recipients.
  static async onSecretAudience(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const item = session.secrets.find((s) => s.id === id);
    if (!item) return;
    const groups = normalizeGroups(game.settings.get(MODULE_ID, PLAYER_GROUPS_SETTING));
    const audience = await promptAudience({
      title: game.i18n.localize(`${I18N}.secrets.checklistRevealTitle`),
      audience: item.audience, groups
    });
    if (!audience) return;
    // Re-read fresh data after the dialog closes rather than reusing the
    // pre-dialog `session` snapshot: a co-GM or another window may have
    // mutated secrets while this dialog was open, and writing back the
    // stale array would silently revert that concurrent edit. The item may
    // even have been deleted in the meantime - bail with no write if so.
    // The whisper still uses the pre-dialog item.audience as
    // previousAudience: that's the audience the GM actually saw and
    // compared against in the dialog.
    const current = sessionData(this.document).secrets;
    if (!current.find((s) => s.id === id)) return;
    const secrets = current.map((s) => (s.id === id ? { ...s, audience } : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
    await sendRevealWhisper({
      audience, previousAudience: item.audience, groups,
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

  // EnhancedJournalSheet's own onSubmit (sheets/EnhancedJournalSheet.js)
  // special-cases exactly ONE flag namespace for the "write my own field
  // even though I don't own this document" relay path:
  // `flags.monks-enhanced-journal.<userId>` (its own per-user "notes" tab,
  // relayed via the "saveUserData" socket action). Our own
  // `flags.mej-campaign-companion.playerRecaps.<userId>` falls through that
  // check untouched, so a non-owner player's recap edit would otherwise be
  // silently dropped on submit. This override intercepts our own field
  // first (via savePlayerRecap's own owner-vs-relay branch, mirroring
  // saveUserData's pattern under our own namespace - see
  // hooks/player-recap.mjs) and only falls through to `super.onSubmit` when
  // the user is a genuine document owner/GM (so every other field - session
  // number, attendees, secrets, gmNotes, etc. - keeps saving exactly as
  // before). When not editable, nothing else in the form should be
  // submittable by this user anyway (secrets/attendees are separately
  // GM-gated in their own action handlers, not via form submission), so
  // super.onSubmit is skipped entirely rather than invoked for a no-op.
  static async onSubmit(event, form, formData) {
    const submitData = this._prepareSubmitData(event, form, formData, {});
    const recapHtml = foundry.utils.getProperty(submitData, myRecapFlag(game.user.id));
    if (recapHtml !== undefined) {
      // Awaited, not fire-and-forget (C4). On the relay path savePlayerRecap
      // only emits a socket and resolves immediately, so awaiting costs
      // nothing - but on the OWNER path it issues a document.update() of its
      // own, and super.onSubmit below updates the same document. Leaving both
      // in flight at once raced two writes against one document. The catch
      // stays so a failed recap save still can't block the rest of the form.
      await savePlayerRecap(this.document, recapHtml)
        .catch((err) => console.error(`${MODULE_ID} | saving player recap failed`, err));
    }
    if (this.isEditable) return super.onSubmit(event, form, formData);
    return true;
  }

  // Mirrors EnhancedJournalSheet's own _disableFields precedent for its
  // "notes" tab exactly (sheets/EnhancedJournalSheet.js): the base
  // ApplicationV2 render lifecycle disables every form control when
  // `!this.isEditable`, then `_disableFields` selectively re-enables the
  // ones that should stay live regardless of document ownership. Without
  // this override our player-recap pencil button and its prose-mirror's
  // internal <textarea> (the custom element's underlying form-associated
  // control - confirmed against the base class's own equivalent selector
  // for its notes prose-mirror) would stay disabled for every non-owner
  // player, making the recap section rendered-but-inert.
  _disableFields(form) {
    super._disableFields(form);
    const hasGM = game.users.some((u) => u.isGM && u.active);
    if (!hasGM) return;
    $(".player-recap-self .editor-edit", form).removeAttr("disabled");
    $(`textarea[name="${myRecapFlag(game.user.id)}"]`, form).removeAttr("disabled").removeAttr("readonly");
  }

  // Companion half of the same "notes"-tab precedent: EnhancedJournalSheet's
  // own subRender() re-enables its notes prose-mirror on its internal "open"
  // event once a GM comes online mid-session, scoped to `.notes-container`.
  // That selector doesn't reach our own player-recap element, so this
  // mirrors it under `.player-recap-self` instead.
  async subRender(context, options) {
    await super.subRender(context, options);
    const hasGM = game.users.some((u) => u.isGM && u.active);
    if (hasGM) {
      $(".player-recap-self .editor-edit", this.trueElement).removeAttr("disabled");
      const editor = $(".player-recap-self prose-mirror.editor", this.trueElement).on("open", (ev) => {
        editor.get(0).disabled = false;
      });
    }
  }

  // Header comment at the top of this file: any DOM listener beyond the
  // native data-action bindings must be attached here (or subRender), never
  // assumed from an _onRender() override. Paste has no native data-action
  // equivalent, so it's bound directly.
  async activateListeners(html) {
    await super.activateListeners(html);
    $(".player-recap-self", html).on("paste", this._onPasteRecapImage.bind(this));
  }
}
