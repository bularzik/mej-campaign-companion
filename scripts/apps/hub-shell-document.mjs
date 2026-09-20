// The Campaign Hub's placeholder document, shared by both hosting paths (the
// standalone Hub window and the native-mode shell shim). In api mode the
// Hub's document is MEJ's own ephemeral BlankJournal placeholder. That class
// is module-private, so this file reproduces its shape - see the spec's
// "Campaign Hub" section for the live verification that CampaignHubPage
// renders correctly against it through a plain render(true).
//
// type stays HUB_PAGE_ID: Foundry 13's Hub-window failure (5d50f39) was a
// start-up race in openHub(), not a type mismatch, so this placeholder's
// `type` is unchanged from the window-only version.
import { HUB_PAGE_ID, I18N } from "../constants.mjs";
import { shellPageId } from "../logic/shell-shim-logic.mjs";

let hubSheetClass = null;
let singleton = null;

/** The sheet class the shell should construct for the Hub tab (CampaignHubPage). */
export function setHubSheetClass(cls) {
  hubSheetClass = cls;
}

/**
 * Stand-in for MEJ's private BlankJournal. Every member matters:
 *  - id/uuid/documentName: the sheet stamps these onto its root element.
 *  - isOwner: DocumentSheetV2 derives `editable` from it.
 *  - compendium: foundry.abstract.Document#compendium is abstract and throws;
 *    a real non-compendium document reports null.
 *  - testUserPermission: the schema has no ownership field, so the inherited
 *    implementation always resolves NONE and non-GM viewers would be refused.
 *  - apps: DocumentSheetV2._onFirstRender writes itself into it.
 */
export class HubShellDocument extends foundry.abstract.Document {
  constructor(options) {
    super(options);
    foundry.utils.mergeObject(this, options);
    this.apps = {};
    // MEJ's renderSubSheet writes ownership[userId] = OBSERVER when it is
    // asked to force-open a tab (apps/enhanced-journal.js, 13.06 :466-473).
    this.ownership = {};
  }

  static defineSchema() {
    return {
      name: new foundry.data.fields.StringField({ required: false, blank: true }),
      type: new foundry.data.fields.StringField({ required: true, blank: true, initial: HUB_PAGE_ID }),
      content: new foundry.data.fields.StringField({ required: false, blank: true }),
      options: new foundry.data.fields.SchemaField({
        hidebuttons: new foundry.data.fields.BooleanField({ initial: true }),
        position: new foundry.data.fields.ObjectField(),
        window: new foundry.data.fields.ObjectField()
      }),
      flags: new foundry.data.fields.DocumentFlagsField()
    };
  }

  get id() {
    return HUB_PAGE_ID;
  }

  // Unique, dotless, and impossible for a real document uuid to contain:
  // MEJ's open() matches tabs with `t.entityId?.includes(entity.id)` and
  // findEntity() treats ids with a "." as uuids (13.06 :866-887, :1274).
  get uuid() {
    return shellPageId(HUB_PAGE_ID);
  }

  get documentName() {
    return "JournalEntryPage";
  }

  get isOwner() {
    return true;
  }

  // MEJ's EnhancedJournalSheet.isEditable reads `document.permission ==
  // OWNER` — a ClientDocument getter this bare-Document stub doesn't
  // inherit. Without it the comparison sees undefined, isEditable goes
  // false, and MEJ's _toggleDisabled disables every control in the
  // standalone Hub window (found live against stock MEJ 14.01; applies in
  // native mode on any MEJ build).
  get permission() {
    return CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }

  get compendium() {
    return null;
  }

  // fixType's else-branch calls unsetFlag on a document whose type MEJ's
  // registry does not know - which is exactly the Hub placeholder whenever
  // the shim is NOT installed (window hosting). Document#setFlag/#unsetFlag
  // route through update(), which this parentless, collection-less stub
  // cannot survive. The placeholder's flags are fixed at construction, so
  // both writes are no-ops; getFlag stays inherited and reads them.
  async setFlag() {
    return this;
  }

  async unsetFlag() {
    return this;
  }

  // The same reasoning one level down, and load-bearing for shell hosting:
  // MEJ's shell submits its subsheet's form on every change
  // (EnhancedJournal._onChangeForm -> _onSubmitForm ->
  // EnhancedJournalSheet.onSubmit, 13.06 sheets/EnhancedJournalSheet.js:1460,
  // which ends in `return this.document.update(submitData)`). On a real page
  // that persists the edit; on this parentless, collection-less stub it
  // reaches Foundry's ClientDatabaseBackend, whose #preUpdateDocumentArray
  // dereferences the document's collection unconditionally (Foundry 13.351
  // foundry.mjs:58726) and rejects with "Cannot read properties of undefined
  // (reading 'get')". The rejection is unhandled, so the Hub kept working and
  // only the console said anything - which is exactly how it surfaced: eight
  // v13 sweep tests failed on assertNoConsoleErrors, not on behaviour, every
  // one of them right after touching a Hub form control (the campaign-scope
  // select, a filter chip). Every Hub control persists through the
  // companion's own client settings and through flags on real documents, so
  // there is nothing here to write.
  async update() {
    return this;
  }

  testUserPermission() {
    return true;
  }

  // The load-bearing member for shell hosting: MEJ's subsheet selector is
  // `this.document._getSheetClass ? this.document._getSheetClass() : null`
  // (13.06 apps/enhanced-journal.js:486, identical on 14.01).
  _getSheetClass() {
    return hubSheetClass;
  }
}

/**
 * The one Hub placeholder this client uses, in both hosting paths.
 *
 * The MEJ type flag is not decoration: renderSubSheet hands every non-blank
 * document to MonksEnhancedJournal.fixType, which reads
 * `object.parent.documentName` whenever that flag is missing
 * (monks-enhanced-journal.js, 13.06 :4115-4120) and throws "Cannot read
 * properties of null (reading 'documentName')" on a placeholder that has no
 * parent - confirmed live on 13.06 before it was stamped. MEJ's own
 * BlankJournal carries the same flag for the same reason. With it, and with
 * the shim's getDocumentTypes wrap registering the type, fixType's tail
 * re-asserts the type it already has instead of unsetting the flag.
 */
export function hubShellDocument() {
  singleton ??= new HubShellDocument({
    name: game.i18n.localize(`${I18N}.hub.title`),
    type: HUB_PAGE_ID,
    flags: { "monks-enhanced-journal": { type: HUB_PAGE_ID } },
    content: ""
  });
  return singleton;
}
