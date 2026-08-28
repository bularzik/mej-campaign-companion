# Campaign Companion for Monk's Enhanced Journal

Campaign Companion adds a session-and-campaign layer on top of [Monk's Enhanced Journal](https://github.com/ironmonk108/monks-enhanced-journal) (MEJ) for Foundry VTT: a Session journal type, a campaign timeline with in-world dates, a searchable Campaign Hub, automatic capture of encounters and shared images, automatic entry linking, Word document import/export, and lightweight player collaboration. Everything the companion writes for its own purposes lives under its own `flags["mej-campaign-companion"]` namespace, never inside MEJ's — but on entries it creates (via MEJ's own document-creation paths, so MEJ recognizes and renders them correctly), it does set MEJ's own `type`/type-seed flags, exactly as any other MEJ-typed entry would. The two modules stay independently upgradeable; "zero data in MEJ's namespace" was never literally true and is not the claim made here.

## Documentation

- **[GM Guide](docs/gm-guide.md)** — installation, running sessions, the Campaign Hub, secrets, import/export: everything the GM drives, with screenshots.
- **[Player Guide](docs/player-guide.md)** — what players see and do: recaps, search, the relationship graph, revealed secrets.

The rest of this README is the technical reference: exact feature semantics, trust models, and caveats.

## Features

- **Session journal type** — a new MEJ page type (`mej-campaign-companion.session`) with session number, an in-world campaign date, a GM recap, per-player recaps, attendee tracking, a checklist of secrets with reveal/hide, and GM-only notes. Renders inside MEJ's own tabbed journal shell like any built-in MEJ type.
- **Campaign Hub tab** — a "Campaign" home tab integrated into MEJ's shell (via MEJ's `registerShellPage` extension point), also reachable from the scene-controls notes group. Three panes: a filterable, sortable index of every campaign-relevant entry; a drag-reorderable timeline; and search.
- **Timeline with campaign dates** — a single world timeline of timepoints, each optionally bound to an in-world calendar date (Foundry's v14 calendar API), holding links to any document or a raw image. Three ordering modes: manual (fractional-key drag-insert), creation order, and campaign date.
- **Cross-journal search** — an inverted index over MEJ entry fields (names, descriptions, person attributes, quest objectives, shop items, …) plus Session fields. GM-only fields (secrets, GM notes) index under a separate prefix and are filtered out for non-GM searchers at query time. Builds lazily on first use and stays current via document-update hooks.
- **Auto-link** — on page save, an opt-in world setting turns newly-typed mentions of existing MEJ entry names into `@UUID` links. Never rewrites inside an existing link or a code block; individual entries can opt out.
- **Auto-capture** — on combat end, an opt-in world setting creates (or updates) an MEJ Encounter entry summarizing participants and outcome, filed onto the timeline's newest timepoint. A second, independent opt-in world setting auto-files GM "Show Players" images and video onto that same timepoint.
- **Docx import and export** — a wizard imports a `.docx` (Word or Google Docs export) into MEJ entries and Session pages, with per-section type suggestions, inline images, and dated-header detection that creates timepoints. Export walks selected MEJ entries and the timeline into a round-trippable `.docx`, with an opt-in toggle to include GM-only content.
- **Player collaboration** — an opt-in world setting lets players own the Session entries they help create, so they can write their own recaps directly; players without upload permission get a chunked socket relay through an active GM instead.

### Knowledge layer (0.2.0)

- **Backlinks** — a "Mentioned in" panel on every MEJ sheet shows which other campaign entries link to this one, with badges on the Hub's entry index showing mention counts for each entry.
- **Tags and attributes** — annotate MEJ entries with custom tags and per-row attributes (e.g. `trustworthiness` on Person entries), visible in the knowledge panel with a per-row `playerHidden` flag for attributes that should not appear on player sheets.
- **Relationship graph** — a visual graph of entries connected via MEJ's `relationships` flags, with vendored d3-force rendering, ego-mode and whole-campaign view toggle, an optional dashed backlink overlay for `@UUID` mentions between entries, and a 200-node connection cap for performance.
- **Hub Dashboards** — a "Dashboards" tab on the Campaign Hub with saved queries using a simple grammar (`type:`, `tag:`, `attr:`, free-text search); search results appear directly inline with an `@CampaignQuery[...]` page enricher for inline results on any MEJ sheet.

### Secrets layer (0.3.0)

- **Block-level secrets** — mark arbitrary text blocks as secrets on native secret sections, with per-player and per-player-group reveal toggles; revealable individually by GM on the Hub Secrets tab or en masse via secret checklists on Session entries.
- **Player groups** — name groups of players and manage membership dynamically within the Hub, used as reveal targets alongside individual players.
- **Relationship reveals** — designate which players or groups can see each edge of the relationship graph with per-edge labels, showing players only their accessible relationships and edge metadata.
- **Hub Secrets tab** — view and filter every secret in the campaign by type, revealed state, or player; see "what does player X know" across the campaign; manage player group membership.
- **Session prep board** — GM-only board on Session entries to mark which secrets have been revealed to whom, used for tracking GM reveal decisions across multiple sessions.
- **Reveal whispers** — send a private notification to each player when they are added to a secret's reveal audience, with the secret text and session context.

**Trust model:** like Foundry's own secret blocks and MEJ's GM notes, secret text is hidden by client-side filtering — the data still replicates to any client that can see the journal entry. A technically savvy player could read it from the raw document data. Do not use this module to protect genuinely sensitive information. A player granted OWNER permission on a journal entry sees all its native secret blocks via Foundry's own rendering, outside the companion's audience gate — inherent to the soft-hidden model.

**"Everyone" is Foundry's own reveal (0.14.0):** choosing "Everyone" in a secret's reveal dialog writes the same native `revealed` class Foundry's own per-block Reveal control toggles, straight into the page's stored text. An "Everyone" reveal is therefore honored everywhere the native one is — core sheets, viewers who don't run this module, and player-safe docx exports — and the two controls no longer disagree about the same secret. Per-player and per-group audiences stay companion-side re-enrichment, since Foundry has no native equivalent for them. Secrets in a Session's **recap** can be revealed this way too, from the sheet or the Hub Secrets tab.

### Auto-link scoping (0.4.0)

Auto-linking is now bounded by audience containment on every path: a mention links to an entity only when everyone who can view the page can also view the entity (evaluated at the JournalEntry level via ownership, threshold LIMITED); GMs are excepted.

**Auto-link paths:**
- **Docx import** — auto-links imported text at creation (gated on the Auto-Link setting). The import wizard's Audience select ("GM only" default / "All players (Observer)") sets created-entry ownership and bounds link targets; ambiguous names are skipped and listed in the summary.
- **Retroactive Auto-Link** — a new world setting (off/confirm/silent, default confirm) links existing plain-text mentions of a newly-created MEJ entity's name from the active GM's client. Confirm mode shows a review dialog with per-page checkboxes; silent mode writes immediately and sends a whispered GM summary. Entities created while no GM is online are processed when a GM next connects.

**Ambiguity:** names shared by multiple in-audience entities are never auto-linked; they are reported in the dialog, summary, or import warnings instead.

**Caveat:** links are validated when written; changing permissions afterward does not add or remove existing links. The per-page `noAutoLink` flag opts a page out of every auto-link path.

## Running without the MEJ extension API (0.5.0)

The companion works against a stock Monk's Enhanced Journal install as well as
a build carrying the extension API. It resolves one of three modes at startup:

| Mode | When | What you get |
|------|------|--------------|
| `api` | MEJ fires `setupMonksEnhancedJournal` | Everything, with the Session sheet and Campaign Hub inside MEJ's tabbed shell |
| `native` | MEJ is installed without the extension API | Everything, with the Session sheet and Hub as standalone windows |
| `absent` | MEJ is not active | The module stays inert — MEJ is a hard dependency |

Native mode is a supported configuration, not a degraded fallback, and it is
not announced with a warning. What differs:

- Session does not appear in MEJ's own "New Entry" dialog — create sessions
  with the **New Session** button in the Campaign Hub.
- Session pages cannot be MEJ *relationship* targets (MEJ's picker only
  enumerates its own registry). Companion relationships are unaffected.
- The Hub opens as its own window rather than a shell tab.
- The "open graph" and "prep board" header buttons are absent; both remain
  reachable — the graph from the Hub toolbar, the prep board from the button
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

- Foundry VTT **v14**.
- **Monk's Enhanced Journal**, any active build. A build that includes the extension API (the API lands on MEJ's `feat/extension-api` branch, not yet in a tagged MEJ release as of this writing) gives the fullest integration — the Session sheet and Campaign Hub mount inside MEJ's own tabbed shell (`api` mode). A stock MEJ build without the API is fully supported too: Campaign Companion detects this at startup and runs in `native` mode instead, with the Session sheet and Hub as standalone windows — see [Running without the MEJ extension API](#running-without-the-mej-extension-api-050) above. Only a genuinely missing/inactive MEJ, or an internal wiring failure, produces a startup notification; see [Error handling](#error-handling-and-troubleshooting) below.
- A `dnd5e`-first companion whose core (search, timeline, docx, auto-link/capture, Session sheet itself) makes no `dnd5e`-specific assumptions — see [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for what to manually verify on other game systems.

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

All settings are **world-scoped** (GM-only, apply to everyone in the world) except `forceNativeMode`, which is client-scoped. Nine settings are registered in total — five visible in the module settings menu, plus four internal settings with no UI:

| Setting | Config visible? | Default | Purpose |
|---|---|---|---|
| `autoLink` | Yes | Off | Turn on auto-linking of newly-typed MEJ entry names in page text on save. |
| `retroLinkMode` | Yes | Confirm | Retroactive Auto-Link world setting: creating an MEJ entity links existing plain-text mentions of its name from the active GM's client. Choices: Off (disabled), Confirm (review dialog with per-page checkboxes), Silent (write immediately + whispered GM summary). |
| `autoCaptureEncounters` | Yes | Off | Turn on automatic Encounter-entry creation when combat ends. |
| `autoCaptureSharedMedia` | Yes | Off | Turn on automatic filing of GM-shown images/video onto the timeline. |
| `playersWriteSessions` | Yes | Off | Grant players default ownership of Session entries created via the docx import wizard or MEJ's own New Entry dialog, so they can write their own recaps directly. |
| `timelineJournalId` | No (internal) | `""` | Holds the id of the world's singleton "Campaign Timeline" JournalEntry once the Hub creates it. Not user-facing; don't edit by hand. |
| `savedQueries` | No (internal) | `[]` | Saved dashboard queries managed from the Hub Dashboards tab. Not user-facing; edit only via the Hub UI. |
| `playerGroups` | No (internal) | `[]` | Named player groups managed from the Hub Secrets tab. Not user-facing; edit only via the Hub UI. |
| `forceNativeMode` | No (internal) | Off | Ignore the MEJ extension API and use native mode (testing / escape hatch) |

The authoritative list lives in `scripts/constants.mjs` (the setting-key constants) and `scripts/campaign-companion.mjs`'s `init` hook (the `game.settings.register` calls) — check those two files directly if this table and the code ever drift.

The world's singleton timeline JournalEntry that `timelineJournalId` points at is created with the literal name `"Campaign Timeline"` (`scripts/data/timeline-journal.mjs`) — also hardcoded English, not routed through `en.json`, the same deliberate scope as the docx field labels above.

## Docx round-trip notes

- **Type markers.** Export writes a `Campaign Record type: <kind>` marker paragraph at the top of each entry's section (kept as that literal, English string for compatibility with documents exported by the predecessor `campaign-record` module, whose exports this importer also understands). On import, that marker — when present — takes priority over title-keyword heuristics when suggesting a type for a section.
- **GM-content export toggle.** The export dialog's "Include GM Content" checkbox controls whether Session GM notes and relationships hidden from players are written into the `.docx` at all. Leave it unchecked to produce a document safe to hand to players.
- **Date parsing and non-Gregorian calendars.** The import wizard detects session-header dates (`4/15/24`, `April 15, 2024`, …) and converts them into campaign-date components with a **numeric passthrough**: real-world year as-is, month/day mapped straight across. This assumes the world's active calendar's month numbering and count line up with the Gregorian calendar the source document was written against. For a non-Gregorian or non-12-month calendar, this is a known, deliberate approximation — there's no general way to map a real-world date onto an arbitrary in-world calendar without a mapping the source document doesn't provide. Out-of-range results (e.g. "month 14" against a calendar with fewer months) are rejected and reported as a per-section warning rather than silently stored.
- Import/export use the vendored `mammoth` (docx → HTML) and `docx` (HTML model → docx) libraries under `vendor/`; no network calls are made during import or export.
- **Field labels are English-only, regardless of world locale.** The per-type field labels the export writes into the `.docx` itself (Role, Location, Race, Faction, Type, Rarity, …) are literal strings with no i18n hook — a French-speaking GM's exported document will still say "Role" in English. This matches the module's English-only scope (see [Development](#development)) but is worth flagging since it's document *content*, not UI chrome that a future translation could cover.

## Player collaboration notes

Session entries can be made player-writable via the `playersWriteSessions` setting; owning players write their own recap directly through the sheet. Players without file-upload permission (or without ownership at all, when the setting is off) have their recap and inline-image writes relayed through an active GM instead, over the same world socket channel MEJ's own per-user notes save path uses.

**Trust model, stated honestly rather than idealized** (see `scripts/hooks/player-recap.mjs`'s header comment for the full detail): Foundry's client-side socket API gives a receiving client no server-verified sender identity — only whatever the emitting client claims. This module is intentionally **stricter** than MEJ's own precedent (`saveUserData`), not just a copy of it:

- The GM-side handler validates the claimed sender id resolves to a real user in the world before doing anything with it.
- A relayed write is scoped to write **only** `flags.mej-campaign-companion.playerRecaps.<senderId>` on the target document — never any other flag, field, or document. At worst, a malicious client can overwrite another real user's recap text; it cannot touch anything else.
- Every rejected relay is logged.
- The claimed HTML is round-tripped through ProseMirror's own schema (parse → serialize) before it's ever written, dropping anything out-of-schema (event-handler attributes, `<script>`, …). This matters more here than for MEJ's own per-user notes, because a player recap renders to **every other user, including the GM** — an unsanitized relay would let any socket-reachable client plant markup that executes in someone else's client.

What this **doesn't** eliminate: the "impersonate another user's recap" risk from the unverifiable sender id itself. That's a limitation of Foundry's client socket API, not something a module can close without a server-side authority it doesn't have — it's bounded to that one flag path (the same bound MEJ's own precedent accepts), not eliminated. The content-injection risk, unlike the identity risk, is fully closed by the sanitization step.

## Error handling and troubleshooting

- If Monk's Enhanced Journal isn't installed or isn't active, Campaign Companion disables itself at `ready` (`absent` mode) and shows one permanent error notification rather than half-loading with silent failures.
- If MEJ is active but this module's own registration throws in any mode (a bug in this module), a second, more specific `init-failed` error notification is shown instead, and the error is logged to the console.
- A stock MEJ build without the extension API is not an error condition: Campaign Companion runs in `native` mode with no warning — see [Running without the MEJ extension API](#running-without-the-mej-extension-api-050) above.
- Auto-link and auto-capture are pure observers: a failure in either logs to the console and is skipped, and never blocks the underlying page-save or combat-end operation it hooked.
- Docx import is transactional per wizard run — documents are only created on final confirmation, and a failure reports per-section errors with no partial writes.

## Known issues

See [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for the full detail, including the manual verification steps for each item below — this section is a pointer, not a substitute for it.

- Non-`dnd5e` systems, second-display/popout behavior, and Word/Google Docs docx visual fidelity are exercised manually rather than by the automated suites; see the checklist's respective sections.
- A `libWrapper`-vs-Monk's Common Display interaction on the shared-media capture path has a documented manual conflict scan, not an automated one.
- **Knowledge layer (Phase B):**
  - Enricher results (`@CampaignQuery[...]`) refresh on page re-render only, not on live data updates; rebuild the Dashboard to see latest results.
  - Relationship graph caps at the 200 most-connected entries for performance; additional nodes and links to them are excluded from the visualization.
  - Backlinks count only `@UUID` links; plain-text entry names that haven't yet been converted into `@UUID` links by auto-link are caught only once a later auto-link pass has converted them.

## Development

- `npm test` — unit tests (Vitest). No Foundry environment required.
- `npm run test:e2e` — 9 Playwright spec files / 33 tests against a live Foundry v14 world with MEJ and this module installed and enabled (GM + player clients); requires a running, unlocked Foundry test instance reachable at the URL configured in `playwright.config.mjs`, and is not run as part of a plain docs/code review.
- Plain ES modules, no build step, matching both MEJ's and this module's own style — edit `scripts/`, `templates/`, `styles/`, and `lang/en.json` directly.

See [`docs/manual-test-checklist.md`](docs/manual-test-checklist.md) for the manual checks that aren't (yet, or can't be) covered by either test suite.

## License

Copyright © 2026 Dan Bularzik. Licensed under the [MIT License](LICENSE). This module extends [Monk's Enhanced Journal](https://github.com/ironmonk108/monks-enhanced-journal) (GPL-3.0) through its extension API without bundling any of its code; MIT is GPL-compatible, so combined use complies with MEJ's terms.

Vendored third-party libraries retain their own licenses: [mammoth](https://github.com/mwilliamson/mammoth.js) (BSD-2-Clause), [docx](https://github.com/dolanmiu/docx) (MIT), [d3-force](https://github.com/d3/d3-force) (ISC).
