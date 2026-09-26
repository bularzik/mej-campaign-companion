# Campaign Companion for Monk's Enhanced Journal

Campaign Companion adds a session-and-campaign layer on top of [Monk's Enhanced Journal](https://github.com/ironmonk108/monks-enhanced-journal) (MEJ) for Foundry VTT: a Session journal type, campaigns with their own timelines and in-world dates, a searchable Campaign Hub, tags, backlinks and a relationship graph, per-player secret reveals, automatic entry linking, entity creation from selected text, a Person-to-actor link, automatic capture of encounters and shared images, Word document import/export, and lightweight player collaboration. Everything the companion writes for its own purposes lives under its own `flags["mej-campaign-companion"]` namespace, never inside MEJ's — but on entries it creates (via MEJ's own document-creation paths, so MEJ recognizes and renders them correctly), it does set MEJ's own `type`/type-seed flags, exactly as any other MEJ-typed entry would; and the Person ↔ actor link writes MEJ's own `actor` flag and a user's own MEJ Notes, the same values MEJ's own actor drop and Notes field write. The two modules stay independently upgradeable; "zero data in MEJ's namespace" was never literally true and is not the claim made here.

## Documentation

- **[GM Guide](docs/gm-guide.md)** — installation, running sessions, the Campaign Hub, secrets, import/export: everything the GM drives, with screenshots.
- **[Player Guide](docs/player-guide.md)** — what players see and do: recaps, search, the relationship graph, revealed secrets.

The rest of this README is the technical reference: exact feature semantics, trust models, and caveats.

## Features

### Sessions

- A Session is its own page type, `mej-campaign-companion.session`, rendered inside MEJ's tabbed journal shell like a built-in MEJ type. It holds a session number, an in-world campaign date, attendees, a checklist of secrets with reveal/hide, one shared recap (`system.recap`) and GM-only notes (`system.gmNotes`).
- The recap is a single document. Owners edit it through Foundry's collaborative editor, so simultaneous owners see each other's edits; everyone else reads it. A save raised by another field on the sheet (session number, date) leaves the recap and GM notes untouched, and open Session views refresh when another owner saves the recap.
- Sessions are identified by their native page type, never by MEJ's type flag — see [Running without the MEJ extension API](#running-without-the-mej-extension-api-050).
- The Hub's **New Session** button creates one in both modes. Walkthrough: [GM Guide — Running your first session](docs/gm-guide.md#running-your-first-session).

### Campaigns

- A campaign is a flagged journal folder, a portal entry named after it, and a `<name> — Timeline` journal, created together by `createCampaign()` from the journal sidebar's GM-only **New Campaign** button or the Hub's campaign picker. **Make this folder a campaign** on a plain top-level folder's context menu promotes it in place; campaigns never nest.
- Everything filed in the folder is a member, including plain journal entries. The Hub's campaign picker (All campaigns / Unfiled / each campaign) scopes the Index, Timeline, Graph, Search, Dashboards and Secrets panes.
- Each campaign has an ownership baseline (**GM only**, **Players can view**, **Players can edit**). Entries a GM creates inside the folder without an explicit ownership start at that baseline; **Apply to all current members now** pushes it onto existing members, skipping entries hidden with the Index's per-entry eye toggle.
- The portal entry opens the Hub scoped to its campaign. Renaming the folder renames the portal and vice versa; deleting the portal never deletes the campaign (campaign settings offers **Restore campaign entry**).
- Campaign is not a page type: it is stripped from MEJ's New Entry dialog and Foundry's Create Page dialog, and a loose campaign page created any other way is upgraded into a real campaign or refused with a notification.
- A world with MEJ-typed content but no campaign gets a one-time GM adoption offer that creates a campaign from it non-destructively.

### Campaign Hub

- A "Campaign" home tab inside MEJ's shell (through MEJ's `registerShellPage` extension point in `api` mode, through shell hosting in `native` mode), also reachable from the scene controls' Journal Notes group and by opening a campaign's portal entry.
- A header bar holds the campaign picker, the campaign-settings gear (single-campaign scope only), **New Session**, and a **Tools** menu (Import Document, Export, Auto-capture campaign, Open the user guide; a player's menu holds only the guide).
- Six panes: Index, Timeline, Graph, Search, Dashboards and Secrets. Players get five; the Secrets pane is not rendered for a non-GM.
- The Index lists every campaign-relevant entry: MEJ-typed entries, Session pages, plain journal entries (as "Journal" rows), and Foundry pdf/video pages (as "Document"/"Recording" rows). In Unfiled scope a GM can **File into campaign…** per row or **File all shown into…**; in campaign scope a GM's **Link mentions** runs the auto-link catch-up pass through the review dialog.
- PDF and video pages open inside the Enhanced Journal with its chrome and the knowledge panel; they stay ordinary Foundry pdf/video pages, and disabling the module restores Foundry's stock sheets for them.

### Timeline and campaign dates

- A campaign can hold several named timelines; the one created with it is its default (marked ★ in the picker). World timelines belong to no campaign and accept links from any campaign; a campaign timeline accepts only its own campaign's documents (actors, scenes, items and images are exempt).
- A timeline is a JournalEntry with no pages of its own that stores timepoints in the companion's flags. Opening one from the sidebar or a link opens the Hub on its Timeline tab.
- Each timepoint optionally carries an in-world date from Foundry's calendar API (`game.time.calendar`) and holds links to any document or a raw image. An attached image is hidden from players unless it is marked shown; a document chip follows the document's own permissions.
- Three ordering modes: Manual (fractional-key drag-insert), Date Added (creation order), and Campaign Date.
- Everything filed automatically (encounter and media capture, imported session timepoints) goes to the campaign's default timeline, never the one the Hub is currently showing.

### Search and dashboards

- Search is an inverted index over MEJ entry fields (names, descriptions, person attributes, quest objectives, shop items, …) plus Session fields. GM-only fields (secrets, GM notes) index under a separate prefix and are filtered out for non-GM searchers at query time. The index builds lazily on first use and stays current through document-update hooks. In a campaign scope, results report "N more matches in other campaigns". Snippets show a link's text, not its markup.
- The Dashboards pane holds saved queries (`savedQueries`) in a small grammar: `type:`, `tag:`, `attr:<key>=<value>`, and free text. A query token that cannot mean anything (for example `attr:` with no name) is rejected with a message naming it. Each dashboard is GM-only unless its **Visible to players** box is checked.
- The same grammar works inline as an `@CampaignQuery[...]` enricher on any MEJ page. Its results refresh on page re-render only.

### Knowledge (tags, attributes, backlinks, knowledge bar, relationship graph)

- **Tags and attributes** — custom tags and key/value attributes on MEJ entries, edited in a knowledge panel at the foot of each sheet. An attribute row marked `playerHidden` is kept off player sheets and out of player searches immediately.
- **Backlinks** — the panel's "Mentioned in" section lists the entries that link to this one through `@UUID` links, updates live, and feeds the mention-count badges on the Hub Index. Plain-text names count only once auto-link has turned them into links.
- **Knowledge bar** — the panel collapses to a one-line bar summarizing what it holds. The collapsed state is per client (`knowledgePanelCollapsed`) and applies to every sheet. The expanded panel is capped at half the pane and scrolls, and paints its own surface under a dark colour scheme.
- **Relationship graph** — the Hub's Graph pane draws entries connected through MEJ's `relationships` flags, with vendored d3-force layout. It follows the campaign picker; **Whole campaign** and **Focus** (one entry and its direct connections) modes; an optional dashed overlay of `@UUID` mention edges; nodes draw the entry's own picture or a per-type placeholder. It is capped at the 200 most-connected entries and says so when the cap applies. A player's graph shows only relationships revealed to them.
- Mentions and relationships are separate layers: mentions are derived from links, relationships are curated on MEJ's Relationships tab. The module never turns one into the other.

### Secrets

- **Block-level secrets** — Foundry's native secret sections on any MEJ page with text, including a Session's recap, can be revealed to everyone, individual players, or player groups. Reveal records live on the page that holds the secret.
- **Player groups** — named groups (`playerGroups`) managed from the Hub Secrets tab, usable as reveal targets alongside individual players.
- **Relationship reveals** — each MEJ relationship row, and a secret label on it, can be revealed to players or groups independently. A hidden relationship stays out of a player's relationships list and graph until revealed to them.
- **Hub Secrets tab** (GM only) — every secret in scope, filterable by type, revealed state or player, with a "what does player X know" view, and player group management.
- **Session prep board** — a GM-only board on Session entries for tracking which secrets have been revealed to whom across sessions.
- **Reveal whispers** — a player added to a secret's reveal audience gets a private whisper with the secret text and session context.

**Trust model:** like Foundry's own secret blocks and MEJ's GM notes, secret text is hidden by client-side filtering — the data still replicates to any client that can see the journal entry. A technically savvy player could read it from the raw document data. Do not use this module to protect genuinely sensitive information. A player granted OWNER permission on a journal entry sees all its native secret blocks via Foundry's own rendering, outside the companion's audience gate — inherent to the soft-hidden model.

**"Everyone" is Foundry's own reveal (0.13.3):** choosing "Everyone" in a secret's reveal dialog writes the same native `revealed` class Foundry's own per-block Reveal control toggles, straight into the page's stored text. An "Everyone" reveal is therefore honored everywhere the native one is — core sheets, viewers who don't run this module, and player-safe docx exports — and the two controls no longer disagree about the same secret. Per-player and per-group audiences stay companion-side re-enrichment, since Foundry has no native equivalent for them. Secrets in a Session's **recap** can be revealed this way too, from the sheet or the Hub Secrets tab.

### Auto-link

Auto-link turns plain-text mentions of MEJ entry names into `@UUID` links. It never rewrites inside an existing link or a code block.

- **As you type** (`autoLink`, on by default) — on save, names newly added to page text, a Session's recap or its GM notes become links.
- **When an entry is created** (`retroLinkMode`, Silent by default) — the active GM's client links existing plain-text mentions of the new entry's name. Silent writes immediately and shows a notification; Confirm shows a review dialog with a checkbox per page; Off disables it. Entries created while no GM is online are processed at the next GM login.
- **Catch-up** — the Hub's **Link mentions** (Index toolbar, campaign scope, GM) plans every entry in the campaign and always goes through the review dialog.
- **Docx import** — auto-links imported text at creation (gated on `autoLink`). The import wizard's Audience select sets created-entry ownership and bounds link targets.

**Campaign scope:** an entry filed in a campaign links with that campaign's pages and unfiled pages; an unfiled entry links anywhere; campaigns never link into each other. A campaign's portal entry and timeline journal are never link sources or targets.

**Audience containment:** a mention links to an entity only when everyone who can view the page can also view the entity (evaluated at the JournalEntry level via ownership, threshold LIMITED); GMs are excepted. When that is the only reason a new entry was not linked, the create-time pass says so and names the pages in the console.

**Ambiguity:** names shared by multiple in-audience entities are never auto-linked; they are reported in the notification, dialog, summary, or import warnings instead.

**Caveat:** links are validated when written; changing permissions afterward does not add or remove existing links. The per-page `noAutoLink` flag opts a page out of every auto-link path.

### Create Entity from Selection and campaign Contributors

- Right-clicking a selection of plain text (up to 80 characters, no line breaks) in a page's displayed description offers **Create Entity from Selection**; it is absent while the field is being edited. The dialog takes a type (MEJ's entity types; the last one used is remembered per client in `entityFromSelectionLastType`), a name, and **Link other mentions**. The companion creates the entity in the same folder, turns the selected occurrence into a link to it, and, when **Link other mentions** is checked, hands the new entry to the `retroLinkMode` setting.
- A GM can use it on any page they can edit. A player can use it only on pages of a campaign whose **Contributors** (Hub → campaign settings) list them directly or through a player group, and only while a GM is connected: the request is relayed to the GM's client, which validates the sender and does the work, so the new entity gets the campaign's ownership baseline. Contributor lists are stored on the campaign folder's flag.
- Walkthrough: [GM Guide — Creating an entity from selected text](docs/gm-guide.md#creating-an-entity-from-selected-text).

### Person ↔ actor link

- The link is MEJ's own `flags["monks-enhanced-journal"].actor` value on a Person page — the same value MEJ writes when an actor is dragged onto a Person. The companion builds on that flag; it does not patch MEJ.
- On a Person sheet the user can edit, the companion adds **Link Actor**, or **Change linked actor** and **Unlink actor** once linked. The picker lists world actors the user has at least OBSERVER permission on. Unlinking leaves the picture, description and notes as they are.
- When a link is set or changed (by the picker or by MEJ's drag), the client that made the change updates the page: its image becomes the actor's image; an empty description receives the actor's public biography (`system.details.biography.public` on dnd5e, `system.details.publicNotes` on pf2e); and that user's own empty MEJ Notes (`flags["monks-enhanced-journal"].<userId>.notes`) receive the actor's full biography, so GM-only text stays out of player-visible fields. On systems without a public biography field, only the Notes are filled. The copy happens once; later biography edits do not propagate.
- When an actor's image changes, the active GM's client brings every Person linked to it onto the new image. With no GM connected the change is picked up on the actor's next image change or a re-link. Compendium actor links are ignored.
- Walkthrough: [GM Guide — Linking a Person to an actor](docs/gm-guide.md#linking-a-person-to-an-actor).

### Auto-capture

- `autoCaptureEncounters` (off by default) — when combat ends, creates or updates an MEJ Encounter entry summarizing participants and outcome, named after the scene the combat was on. A recapture updates the generated summary in place and leaves the GM's own text alone.
- `autoCaptureSharedMedia` (off by default) — images and video a GM shows to players with "Show Players" are filed as links.
- Both file onto the newest timepoint of the auto-capture campaign's default timeline. The target campaign (`autoCaptureCampaign`) is set from **Tools → Auto-capture campaign**; the world's first campaign becomes it automatically. With campaigns present but no target set, capture declines instead of creating loose entries. With no timepoint yet, nothing is filed.

### Docx import and export

- The import wizard reads a `.docx` (Word or Google Docs export) into MEJ entries and Session pages: per-section type suggestions (session-shaped sections suggest Session), inline and standalone images uploaded under `worlds/<world>/mej-campaign-companion/`, dated-header detection that creates timepoints, merge and split of sections, an **Import into** destination (a campaign, one of its subfolders, or **New Campaign…**), and an Audience choice (**GM only**, **All players (Observer)**, **Campaign default**). Documents are created only on final confirmation; results are reported in a notification.
- Export walks selected MEJ entries and the timeline into a round-trippable `.docx`, with an opt-in **Include GM Content** toggle. See [Docx round-trip notes](#docx-round-trip-notes).

### Player collaboration

- `playersWriteSessions` (off by default) gives players ownership of new Session entries so they can edit the shared recap directly; turning it on also offers to grant ownership of existing sessions. Players without file-upload permission get inline images through a GM relay. See [Player collaboration notes](#player-collaboration-notes).
- Players can reach the Hub (five panes), search without GM-only content, see the relationships revealed to them, and — as campaign Contributors — create entities from a selection. Walkthrough: [Player Guide](docs/player-guide.md).

## Running without the MEJ extension API (0.5.0)

The companion works against a stock Monk's Enhanced Journal install as well as
a build carrying the extension API. It resolves one of three modes at startup:

| Mode | When | What you get |
|------|------|--------------|
| `api` | MEJ fires `setupMonksEnhancedJournal` | Everything, with the Session sheet and Campaign Hub inside MEJ's tabbed shell |
| `native` | MEJ is installed without the extension API | Everything, with the Session sheet and Hub hosted inside MEJ's tabbed shell by default (shell hosting); standalone windows only if shell hosting can't install |
| `native` on Foundry 13 | The only MEJ release for Foundry 13 is 13.06, which carries no extension API, so a Foundry 13 world is *always* in native mode — there is no `api` mode to fall back from | Same as `native` above: shell hosting by default, standalone windows plus a `shell hosting unavailable` console warning if the adaptation cannot install |
| `absent` | MEJ is not active | The module stays inert — MEJ is a hard dependency |

Native mode is a supported configuration, not a degraded fallback, and it is
not announced with a warning. What differs:

- Session appears in MEJ's own "New Entry" dialog only in `api` mode; on
  stock MEJ it may show up there as an unlocalized `TYPES.JournalEntryPage.…`
  entry instead — use the **New Session** button in the Campaign Hub either
  way. Campaigns are created with the **New Campaign** button in the journal
  sidebar in both modes, and never appear as a page type in that dialog.
- Session pages cannot be MEJ *relationship* targets (MEJ's picker only
  enumerates its own registry). Companion relationships are unaffected.
- In native mode the companion hosts the Campaign Hub and Session sheets
  inside Monk's Enhanced Journal's own tabbed window by adapting four of
  MEJ's functions at start-up; if that adaptation cannot be installed (a
  future MEJ release renaming one of them), the companion logs
  `shell hosting unavailable` and falls back to standalone windows. The
  companion registers its sheets at init and holds an early open of a
  Session or campaign portal until its ready-time wiring (shell adaptation
  and features) is complete, so clicking a Session in the first second
  after login no longer opens a broken or wrapped sheet.
- The "open graph" and "prep board" header buttons are absent; both remain
  reachable — the graph from the Hub's Graph pane, the prep board from the button
  on the Session sheet itself.

Sessions are identified by their native Foundry page type
(`mej-campaign-companion.session`), never by MEJ's type flag, so they stay
first-class in search, auto-linking, the Hub index, export and the graph in
both modes. A stock MEJ install strips the module's `monks-enhanced-journal`
type flag from Session pages; if the world later runs an API-carrying build
again, the GM's client silently re-stamps it, so worlds can move between
builds with no migration.

**Caveat:** enabling the hidden `forceNativeMode` client setting on a build
that *does* have the extension API puts that one client into native mode too
— which means that client's MEJ no longer knows the Session type, so MEJ's
own `fixType` can strip the `monks-enhanced-journal` type flag from Session
pages as seen by that client. Turning the setting back off lets the GM's
startup sweep re-stamp them automatically, the same as returning from a
stock MEJ install.

## Requirements

- Foundry VTT **v13 or v14** (verified on 13.351 and 14.x). The manifest declares `compatibility.minimum` 13 and `verified` 14.
- **Monk's Enhanced Journal** — **13.06 or later on Foundry 13, 14.01 or later on Foundry 14** (a required relationship in the manifest: minimum 13.06, verified 14.01). A build that includes the extension API (upstream MEJ pull request #823, rebased onto MEJ 14.01 and not yet in a tagged MEJ release as of this writing) gives the fullest integration — the Session sheet and Campaign Hub mount inside MEJ's own tabbed shell (`api` mode). A stock MEJ build without the API is fully supported too: Campaign Companion detects this at startup and runs in `native` mode instead, hosting the Session sheet and Hub inside MEJ's own tabbed shell the same way — see [Running without the MEJ extension API](#running-without-the-mej-extension-api-050) above. Only a genuinely missing/inactive MEJ, or an internal wiring failure, produces a startup notification; see [Error handling](#error-handling-and-troubleshooting) below.
- A `dnd5e`-first companion whose core (search, timeline, docx, auto-link/capture, Session sheet itself) makes no `dnd5e`-specific assumptions. The Person ↔ actor link reads a public biography only from `dnd5e` and `pf2e` fields and falls back to the full biography into Notes elsewhere — see [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for what to manually verify on other game systems.

## Installation

Preferred: in Foundry's **Install Module** dialog, paste this manifest URL:

```
https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json
```

Or install manually:

1. Download or clone this repository into your Foundry `Data/modules/mej-campaign-companion` directory (the folder name must match the module id).
2. Restart Foundry (or reload the setup page) so it picks up the new module directory.
3. Enable **both** "Monk's Enhanced Journal" and "Campaign Companion for Monk's Enhanced Journal" in your world's Manage Modules dialog. Load order doesn't matter for this — the companion listens for MEJ's setup hook at import time regardless of which module's script tag runs first.

## Settings

Seventeen settings are registered: five visible in the module settings menu, all world-scoped, and twelve internal settings with no UI (`config: false`) — six world-scoped and six client-scoped. World-scoped settings are GM-only and apply to everyone in the world; client-scoped settings belong to one browser.

| Setting | Config visible? | Default | Purpose |
|---|---|---|---|
| `autoLink` | Yes | On | Link newly-typed MEJ entry names in page text, session recaps and GM notes on save (campaign-scoped). |
| `retroLinkMode` | Yes | Silent | Retroactive Auto-Link: creating an MEJ entity links existing plain-text mentions of its name from the active GM's client. Choices: Off, Confirm (review dialog with per-page checkboxes), Silent (write immediately + notification). |
| `autoCaptureEncounters` | Yes | Off | Turn on automatic Encounter-entry creation when combat ends. |
| `autoCaptureSharedMedia` | Yes | Off | Turn on automatic filing of GM-shown images/video onto the timeline. |
| `playersWriteSessions` | Yes | Off | Grant players default ownership of Session entries created via the docx import wizard or MEJ's own New Entry dialog, so players can edit the shared session recap directly; turning it on also offers ownership of existing sessions. |
| `timelineJournalId` | No (internal) | `""` | Legacy: the id of the world-singleton "Campaign Timeline" JournalEntry used by a world with no campaigns. Adopting the world into a campaign moves that journal into the campaign and clears the setting. Don't edit by hand. |
| `savedQueries` | No (internal) | `[]` | Saved dashboard queries managed from the Hub Dashboards tab. Not user-facing; edit only via the Hub UI. |
| `playerGroups` | No (internal) | `[]` | Named player groups managed from the Hub Secrets tab. Not user-facing; edit only via the Hub UI. |
| `forceNativeMode` | No (internal) | Off | Client-scoped. Ignore the MEJ extension API and use native mode (testing / escape hatch). |
| `shellHosting` | No (internal) | On | Client-scoped. In native mode, host the Hub and Session sheets inside MEJ's shell; off uses standalone windows. See [Error handling](#error-handling-and-troubleshooting). |
| `dataVersion` | No (internal) | `0` | Schema version the active GM's migrations have reached (current: 7). Don't edit by hand. |
| `autoCaptureCampaign` | No (internal) | `""` | Folder id of the campaign that receives auto-captured encounters and media; set from **Tools → Auto-capture campaign**. Empty with campaigns present means capture declines. |
| `hubCampaignScope` | No (internal) | `""` | Client-scoped. The Hub campaign picker's choice: `""` (All campaigns), `unfiled`, or a campaign folder id. |
| `knowledgePanelCollapsed` | No (internal) | Off | Client-scoped. The knowledge panel is collapsed to its one-line bar on every sheet. |
| `adoptionPrompted` | No (internal) | Off | The one-time adoption offer has been shown or dismissed. |
| `hubTimelineSelection` | No (internal) | `""` | Client-scoped. The Hub Timeline pane's selected timeline id; `""` is the scope's default view. |
| `entityFromSelectionLastType` | No (internal) | `person` | Client-scoped. The type last picked in the Create Entity from Selection dialog. |

The authoritative list lives in `scripts/constants.mjs` (the setting-key constants) and `scripts/campaign-companion.mjs`'s `init` hook (the `game.settings.register` calls) — check those two files directly if this table and the code ever drift.

A campaign's timeline journal is named `<campaign name> — Timeline`; the legacy world-singleton timeline that `timelineJournalId` points at is created with the literal name `"Campaign Timeline"` (`scripts/data/timeline-journal.mjs`). Both names are hardcoded English, not routed through `en.json`, the same deliberate scope as the docx field labels below.

## Docx round-trip notes

- **Type markers.** Export writes a `Campaign Record type: <kind>` marker paragraph at the top of each entry's section (kept as that literal, English string for compatibility with documents exported by the predecessor `campaign-record` module, whose exports this importer also understands). On import, that marker — when present — takes priority over title-keyword heuristics when suggesting a type for a section.
- **GM-content export toggle.** The export dialog's "Include GM Content" checkbox controls whether Session GM notes, relationships hidden from players, and unrevealed secret blocks are written into the `.docx` at all. Leave it unchecked to produce a document safe to hand to players.
- **Date parsing and non-Gregorian calendars.** The import wizard detects session-header dates (`4/15/24`, `April 15, 2024`, …) and converts them into campaign-date components with a **numeric passthrough**: real-world year as-is, month/day mapped straight across. This assumes the world's active calendar's month numbering and count line up with the Gregorian calendar the source document was written against. For a non-Gregorian or non-12-month calendar, this is a known, deliberate approximation — there's no general way to map a real-world date onto an arbitrary in-world calendar without a mapping the source document doesn't provide. Out-of-range results (e.g. "month 14" against a calendar with fewer months) are rejected and reported as a per-section warning rather than silently stored.
- Import/export use the vendored `mammoth` (docx → HTML) and `docx` (HTML model → docx) libraries under `vendor/`; no network calls are made during import or export.
- **Field labels are English-only, regardless of world locale.** The per-type field labels the export writes into the `.docx` itself (Role, Location, Race, Faction, Type, Rarity, …) are literal strings with no i18n hook — a French-speaking GM's exported document will still say "Role" in English. This matches the module's English-only scope (see [Development](#development)) but is worth flagging since it's document *content*, not UI chrome that a future translation could cover.

## Player collaboration notes

Session entries can be made player-writable via the `playersWriteSessions` setting; owning players edit the session's one shared recap directly through the sheet, using Foundry's collaborative ProseMirror editor (simultaneous owners see each other's edits). Turning the setting on offers to grant ownership of existing session entries as well. There is no relay path for recap text: a player without ownership reads the recap and cannot write it.

Players without file-upload permission still get inline images into a recap they own: the upload itself is relayed through an active GM's client (`scripts/hooks/media-relay.mjs`), and the resulting `<img>` is written by the player's own owner update.

**Trust model:** Foundry's client-side socket API gives a receiving client no server-verified sender identity, so the upload relay validates the claimed sender resolves to a real user, enforces the file's extension from its validated MIME type, writes only under the world's relay upload directory, and logs every rejection. What it doesn't eliminate is a socket-reachable client claiming another user's id to upload an image on their behalf — bounded to that directory, the same bound MEJ's own relay precedent accepts.

## Error handling and troubleshooting

- If Monk's Enhanced Journal isn't installed or isn't active, Campaign Companion disables itself at `ready` (`absent` mode) and shows one permanent error notification rather than half-loading with silent failures.
- If MEJ is active but this module's own registration throws in any mode (a bug in this module), a second, more specific `init-failed` error notification is shown instead, and the error is logged to the console.
- A stock MEJ build without the extension API is not an error condition: Campaign Companion runs in `native` mode with no warning — see [Running without the MEJ extension API](#running-without-the-mej-extension-api-050) above.
- If native mode's shell hosting can't install (a future MEJ release renaming one of the functions it adapts), the console logs `mej-campaign-companion | shell hosting unavailable (wrap "<name>" not installable); using standalone windows` and the module falls back to standalone windows automatically — no user action needed. This is controlled by a hidden, client-scoped `shellHosting` setting (`config: false`, on by default); a GM can force standalone windows for troubleshooting from the console with `game.settings.set("mej-campaign-companion", "shellHosting", false)`.
- Auto-link, auto-capture and the Person ↔ actor sync are pure observers: a failure in any of them logs to the console and is skipped, and never blocks the underlying page-save, combat-end or actor-update operation it hooked.
- Docx import creates documents only on final confirmation. A damaged image is reported and skipped; an unexpected failure mid-run still reports what was created. Counts are reported in a notification, and failures and warnings in a second notification plus the browser console.

## Known issues

See [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for the full detail, including the manual verification steps for each item below — this section is a pointer, not a substitute for it.

- Non-`dnd5e` systems, second-display/popout behavior, and Word/Google Docs docx visual fidelity are exercised manually rather than by the automated suites; see the checklist's respective sections.
- A `libWrapper`-vs-Monk's Common Display interaction on the shared-media capture path has a documented manual conflict scan, not an automated one.
- **Knowledge layer:**
  - Enricher results (`@CampaignQuery[...]`) refresh on page re-render only, not on live data updates; rebuild the Dashboard to see latest results.
  - Relationship graph caps at the 200 most-connected entries for performance; additional nodes and links to them are excluded from the visualization.
  - Backlinks count only `@UUID` links; plain-text entry names that haven't yet been converted into `@UUID` links by auto-link are caught only once a later auto-link pass has converted them.

## Development

- `npm test` — unit tests (Vitest): 91 test files, 1015 tests. No Foundry environment required.
- `npm run test:e2e` — 27 Playwright spec files, 175 tests as listed by `npx playwright test --list` (including the auth setup test and the gated guide-screenshot and stock-gate specs), against a live Foundry v14 world with MEJ and this module installed and enabled (GM + player clients); requires a running, unlocked Foundry test instance reachable at the URL configured in `playwright.config.mjs`, and is not run as part of a plain docs/code review.
- `npm run e2e:v13` — the same suite against a Foundry 13 world (`FOUNDRY_TARGET=v13`); `npm run e2e:stock:v13` runs the stock-MEJ gate there. See `tests/e2e/README.md`.
- Plain ES modules, no build step, matching both MEJ's and this module's own style — edit `scripts/`, `templates/`, `styles/`, and `lang/en.json` directly.

See [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for the manual checks that aren't (yet, or can't be) covered by either test suite.

## License

Copyright © 2026 Dan Bularzik. Licensed under the [MIT License](LICENSE). This module extends [Monk's Enhanced Journal](https://github.com/ironmonk108/monks-enhanced-journal) (GPL-3.0) through its extension API without bundling any of its code; MIT is GPL-compatible, so combined use complies with MEJ's terms.

Vendored third-party libraries retain their own licenses: [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2-Clause), [docx](https://github.com/dolanmiu/docx) (MIT), [d3-force](https://github.com/d3/d3-force) (ISC).
