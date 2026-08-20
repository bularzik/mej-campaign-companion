# Changelog

## Unreleased

- New: a Help button on the Campaign Hub's Index toolbar that opens the
  published user guide in a new browser tab — the GM guide for GMs, the
  player guide for everyone else.

## 0.5.1 (2026-08-17)

- Fixed: in native mode (stock MEJ, or `forceNativeMode`), the standalone
  Campaign Hub window rendered with every control disabled — New Session,
  search, even the window close button. The Hub's host document stub was
  missing the `permission` getter MEJ's sheet editability check reads, so
  MEJ treated the window as read-only and disabled its whole form. Found by
  the new stock-MEJ smoke test on its first live run.
- New: a manually-gated stock-MEJ smoke test (`STOCK_PHASE`), run against a
  genuinely stock Monk's Enhanced Journal 14.01 before this release: native
  mode resolves cleanly, the Hub and New Session flow work, Hub search finds
  stock-created sessions, and a world that visited stock MEJ returns to an
  API-carrying build with its type flags automatically healed.

## 0.5.0 (2026-08-17)

- Works on a stock Monk's Enhanced Journal install: the module no longer needs
  the `setupMonksEnhancedJournal` extension API. A new adapter resolves
  `api` / `native` / `absent` mode, and everything that never needed the API
  (search, auto-linking, retroactive linking, encounter and media capture, the
  knowledge panel, the query enricher, secrets and relationship reveals) now
  registers in every mode.
- Session pages are identified by their native Foundry subtype rather than
  MEJ's type flag. On a stock install that flag is scrubbed and MEJ reports
  Sessions as untyped, which previously would have dropped them from search,
  auto-linking, the Hub index, export and the graph.
- Native mode: the Session sheet registers through core Foundry and the
  Campaign Hub opens as its own window. New **New Session** button in the Hub.
- Worlds can move between a stock and an API-carrying MEJ build with no
  migration: the GM's client re-stamps type flags a stock install scrubbed.
- New hidden client setting `forceNativeMode` to exercise native mode on a
  build that does have the API.

## 0.4.0 (2026-08-16)

- Auto-linking is now bounded by audience containment on every path: a name only links to an entity when everyone who can view the page can also view the entity.
- Docx import auto-links imported text at creation; new Audience choice in the import wizard sets created-entry ownership and bounds link targets.
- New Retroactive Auto-Link world setting (off/confirm/silent): creating an MEJ entity links existing plain-text mentions of its name, with a GM review dialog or whispered summary; entities created while no GM is online are processed at next GM login.
- Ambiguous names (shared by multiple in-audience entities) are never auto-linked; they are reported instead.

## 0.3.0

**Added:**
- **Block-level secrets** — mark arbitrary text blocks as secrets on native secret sections, with per-player and per-player-group reveal toggles.
- **Player groups** — name groups of players and manage membership dynamically within the Hub, used as reveal targets.
- **Relationship reveals** — per-edge visibility and labels, showing players only their accessible graph edges and metadata.
- **Hub Secrets tab** — filter unrevealed secrets by player, group, or session; "what does player X know" cross-campaign view; player group management.
- **Session prep board** — GM-only reveal tracker on Session entries to log which secrets have been revealed to whom.
- **Reveal whispers** — private notifications to players when they are added to a secret's reveal audience, with the secret text and session context.
- **Player-safe docx export** — unrevealed secret blocks are now excluded from exported `.docx` files when the "Include GM Content" toggle is off.

**Fixed / Internal:**
- Hardened secret-block attribute parsing against malformed or unexpected document structures.
- Sheet-header buttons are currently unreachable due to an upstream MEJ v14 header-injection bug; the relationship graph remains accessible via the Hub toolbar, and the prep board opens via the button on the Session sheet.

## 0.2.0

**Added:**
- **Backlinks panel** ("Mentioned in") on every MEJ sheet type, showing which campaign entries link to the current entry; Hub entry index displays mention-count badges.
- **Tags and attributes** — custom annotations on MEJ entries with per-row `playerHidden` flag for sensitive attributes.
- **Relationship graph** — visual d3-force graph of entries connected via MEJ's `relationships` flags, ego-mode and whole-campaign toggle, an optional dashed backlink overlay for `@UUID` mentions, 200-node connection cap.
- **Hub Dashboards tab** — saved queries with grammar support (`type:`, `tag:`, `attr:`, free-text); `@CampaignQuery[...]` page enricher for inline query results on any MEJ sheet.

**Fixed / Internal:**
- Added comprehensive unit coverage for `handleUploadRequest` validation and docx run segmentation.
- Documented the claimed-senderId trust model for the media-upload relay (`scripts/hooks/media-relay.mjs`).
- Removed dead `auto-link-baseline` module.
- Added GitHub Actions CI running the unit test suite on every push.

## 0.1.0

Initial release.

- **Session journal type** — a new MEJ page type with session number, in-world campaign date, GM recap, per-player recaps, attendee tracking, a checklist of secrets with GM reveal/hide, and GM-only notes.
- **Campaign Hub** — a "Campaign" home tab integrated into MEJ's tabbed journal shell (index, timeline, and search panes), also reachable from the scene-controls notes group.
- **Campaign timeline** — a single world timeline of timepoints bound to in-world calendar dates, holding links to any document or a raw image, with manual/creation/campaign-date ordering and fractional-key drag-reorder.
- **Cross-journal search** — an inverted index over MEJ entry fields and Session fields, with GM-only fields filtered per-user at query time, built lazily and kept current via document hooks.
- **Auto-link** (opt-in setting) — newly-typed mentions of existing MEJ entry names become `@UUID` links on page save.
- **Auto-capture** (two independent opt-in settings) — combat end creates/updates an MEJ Encounter entry filed onto the timeline; GM "Show Players" images/video auto-file onto the timeline too.
- **Docx import** — a wizard imports a `.docx` into MEJ entries and Session pages, with per-section type suggestions, inline images, and dated-header timepoint detection.
- **Docx export** — selected MEJ entries and the timeline export to a round-trippable `.docx`, with an opt-in toggle for GM-only content.
- **Player collaboration** (opt-in setting) — players can own and write their own Session recaps directly, or relay recap/image writes through an active GM when they lack upload permission.
- Requires Foundry VTT v14 and a Monk's Enhanced Journal build with the extension API (targeting the release after 14.01); the module detects a missing/pre-API MEJ at startup and disables itself with a clear notification rather than half-loading.
