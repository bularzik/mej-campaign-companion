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

/** World setting: Session entries created via the companion's own creation paths default to player-writable ownership. */
export const PLAYERS_WRITE_SESSIONS_SETTING = "playersWriteSessions";

/** Combat flag: combatants that left mid-fight, for the end-of-combat summary. */
export const DEPARTED_FLAG = "departed";

/** MEJ JournalEntryPage short type key for an Encounter (flags["monks-enhanced-journal"].type). */
export const MEJ_ENCOUNTER_TYPE = "encounter";

/** i18n prefix for all companion strings. */
export const I18N = "MEJCampaignCompanion";

/**
 * Docx import wizard: the wizard's per-section type dropdown, seeded by
 * suggestType() (logic/doc-import.mjs) and consumed by buildImportPlan().
 * This replaces campaign-record's RECORD_TYPES: it is every MEJ type the
 * import wizard knows how to create a page for via createMejEntry()
 * (data/mej-entry.mjs), plus "session" (the companion's own JournalEntryPage
 * subtype, created separately - see apps/import-wizard.mjs). The wizard's
 * type dropdown also offers "text" (a plain, unflagged page) and "skip",
 * same as campaign-record - those aren't part of this list because
 * buildImportPlan special-cases them regardless of the recordTypes list.
 */
export const COMPANION_IMPORT_TYPES = [
  "person", "place", "quest", "shop", "loot", "encounter",
  "organization", "poi", "event", "list", "session", "journalentry"
];

/** Directory (under the "data" FilePicker source) inline import images upload into. */
export const IMPORT_MEDIA_DIR = () => `worlds/${game.world.id}/${MODULE_ID}`;

/** Directory (under the "data" FilePicker source) relayed/direct player media uploads land in. */
export const RELAY_UPLOAD_DIR = () => `${IMPORT_MEDIA_DIR()}/uploads`;

/**
 * Socket action names, ported from campaign-record's constants (same
 * strings, different SOCKET channel - see SOCKET above). Wire-chunked GM
 * upload relay (scripts/hooks/media-relay.mjs) and the GM-side reply.
 */
export const UPLOAD_MEDIA_ACTION = "relay-upload-media";
export const UPLOAD_MEDIA_RESULT_ACTION = "relay-upload-media-result";

/** Socket action: a player relays a playerRecaps write to the active GM (scripts/hooks/player-recap.mjs). */
export const SAVE_RECAP_ACTION = "save-player-recap";
