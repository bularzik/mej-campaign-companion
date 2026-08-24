# Changelog

## 0.10.0 (2026-08-24)

- New: **campaigns are openable entities.** Every campaign now has a
  campaign entry inside its folder, named after the campaign. It shows up
  in the journal sidebar, in search, and as an auto-link target — and
  opening it opens the Campaign Hub already scoped to that campaign.
  Existing campaigns get their entry automatically on first load.
- New: **"Open Campaign Hub"** on the right-click menu of any campaign
  folder, in both Foundry's journal sidebar and the Enhanced Journal
  shell.
- New: renaming a campaign folder renames its campaign entry and vice
  versa; deleting the entry never deletes the campaign (campaign settings
  gains "Restore campaign entry"). Campaign entries follow the campaign's
  ownership baseline, including bulk "apply to all members".
- Fixed: several routing and permission defects found while building the
  above — the Hub no longer greys out its own controls for players
  viewing a campaign, and the campaign scope no longer snaps back while
  you are re-scoping the picker.

## 0.9.0 (2026-08-23)

- New: **Hub header bar.** The campaign picker, New Session, and a Tools
  menu (Import, Export, Auto-capture target, User Guide) now live above
  the Hub's tabs instead of being buried on the Index toolbar. Creating
  a campaign moved into the picker itself ("➕ New Campaign…"); the gear
  beside the picker remains the home for campaign settings. The Index
  toolbar keeps only its own controls (type filter, sort, name filter,
  "File all shown…").
- Changed: the **Relationship Graph is now a Hub tab** (between Timeline
  and Search) and follows the campaign picker — a campaign scope shows
  only that campaign's members, All shows the whole world, Unfiled shows
  loose entries. The standalone graph window is retired; an entity's
  graph header button opens the Hub on the Graph tab, centered on that
  entity in its campaign.
- Fixed: opening the graph from an entity now reliably lands on the
  Graph tab in both hosting modes (shell tab and standalone window).

## 0.8.0 (2026-08-23)

- Changed: docx import now **suggests Session** for session-shaped sections
  (dated or "Session N" headers) instead of only pre-checking their
  timepoint box — session logs import as Sessions with no manual retyping.
  Round-trip type markers still take precedence.
- Changed: the import type select no longer offers the legacy "text"
  pseudo-type (it duplicated "Text and Image" since 0.7.0). Old exported
  documents carrying `Campaign Record type: text` markers import as Text
  and Image automatically.
- Improved: the type select is ordered sensibly (Text and Image, Session,
  then the typed sheets, Skip last), and the review step shows
  "N sections detected as sessions" so detection is visible.

## 0.7.0 (2026-08-22)

- Changed: docx import's "Text" rows now create MEJ **Text and Image**
  entries instead of plain unflagged text pages, so imported prose is
  indexed, searchable, auto-linkable, exportable, and opens inside the
  MEJ shell. The row type select shows MEJ's own "Text and Image" label.
- New: the import wizard's "Import into" select lists each campaign's
  subfolders (indented) so a document can be imported directly into an
  existing subfolder; the governing campaign (timeline, audience
  baseline) is resolved from the chosen folder's campaign.
- New: the import destination and campaign-choice prompts default to the
  campaign currently scoped in the Hub picker, and the New Entry dialog's
  folder select defaults to the folder of the entry open in the MEJ shell
  (implemented entirely companion-side; MEJ stays unpatched).
- Fixed: an open sheet's "Mentioned in" list now updates live when a
  mention is added or removed elsewhere (including auto-linked mentions),
  instead of staying stale until the sheet re-renders.

## 0.6.0 (2026-08-22)

- New: **Campaigns**. A campaign is a journal folder the companion manages:
  everything inside it — typed entries, plain journal entries, imported
  prose — is a member, and multiple campaigns can share one world. The
  Campaign Hub gains a campaign picker (All campaigns / each campaign /
  Unfiled) that scopes the Index, Search (with an "N more matches in other
  campaigns" jump), Dashboards, Secrets, and the Timeline, which is now
  per-campaign instead of one world singleton.
- New: plain journal entries are first-class Hub citizens — they list in
  the Index as "Journal" rows and are covered by campaign scoping, fixing
  imported prose being invisible to the Hub.
- New: campaign ownership baseline (GM only / players view / players
  edit) stamped on entries created into the campaign, with a bulk "apply
  to all members" action and a per-entry hide/reveal toggle that restores
  the campaign baseline on reveal. Hidden entries are never revealed by
  the bulk apply.
- New: the docx import wizard gains an "Import into" campaign destination
  (with "New Campaign…"), an optional per-document subfolder, and a
  "Campaign default" audience option; import timepoints file onto the
  chosen campaign's timeline.
- New: auto-capture targets a campaign (Hub crosshairs button); with
  campaigns present but no target set, captures decline with a clear
  message instead of creating loose entries. The world's first campaign
  becomes the target automatically.
- New: one-time adoption offer for existing worlds — creates a campaign
  from the world's typed entries and its legacy timeline, non-destructively;
  everything else is filed by hand from the new Unfiled view ("File into
  campaign…" / "File all shown into…").
- Fixed: cross-campaign timeline discipline — entries only attach to their
  own campaign's timepoints (actors, scenes, items, and images are exempt).
- Fixed (tests): a pre-existing e2e cleanup helper deleted the world's real
  "Campaign Timeline" journal by name on every run; cleanup is now
  id-tracked and content-guarded.

## 0.5.3 (2026-08-21)

- Fixed: the Campaign Hub's type and sort dropdowns rendered a white panel
  in dark mode (unreadable against the theme's light text). The stylesheet
  leaned on CSS variables Foundry v13/v14 no longer defines, so light
  fallbacks rendered in both themes.
- Fixed: the same sweep repaired every other surface with the problem —
  row hover highlights and tag/link chips that were invisible on dark
  backgrounds, the import wizard's always-light sticky table header, the
  relationship "S" badge's light-on-white text, and the relationship
  graph's near-black edges, labels, and node outlines that vanished on the
  dark window surface.

## 0.5.2 (2026-08-20)

- New: two user guides — [`docs/gm-guide.md`](docs/gm-guide.md) and
  [`docs/player-guide.md`](docs/player-guide.md) — walking the GM and player
  experience end to end, illustrated with 23 screenshots captured from a
  seeded demo campaign; linked from the README.
- New: a Help button on the Campaign Hub's Index toolbar that opens the
  published user guide in a new browser tab — the GM guide for GMs, the
  player guide for everyone else.
- New: a gated screenshot-capture spec
  (`tests/e2e/guide-screenshots.spec.mjs`, run via
  `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs`)
  that seeds the demo campaign and regenerates every guide screenshot
  against a live world, and a guide link/anchor checker
  (`tests/docs/check-guide-links.mjs`, `npm run check:links`), now also run
  as a CI step.

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
