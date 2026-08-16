export const MODULE_ID = "mej-campaign-companion";
export const SESSION_TYPE = "session";
export const HUB_PAGE_ID = "campaign-hub";
export const SOCKET = `module.${MODULE_ID}`;

/** World setting: JournalEntry id holding the campaign timeline flag. */
export const TIMELINE_JOURNAL_SETTING = "timelineJournalId";

/** World setting: auto-link newly-typed MEJ entry names in page text. */
export const AUTO_LINK_SETTING = "autoLink";

/** World setting: auto-capture ended combats as Encounter entries. */
export const AUTO_CAPTURE_SETTING = "autoCaptureEncounters";

/** World setting: auto-file GM-shared images/video onto the newest timepoint. */
export const MEDIA_CAPTURE_SETTING = "autoCaptureSharedMedia";

/** Combat flag: uuid of the Encounter page this combat is captured into. */
export const ENCOUNTER_FLAG = "encounterUuid";

/** Combat flag: combatants that left mid-fight, for the end-of-combat summary. */
export const DEPARTED_FLAG = "departed";

/** MEJ JournalEntryPage short type key for an Encounter (flags["monks-enhanced-journal"].type). */
export const MEJ_ENCOUNTER_TYPE = "encounter";

/** i18n prefix for all companion strings. */
export const I18N = "MEJCampaignCompanion";
