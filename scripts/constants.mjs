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

/** MEJ-flag type key for a campaign portal entry (flags["monks-enhanced-journal"].type). */
export const CAMPAIGN_TYPE = "campaign";
/** Native module-declared JournalEntryPage subtype for campaign portals (see module.json documentTypes). */
export const CAMPAIGN_DOCUMENT_TYPE = `${MODULE_ID}.campaign`;

export const HUB_PAGE_ID = "campaign-hub";

/** flags.core.sheetClass value that routes a timeline journal's open to the Hub (scope.ClassName, DocumentSheetConfig's key format). */
export const TIMELINE_SHEET_CLASS = "mej-campaign-companion.TimelineJournalSheet";

export const SOCKET = `module.${MODULE_ID}`;

/** World setting: JournalEntry id holding the campaign timeline flag. */
export const TIMELINE_JOURNAL_SETTING = "timelineJournalId";

/** World setting: auto-link newly-typed MEJ entry names in page text. */
export const AUTO_LINK_SETTING = "autoLink";

/** Page flag: opt this page out of every auto-link path (typing, import, retroactive). */
export const NO_AUTO_LINK_FLAG = "noAutoLink";

/** World setting: retroactive auto-link mode for newly-created MEJ entities ("off" | "confirm" | "silent"). */
export const RETRO_LINK_MODE_SETTING = "retroLinkMode";

/** JournalEntry flag: stamped at creation, processed (and cleared) by the active GM's retro-link pass. */
export const RETRO_LINK_PENDING_FLAG = "retroLinkPending";

/** Client setting (hidden): pretend the MEJ extension API is absent, for testing native mode. */
export const FORCE_NATIVE_MODE_SETTING = "forceNativeMode";

/** World setting: auto-capture ended combats as Encounter entries. */
export const AUTO_CAPTURE_SETTING = "autoCaptureEncounters";

/** World setting: auto-file GM-shared images/video onto the newest timepoint. */
export const MEDIA_CAPTURE_SETTING = "autoCaptureSharedMedia";

/** World setting: Session entries created via the companion's own creation paths default to player-writable ownership. */
export const PLAYERS_WRITE_SESSIONS_SETTING = "playersWriteSessions";

/** World setting: saved dashboard queries [{id, name, query, showPlayers}] (GM-managed; world settings replicate to all clients). */
export const SAVED_QUERIES_SETTING = "savedQueries";

/** World setting: named player groups [{id, name, members: [userId]}] for per-group secret reveal (GM-managed from the Hub Secrets tab). */
export const PLAYER_GROUPS_SETTING = "playerGroups";

/** Combat flag: combatants that left mid-fight, for the end-of-combat summary. */
export const DEPARTED_FLAG = "departed";

/** MEJ JournalEntryPage short type key for an Encounter (flags["monks-enhanced-journal"].type). */
export const MEJ_ENCOUNTER_TYPE = "encounter";

/** Folder flag key: marks a journal Folder as a campaign (spec §1). Flag shape: { ownershipDefault: "none"|"observer"|"owner" }. */
export const CAMPAIGN_FLAG = "campaign";

/** Key on the campaign flag naming its auto-filing default timeline (spec D §1). Absent = fall back to the campaign's first timeline. */
export const DEFAULT_TIMELINE_KEY = "defaultTimelineId";

/** World setting: schema version for future migrations (spec §6). */
export const DATA_VERSION_SETTING = "dataVersion";

/** Current schema version written by the adoption/migration runner. */
export const CURRENT_DATA_VERSION = 6;

/** World setting: Folder id of the campaign that receives auto-captured encounters/media (spec §4). "" = unset → capture declines. */
export const AUTO_CAPTURE_CAMPAIGN_SETTING = "autoCaptureCampaign";

/** Client setting: the Hub's campaign picker choice ("" = All, "unfiled", or a Folder id) (spec §2). */
export const HUB_CAMPAIGN_SCOPE_SETTING = "hubCampaignScope";

/** World setting: the one-time adoption offer has been shown/dismissed (spec §6). */
export const ADOPTION_PROMPTED_SETTING = "adoptionPrompted";

/** Client setting: the Hub Timeline pane's selected timeline id ("" = the scope's default/stacked view). Spec D §3. */
export const HUB_TIMELINE_SELECTION_SETTING = "hubTimelineSelection";

/** i18n prefix for all companion strings. */
export const I18N = "MEJCampaignCompanion";

/**
 * The published user guide for a given seat. Targets main, so the links
 * resolve only once docs/gm-guide.md and docs/player-guide.md have merged
 * (PR #6); the Hub's Help button opens this in a new browser tab.
 */
export const guideUrl = (isGM) =>
  `https://github.com/bularzik/mej-campaign-companion/blob/main/docs/${isGM ? "gm" : "player"}-guide.md`;

/**
 * Docx import wizard: the wizard's per-section type dropdown, seeded by
 * suggestType() (logic/doc-import.mjs) and consumed by buildImportPlan().
 * This replaces campaign-record's RECORD_TYPES: it is every MEJ type the
 * import wizard knows how to create a page for via createMejEntry()
 * (data/mej-entry.mjs), plus "session" (the companion's own JournalEntryPage
 * subtype, created separately - see apps/import-wizard.mjs). The wizard's
 * type dropdown offers these plus "skip" (not part of this list;
 * buildImportPlan handles it). The old "text" pseudo-type is retired:
 * legacy markers/rows normalize to "journalentry" (see LEGACY_TYPE_ALIASES
 * in logic/doc-import.mjs).
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

/** Native Foundry JournalEntryPage types the companion mounts inside the MEJ shell (spec E §1). */
export const MEDIA_PAGE_TYPES = ["pdf", "video"];
