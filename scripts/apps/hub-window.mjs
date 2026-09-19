// The Campaign Hub as its own window, for native mode (a stock MEJ install
// with no extension API, so no shell page to host the Hub as a tab).
//
// In api mode the Hub's document is MEJ's own ephemeral BlankJournal
// placeholder. That class is module-private, so hub-shell-document.mjs
// reproduces its shape - see the spec's "Campaign Hub" section for the live
// verification that CampaignHubPage renders correctly against it through a
// plain render(true).
import { hubShellDocument, setHubSheetClass } from "./hub-shell-document.mjs";

let hubWindow = null;

/**
 * Open the Campaign Hub in its own window, or focus the open one.
 * @returns {Promise<object>} the rendered CampaignHubPage instance
 */
export async function openHubWindow() {
  if (hubWindow?.rendered) {
    hubWindow.bringToFront();
    // Re-render so a pendingTab set by showGraphFor() is consumed now, not on some later unrelated render (pendingTab is consumed in _prepareTabs, which only runs during renders).
    hubWindow.render({ parts: ["main"] });
    return hubWindow;
  }

  const { CampaignHubPage } = await import("./CampaignHubPage.mjs");
  setHubSheetClass(CampaignHubPage);
  const document = hubShellDocument();

  // No `enhancedjournal` option on purpose: EnhancedJournalSheet#trueElement
  // returns this.enhancedjournal ? this.enhancedjournal.subsheetElement :
  // this.element, so leaving it unset points the sheet's own listeners at
  // this window's element.
  hubWindow = new CampaignHubPage({ document, editable: true });
  await hubWindow.render(true);
  return hubWindow;
}
