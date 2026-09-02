# Changelog

## 0.15.0 (2026-09-02)

Foundry 13 support. No data changes, nothing is migrated.

- **Runs on Foundry VTT 13 with Monk's Enhanced Journal 13.06.** One build
  serves both Foundry 13 and 14; the manifest floors are now Foundry 13 and
  MEJ 13.06. MEJ 13.06 has no extension API, so on Foundry 13 the companion
  always runs in `native` mode: the Campaign Hub and a newly created Session
  open as standalone windows, a Session or Hub page opened from the journal
  sidebar renders inside MEJ's shell tab, and everything else is unchanged.
- **Opening a Session or the Hub from the journal sidebar under a stock MEJ
  no longer shows an empty page.** MEJ's shell awaits the sheet's render but
  MEJ's own sheet render is not awaitable; the media sheets already carried
  the workaround and the Session sheet and Hub now share it.
- One small platform shim for browsers Foundry 13 still supports
  (`URL.parse`), plus unit coverage pinning the secret-block reveal-toggle
  fallback that Foundry 13 needs. Behaviour on Foundry 14 is unchanged.
- Test harness: `FOUNDRY_TARGET=v13` preset, a guard against running the
  suite on the wrong server, and the stock-smoke gate now asserts the
  sidebar open of a session (`npm run e2e:stock:v13`).

## 0.14.0 (2026-09-02)

Schema change. On the first GM load, block-secret reveal records move
from the journal entry onto the page that holds the secret; the old
entry-level record is left in place as a rollback copy and is no longer
read. A record whose section exists on more than one page of an entry
is copied to each of them, so nothing a player could see changes. A
record whose section exists on no page is not copied; the console lists
each one.

- **Revealing a secret on one page no longer touches another page's
  copy.** Duplicating a page kept the secret's id, so un-revealing from
  the Hub could strip the wrong page's reveal.
- **Opening one page no longer deletes another page's reveal records.**
- **The Hub Secrets tab lists every page's secrets** on a multi-page
  entry, labels rows by page, and whispers the real section text from
  the right page instead of a preview.

## 0.13.6 (2026-08-30)

Fix round. Nothing is migrated, and no data changes.

- **A dashboard query that cannot mean anything is rejected** instead of
  quietly returning nothing. `attr:` with no attribute name, for example,
  asked for an attribute no entry can have, so the dashboard sat empty
  with no explanation. Plain text, unbalanced brackets and stray quotes
  are still ordinary full-text searches — only genuinely meaningless
  tokens are refused, and the message now says which one.
- **Search results no longer show link markup.** A snippet could read
  `…rnalEntry.rMYO0mN9F6sSvpxN]{The Missing Caravan}` instead of the
  link's own text.
- **In a world with no campaigns yet, the controls that need one say so.**
  "File into campaign…", "File all shown into…" and the Tools menu's
  "Auto-capture campaign" used to sit there looking normal and do nothing
  at all when clicked. They are now disabled with an explanation. The
  import wizard's summary also reads "1 section detected as a session"
  instead of "1 sections".
- **The session prep board names its attendees.** They were an unlabelled
  row of portraits; the name was only in the hover tooltip.
- **The campaign portal no longer shows an empty "Mentioned in" panel**
  underneath the Campaign Hub. The portal page is the Hub; there is
  nothing on it to be mentioned in.
- **A player no longer sees Foundry's own Hide button** on a secret that
  was revealed to everyone. Pressing it could not actually have hidden
  anything — the server refuses the write — but it had no business being
  there.
- **Session sheets no longer open with a broken image and five empty
  fields.** A Session with no image of its own used to show Foundry's
  internal page schema — page name, type, file path, category, sort
  order — as blank boxes next to a portrait that could never load. A
  Session's real details live on its Session tab, so that header is now
  drawn only when it has something to show: a Session that does carry an
  image keeps its usual header, and a GM on an image-less Session gets a
  compact row instead, with the name field and an Add image control.
- **The timeline's picker and its buttons sit on one row again.** The
  selector, "Make default", rename and delete had each been pushed onto a
  line of their own, shoving the timeline itself down the pane.
- **A GM can see the players' recaps again.** On the Session sheet, the
  GM's own — usually empty — recap editor was claiming the whole Player
  Recaps block and pushing everyone else's recap off the bottom of the
  sheet, where it was clipped. The recaps were always saved; they just
  were not on screen.
- **Clicking a secret's audience button works reliably, and a long entry
  can be scrolled to read in full.** Two causes, both fixed at the root:
  the "Mentioned in" panel could be injected twice into one sheet during
  a render race, squeezing the sheet body down until every control below
  the header was correctly placed and never painted; and the
  enriched-preview column, once given a real height instead of that
  squeeze, needed its own scrollbar back so a long body is not clipped.
- No user-facing change: the vendored `mammoth` bundle is now pinned to
  `1.12.0` with a checksum manifest and an opt-in check against upstream;
  the e2e test harness identifies timeline journals by their own flag
  rather than by name, and waits for a session-bound document at every
  navigation.

## 0.13.5 (2026-08-29)

- **User guides and screenshots rewritten for the 0.13.x Hub.** The header
  bar and Tools menu, all six panes, campaigns and the campaign picker,
  the player portal, multiple timelines, portraits, and Foundry-native
  "Everyone" reveals are all documented and illustrated as they work
  today. The previous guides still described the pre-0.9.0 toolbar.
- **Fixed four end-to-end test issues at their roots** — a migration test
  that polled a stale data-version literal (never actually a flake, just
  broken by an unrelated version bump), a name-keyed timeline lookup, a
  name-keyed cleanup step, and a Foundry login race the harness now waits
  out at the real ready condition. This changes nothing for users of the
  module; it only makes the test harness reliable.

## 0.13.4 (2026-08-29)

Performance round. Nothing is migrated, and no data changes.

- **Importing a document no longer asks you the same question over and
  over.** Bringing in a 50-section file used to pop the auto-link review
  dialog fifty times, one after another, and search the whole journal from
  scratch before each one. The batch is now reviewed in a single dialog
  listing every new entry, and the journal is searched once. The same
  applies when you log in to a backlog of entries created while no GM was
  connected.
- **Typing in the Hub's filter box no longer restarts the relationship
  graph.** Every keystroke used to tear the graph down and start its layout
  physics again from scratch — even while you were on a different tab and
  couldn't see it. The graph is now built when you open its tab, and left
  alone otherwise.
- **Fixed a slow leak in the "Mentioned in" panel.** Every journal sheet
  ever opened stayed held in memory for the rest of the session, so long
  sessions with many sheets got gradually heavier.

## 0.13.3 (2026-08-28)

Secrets round. **This release runs a one-time conversion when your world
loads: it rewrites the secret markup in journal pages that had secrets
revealed to Everyone.** Only the reveal marker on those secret blocks
changes — your text is not touched otherwise — but it is an automatic
edit to your journal content, so back up your world first if that matters
to you. It runs once, on the GM's client, and does nothing on later loads.

- **"Everyone" now means what Foundry means by it.** Revealing a secret to
  Everyone used to be a Campaign Companion arrangement that only Campaign
  Companion understood: the secret still looked unrevealed on a core
  journal sheet, to anyone at the table without this module, and in a
  player-safe Word export. It now sets Foundry's own reveal on the block —
  the same thing Foundry's built-in Reveal control does — so all of those
  honor it, and the two controls no longer contradict each other on the
  same secret. Reveals to specific players or groups are unchanged.
- **Secrets you write in a Session recap can finally be revealed.** They
  showed up in the Hub's Secrets tab but had no audience control anywhere,
  so there was no way to actually show one to a player. The recap now
  behaves like any other entry's description: audience control on the
  secret, a working control on its tracker row, and the reveal reaches the
  player.
- **Existing "Everyone" reveals are converted for you** by the one-time
  pass described above. A secret whose block has since been deleted or
  edited away is left exactly as it is and keeps reading as revealed to
  everyone, so nothing goes dark on you.

## 0.13.2 (2026-08-28)

Second bugfix round. No new features; nothing is migrated.

- **Fixed: the "new dashboard" dialog no longer throws away what you
  typed.** Leaving a field blank used to close the dialog and discard the
  name and query both; it now stays open with your text intact.
- **Fixed: reveals now reach popped-out sheets.** A player watching a
  secret in its own window saw nothing when you revealed it — they had to
  close and reopen the sheet.
- **Fixed: moving a player into or out of a group takes effect
  immediately**, rather than at whatever render happened to come next.
- **Fixed: reveal records for deleted relationships are cleaned up**
  instead of accumulating forever.
- **Fixed: an auto-captured Encounter is named after the scene the combat
  actually happened on**, not whichever scene the GM was looking at.
- **Fixed: dragging a graph node while the graph redraws no longer
  disturbs the new graph.**
- Assorted robustness: adding a timepoint with no position now appends
  rather than inserting at the top, editing a saved dashboard no longer
  updates the display before the save succeeds, and several click
  handlers no longer assume the element they were fired from.

## 0.13.1 (2026-08-28)

Bugfix and hardening round. No new features; nothing is migrated.

- **Fixed: a person attribute you mark "player hidden" is now actually
  hidden from player searches straight away.** Previously the change only
  took effect after a world reload — until then the value stayed
  findable in every player's search while the GM had every reason to
  believe it was hidden.
- **Fixed: "File all shown" can no longer refile entries outside the
  Unfiled view.** The button is only offered there, but the action behind
  it could still be reached, and in the "All" view it would have swept
  every campaign's entries into a single campaign with no confirmation.
- **Fixed: auto-captured Encounter write-ups are no longer overwritten.**
  If the same combat's end was captured twice, anything the GM had
  written on that Encounter page was replaced by a regenerated summary.
  The generated summary now updates in place and leaves your own text
  alone.
- **Fixed: a damaged image inside an imported .docx no longer kills the
  import silently.** The import used to stop with no error and no result
  dialog, after some entries had already been created. Damaged images are
  now reported and skipped, and an unexpected failure still shows what
  was created.
- **Fixed: a player recap saved at the same moment as the rest of the
  session form no longer races it.**
- Security hardening: journal content is parsed with an inert parser
  everywhere, so markup inside a page can't act while it is merely being
  read; the media-upload relay now rejects reply paths that point outside
  its own upload folder, and rejects mismatched chunks within one upload.
- The bundled third-party libraries now carry a provenance file and a
  checksum check that runs in CI, so a change to them can't pass
  unnoticed.
## 0.13.0 (2026-08-28)

- New: **Relationship graph nodes show the entity's picture**, clipped
  into the node circle — a person's portrait, a place's illustration, or
  Monk's Enhanced Journal's per-type icon when no picture is set. Nodes
  are slightly larger to make the pictures legible.

## 0.12.0 (2026-08-28)

- New: **PDF and video pages open inside the Enhanced Journal.** A
  campaign's reference PDFs and session recordings now render in the
  journal's own window, with its chrome and the tags/attributes/mentions
  panel, instead of opening in a separate Foundry window.
- New: **PDFs and recordings get their own Hub index rows** — their own
  icons and "Document" / "Recording" filter chips, instead of being
  lumped in with plain journal entries.
- Video pages honor their own settings: start timestamp, volume, loop,
  autoplay, controls, and an explicit width/height. YouTube links render
  as a proper embed rather than a broken player.
- Nothing is converted and nothing is migrated: these stay ordinary
  Foundry pdf/video pages. Disabling the module restores Foundry's stock
  behavior for them exactly.

## 0.11.0 (2026-08-24)

- New: **a campaign can hold several named timelines.** Keep world
  history apart from session events; the Timeline tab gains a picker
  listing the campaign's timelines (the default marked ★), and GMs can
  create, rename, delete, or re-designate the default from beside it.
- New: **world timelines** — a timeline that belongs to no campaign,
  shown in the All-campaigns scope. Unlike a campaign's own timeline, a
  world timeline accepts links from any campaign, so shared history can
  reference everything.
- New: each campaign designates one **default timeline**, and everything
  filed automatically (combat captures, imported session timepoints,
  media shared with players) goes there — no prompts mid-session.
- Existing worlds are unaffected: a campaign's single timeline simply
  becomes its default, with no migration and no settings to change.
- Fixed: which timeline received automatic filing could change after a
  reload; the timeline picker could display one timeline while showing
  another; and a GM-only timeline could reveal its entry labels to
  players in the All-campaigns view.

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
