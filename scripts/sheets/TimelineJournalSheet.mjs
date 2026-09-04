// The JournalEntry sheet a timeline journal is stamped with
// (flags.core.sheetClass = TIMELINE_SHEET_CLASS, constants.mjs). It never
// draws: a timeline journal is a page-less data holder, and the thing to
// LOOK at is the Hub's Timeline tab - so every open (sidebar row, @UUID
// link, entry.sheet.render(true), MEJ's fall-through after
// hooks/timeline-open.mjs returns false) hands off there. `rendered` stays
// false, so Foundry's open handlers treat every click as a fresh open.
//
// CampaignHubPage.mjs statically imports MEJ's EnhancedJournalSheet.js, so
// it is imported lazily here (same reason as hooks/folder-context.mjs).
//
// Base class: DocumentSheetV2, not a bare ApplicationV2 - Foundry v14's
// DocumentSheetConfig.registerSheet (foundry.mjs ~40530) hard-rejects
// anything that is not a subclass of foundry.appv1.api.Application or
// foundry.applications.api.DocumentSheetV2. DocumentSheetV2's own
// constructor stores options.document behind a read-only `document` getter,
// so there is nothing to add here; `viewPermission` never applies because
// render() below never reaches ApplicationV2's rendering pipeline.
import { MODULE_ID, I18N } from "../constants.mjs";

const { DocumentSheetV2 } = foundry.applications.api;

export class TimelineJournalSheet extends DocumentSheetV2 {
  static DEFAULT_OPTIONS = {
    id: "mej-cc-timeline-redirect-{id}",
    window: { frame: false }
  };

  async render() {
    try {
      const { openTimelineInHub } = await import("../apps/CampaignHubPage.mjs");
      await openTimelineInHub(this.document);
    } catch (err) {
      console.error(`${MODULE_ID} | opening the timeline journal in the Hub failed`, err);
      ui.notifications?.error(game.i18n.localize(`${I18N}.timelineJournal.openFailed`));
    }
    return this;
  }

  async close() {
    return this;
  }
}
