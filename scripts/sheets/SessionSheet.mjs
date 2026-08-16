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
import { MODULE_ID, I18N } from "../constants.mjs";
import { sessionData } from "./session-data.mjs";

const FLAG_SESSION = `flags.${MODULE_ID}.session`;

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
      toggleSecret: SessionSheet.onToggleSecret,
      updateSecretText: SessionSheet.onUpdateSecretText,
      removeAttendee: SessionSheet.onRemoveAttendee
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

    context.relationships = await this.getRelationships();
    context.has = { relationships: Object.keys(context.relationships || {})?.length > 0 };
    context.placeholder = `${I18N}.placeholder.session`;

    // Secrets are only meaningful once revealed to players - a non-GM
    // context must never carry an unrevealed secret's text (same
    // data-minimization requirement as gmNotes below: excluded from the
    // context object entirely, not just hidden by the template/CSS).
    context.secrets = isGM
      ? session.secrets
      : session.secrets.filter((s) => s.revealed).map(({ id, text, revealedAt }) => ({ id, text, revealedAt }));

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
  }

  async _onDropAttendee(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data.type === "Actor") await this.addActor(data);
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

  static async onAddSecret(event, target) {
    if (!game.user.isGM) return;
    const session = sessionData(this.document);
    const secrets = [...session.secrets, { id: foundry.utils.randomID(), text: "", revealed: false, revealedAt: null }];
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
  }

  static async onDeleteSecret(event, target) {
    if (!game.user.isGM) return;
    const id = target.closest("[data-id]")?.dataset.id;
    const session = sessionData(this.document);
    const secrets = session.secrets.filter((s) => s.id !== id);
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
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
  }

  static async onUpdateSecretText(event, target) {
    if (!game.user.isGM) return;
    const id = target.dataset.id;
    const session = sessionData(this.document);
    const secrets = session.secrets.map((s) => (s.id === id ? { ...s, text: target.value } : s));
    await this.document.update({ [`${FLAG_SESSION}.secrets`]: secrets });
  }

  static async onRemoveAttendee(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const session = sessionData(this.document);
    const attendees = session.attendees.filter((a) => a !== uuid);
    await this.document.update({ [`${FLAG_SESSION}.attendees`]: attendees });
  }
}
