export const MODULE_ID = "mej-campaign-companion";

/**
 * "session" (unprefixed) is the key the companion registered its Session
 * sheet under (api.registerSheetType's `key`) and the exact value MEJ's own
 * New Entry dialog stores in `flags.monks-enhanced-journal.pagetype` when a
 * user picks it there (that <select>'s option value is the raw
 * externalTypes key - see monks-enhanced-journal.js's renderDialogV2
 * listener). It is NOT a valid JournalEntryPage `type` value on its own,
 * though: Foundry's module-declared-subtype system (module.json's
 * `documentTypes.JournalEntryPage.session`) registers the REAL runtime type
 * as the prefixed `${MODULE_ID}.session` - `DocumentTypeField._validateType`
 * rejects a bare "session" at Document.create with no such fallback. Use
 * SESSION_DOCUMENT_TYPE below for anything that creates or compares an
 * actual page's `type` field; SESSION_TYPE stays for the pagetype-flag/
 * sheet-registration-key uses, which are genuinely always unprefixed.
 */
export const SESSION_TYPE = "session";

/** The actual native JournalEntryPage `type` value for a Session page (module-declared subtype key). */
export const SESSION_DOCUMENT_TYPE = `${MODULE_ID}.${SESSION_TYPE}`;

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

/** World setting: saved dashboard queries [{id, name, query, showPlayers}] (GM-managed; world settings replicate to all clients). */
export const SAVED_QUERIES_SETTING = "savedQueries";

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
