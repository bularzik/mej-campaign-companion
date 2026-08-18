// The Campaign Hub as its own window, for native mode (a stock MEJ install
// with no extension API, so no shell page to host the Hub as a tab).
//
// In api mode the Hub's document is MEJ's own ephemeral BlankJournal
// placeholder. That class is module-private, so this file reproduces its
// shape - see the spec's "Campaign Hub" section for the live verification
// that CampaignHubPage renders correctly against it through a plain
// render(true).
import { MODULE_ID, HUB_PAGE_ID, I18N } from "../constants.mjs";

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
class HubShellDocument extends foundry.abstract.Document {
  constructor(options) {
    super(options);
    foundry.utils.mergeObject(this, options);
    this.apps = {};
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
    return `${MODULE_ID}-hub`;
  }

  get uuid() {
    return `${MODULE_ID}-hub`;
  }

  get documentName() {
    return "JournalEntryPage";
  }

  get isOwner() {
    return true;
  }

  get compendium() {
    return null;
  }

  testUserPermission() {
    return true;
  }
}

let hubWindow = null;

/**
 * Open the Campaign Hub in its own window, or focus the open one.
 * @returns {Promise<object>} the rendered CampaignHubPage instance
 */
export async function openHubWindow() {
  if (hubWindow?.rendered) {
    hubWindow.bringToFront();
    return hubWindow;
  }

  const { CampaignHubPage } = await import("./CampaignHubPage.mjs");
  const document = new HubShellDocument({
    name: game.i18n.localize(`${I18N}.hub.title`),
    type: HUB_PAGE_ID,
    flags: {},
    content: ""
  });

  // No `enhancedjournal` option on purpose: EnhancedJournalSheet#trueElement
  // returns this.enhancedjournal ? this.enhancedjournal.subsheetElement :
  // this.element, so leaving it unset points the sheet's own listeners at
  // this window's element.
  hubWindow = new CampaignHubPage({ document, editable: true });
  await hubWindow.render(true);
  return hubWindow;
}
