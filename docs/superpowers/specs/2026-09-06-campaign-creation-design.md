# Campaign creation — design

Date: 2026-09-06. Target release: 0.19.0 (dataVersion 7). Companion-side only; MEJ is not modified.

## Background

A campaign in this module is a root-level `JournalEntry` folder carrying the
`flags.mej-campaign-companion.campaign` flag, plus a **portal** entry (one
`mej-campaign-companion.campaign` page) and a **timeline** journal inside it.
Users find creating one confusing, for five reasons found in the code:

1. **Dead Campaign pages.** In API mode `registerSheetType({key: "campaign"})`
   puts *Campaign* into MEJ's New Entry dialog; in both modes the core
   "Create Page" dialog lists `mej-campaign-companion.campaign` because
   `module.json` declares it and MEJ's filter only strips its own prefix. In
   API mode MEJ's dialog can list it twice (Foundry type labels under
   "Adventure Book", MEJ registry under "Single Sheet"). Picking it makes a
   campaign-typed page with no folder; `campaignOf()` is null and the Hub
   silently renders whatever scope was active (`CampaignHubPage.mjs:286-297`).
2. **No front door outside MEJ.** Every sanctioned creation path (Hub picker
   "➕ New Campaign…", adopt-world banner, import wizard "New Campaign…") lives
   inside the Hub, which lives inside the MEJ shell.
3. **Folder ≠ campaign is invisible.** Campaign folders look like any folder;
   a plain folder someone built as "their campaign" can't be promoted except
   by the zero-campaign adopt banner.
4. **Timeline appears by side effect.** `createCampaign()` creates folder +
   portal; the timeline is created by the next GM Hub render scoped to the
   campaign (`CampaignHubPage.mjs:311` → `ensureTimelineJournal`).
5. Docs say "Session and Campaign don't appear in MEJ's New Entry dialog" —
   true only in native mode, and not true for the core Create Page dialog.

## Decisions

- Front door: a GM-only **New Campaign** button in the Journal sidebar
  header (core sidebar and MEJ's shell copy). Hub picker stays as a
  secondary path.
- *Campaign* is removed from every page-type picker. A campaign page created
  any other way (API, macro, import) is **auto-upgraded** into a proper
  campaign when that can be done cleanly, and refused otherwise.
- The timeline is created **eagerly** by `createCampaign()`. dataVersion 7
  backfills a timeline for every existing campaign folder and upgrades
  existing loose campaign pages.
- Campaign folders get a distinct **flag icon**; a plain root folder can be
  converted in place via the folder context menu.
- Multiple timelines per campaign and world-level timelines stay supported
  and unchanged.

## §1 Atomic creation and the shared dialog

`createCampaign(name, { ownershipDefault })` (`scripts/data/campaign-store.mjs`)
builds the whole structure, in order: `Folder.create` (root, flagged) →
`ensureCampaignPortal(folder)` → `ensureTimelineJournal(folder)`. The
first-campaign auto-capture seeding stays. Foundry has no transactions: if
the portal or timeline write throws, the error is logged (`console.error`,
module prefix), the folder is still returned, and the two idempotent
`ensure*` helpers remain the repair points (a later Hub open or migration
completes the structure; nothing is duplicated).

New `convertFolderToCampaign(folder, { ownershipDefault })` in the same
file: for a plain **root** `JournalEntry` folder, stamps the campaign flag
(`folder.update`), then the same two `ensure*` calls. Existing entries stay
where they are. Returns null (no writes) for nested folders, folders that
are already campaigns, non-`JournalEntry` folders, and non-GMs. Eligibility
is a pure function `canConvertFolder(folder)` in `scripts/logic/campaigns.mjs`.

The New Campaign dialog moves out of `CampaignHubPage.onNewCampaign` into
`scripts/apps/new-campaign-dialog.mjs`:
`promptNewCampaign({ name = "" } = {}) → Promise<{ name, baseline } | null>`.
Same two fields (Name; Player access with `none`/`observer`/`owner`,
`observer` preselected), same i18n keys (`hub.newCampaign*`,
`hub.baseline.*`); `name` pre-fills the input. Returns null on cancel or
blank name. Callers: Hub picker, adopt banner, sidebar button, folder
conversion. The import wizard keeps its current no-prompt behaviour
(campaign named after the document).

The Hub's render-time `ensureTimelineJournal(campaign)` is unchanged; after
this change it only fires when a timeline was deleted.

## §2 Sidebar front door, folder icon, folder conversion

New `scripts/hooks/campaign-directory.mjs`, following the
`timeline-directory.mjs` pattern: `renderJournalDirectory` (core) and
`renderEnhancedJournal` (MEJ shell copy), both idempotent against MEJ's
re-renders. `registerCampaignDirectory()` is called from
`campaign-companion.mjs` at the same point `registerTimelineDirectory()` is.

**New Campaign button.** GM only (`game.user.isGM`), and only when the
directory shows a create-folder button (i.e. never in compendium
directories, never without folder-create permission). Inserted after
`button.create-folder` inside `.directory-header .header-actions` (core
`templates/sidebar/directory/header.hbs`; MEJ shell `templates/directory.html`
has the identical structure). Markup:

```html
<button type="button" class="mej-cc-create-campaign">
  <i class="fa-solid fa-flag" inert></i><span><localized campaign.createButton></span>
</button>
```

(icon + text label, matching the Create Entry / Create Folder buttons beside it.)

Click → `promptNewCampaign()` → `createCampaign()` → info toast
`campaign.created` ("Campaign "{name}" created."). It does not switch Hub
scope or open anything; the folder appears in the sidebar the user is
looking at. A null result from `createCampaign` (non-GM race) shows the
existing generic failure toast pattern (`ui.notifications.error`).

**Campaign folder icon.** Every folder row (`[data-folder-id]`) whose folder
is `isCampaignFolder` gets its header icon (`.folder-header > i`, or the
first `i` in the header) swapped to `fa-solid fa-fw fa-flag` and the class
`mej-cc-campaign-folder` added to the `li`. Styling (a slightly stronger
header) in `styles/`.

**Make this folder a campaign.** `scripts/hooks/folder-context.mjs` adds a
second option next to "Open Campaign Hub": name `campaign.convertFolder`,
icon `fa-flag`, condition `game.user.isGM && canConvertFolder(folder)`.
Callback: `promptNewCampaign({ name: folder.name })` → if the returned name
differs from `folder.name`, `folder.update({ name })` first → `
convertFolderToCampaign(folder, { ownershipDefault: baseline })` → toast
`campaign.converted`. The idempotent `addOption` guard covers both options.

Native mode (stock MEJ) gets the core-sidebar half of all three; the shell
half applies only when a shell exists, which the `renderEnhancedJournal`
hook gates naturally.

## §3 The guard: closing the doors, upgrading strays

New `scripts/hooks/campaign-guard.mjs`, `registerCampaignGuard()` called at
`ready` (after MEJ's module-level `renderDialogV2` hook, so MEJ's select
exists when ours runs). Pure decisions live in
`scripts/logic/campaign-guard.mjs`.

**Dialog stripping** (`renderDialogV2`): remove `option[value="campaign"]`
and `option[value="mej-campaign-companion.campaign"]` from
`select[name="flags.monks-enhanced-journal.pagetype"]` (MEJ New Entry
dialog, all optgroups) and from `select[name="type"]` (core Create Page
dialog). Both modes. If the removed option was selected, select the first
remaining option. Session is untouched.

**Classification** — `classifyCampaignPageCreate({ isPortal, isGM,
entryPageCount, entryInCampaign })` returns:

| Result | When |
|---|---|
| `ignore` | `isPortal` (the page carries `flags[MODULE_ID].campaignPortal`) |
| `block-not-gm` | `!isGM` |
| `block-multipage` | the parent entry already has ≥1 other page (`entryPageCount > 0` at preCreate) |
| `block-in-campaign` | the parent entry's folder resolves to a campaign (`campaignOf(entry)` non-null) |
| `allow` | otherwise — a fresh single-page campaign entry at root or in a plain folder |

Three creation shapes exist and each needs its own interception point,
because MEJ's New Entry path creates the *entry* first and adds the page in
`_onCreate` (cancelling the page would strand an empty entry), and pages
created inline with `JournalEntry.create({ pages: [...] })` fire no page
hooks of their own:

| Shape | Detect at | Upgrade at |
|---|---|---|
| MEJ New Entry dialog (`flags.monks-enhanced-journal.pagetype` = `campaign` or `campaign:*` on the entry data, no pages yet) | `preCreateJournalEntry` | `createJournalEntryPage` |
| Entry created with an inline campaign page (API/macro/import) | `preCreateJournalEntry` (inline pages inspected) | `createJournalEntry` |
| Campaign page added to an existing entry (core Create Page dialog, API) | `preCreateJournalEntryPage` | `createJournalEntryPage` |

**Pre-create hooks** (synchronous, creating client): classify with the
table above — for the entry-level hook, `entryPageCount` is the number of
*other* inline pages and `entryInCampaign` resolves the `folder` in the
creation data. Any `block-*` result returns `false` and shows a warn toast
`campaign.strayBlocked` ("Campaign pages are created with the New Campaign
button in the journal sidebar."). `ignore` and `allow` return normally.

**Create hooks** (`createJournalEntry`, `createJournalEntryPage`; only when
`userId === game.user.id` and `game.user.isGM`): an entry that now holds
exactly one non-portal campaign page and resolves to no campaign is
upgraded by `upgradeEntryToCampaign(entry, { ownershipDefault: "observer" })`
in `campaign-store.mjs`: `Folder.create` (root, flagged, named after the
entry) → `entry.update({ folder, ownership: { default: baseline } })` →
`page.update` with `buildCampaignPortalData(entry.name)` minus `name`
(portal marker + MEJ interop flags + companion flags) →
`ensureTimelineJournal(folder)` → info toast `campaign.strayUpgraded`
("Created campaign "{name}" from this entry."). Upgrades are serialized on
a module-level promise chain (same shape as `retroChain`), and the executor
re-checks `campaignOf(entry) === null` and the portal marker at run time,
so the two create hooks firing for the same entry, or rapid creates, cannot
double-upgrade.

Net effect: a `campaign`-typed page can exist only as a portal inside a
flagged folder. `isCampaignPortalPage` and its four-signal match are
unchanged.

## §4 Migration — dataVersion 7

`CURRENT_DATA_VERSION` → 7. Runs once on the active GM at `ready`, in the
existing versioned block of `campaign-companion.mjs`, before the version
stamp.

Planning is pure: `scripts/logic/campaign-migration.mjs` →
`planCampaignStructure({ folders, entries })` where `folders` are
`{ id, isCampaign, hasTimeline }` and `entries` are
`{ id, uuid, pageCount, strayCampaignPage: boolean, inCampaign: boolean }`.
Returns `{ timelineFor: [folderId], upgrade: [entryId], skipped: [{ uuid,
reason: "multipage" | "in-campaign" }] }`.

Execution:

1. For each `timelineFor` folder → `ensureTimelineJournal(folder)`.
   Folders with one or more timelines are untouched.
2. For each `upgrade` entry → `upgradeEntryToCampaign(entry)` (§3).
3. `skipped` entries are left alone: one `console.warn` per entry with uuid
   and reason. No deletions.
4. Toast `migration.campaignStructure` with counts ("Campaign structure:
   {timelines} timeline(s) created, {campaigns} campaign(s) created from
   loose pages."); when `skipped` is non-empty, a second permanent warn
   toast `migration.campaignStructureSkipped` ("{count} campaign page(s)
   could not be converted — see the console.").

Each step is `try/catch` with `console.error`, like the existing steps; a
failed step does not block the version stamp (the `ensure*` helpers are
idempotent and the Hub's repair path still exists).

## §5 Existing call sites, docs, i18n

- `CampaignHubPage.onNewCampaign` → `promptNewCampaign()` then
  `createCampaign()`; still sets `state.campaignId`, persists
  `HUB_CAMPAIGN_SCOPE_SETTING`, re-renders. `onAdoptWorld` same swap.
  Import wizard `__new` → unchanged call (now gets a timeline).
- Hub stray-portal branch (`CampaignHubPage.mjs:286-297`): when the mounted
  campaign page has no campaign, show a warn toast `campaign.noCampaignFolder`
  ("This page isn't inside a campaign folder — use New Campaign in the
  journal sidebar.") once per mount, then render as today. Reachable only
  for §4's skipped strays.
- `docs/gm-guide.md` "Campaigns" section rewritten: a campaign is folder +
  portal + timeline created together; three ways in — sidebar New Campaign
  button (primary; works with or without MEJ open), Hub picker, right-click
  Make this folder a campaign; the flag icon; timeline created with the
  campaign (the "first time you scope the Hub…" paragraph is removed). The
  native-mode section's line becomes "Campaign is never offered as a page
  type; Session appears in the New Entry dialog only in API mode."
  `README.md` campaign blurb, `docs/player-guide.md` (one line on the flag
  icon), `CHANGELOG.md` 0.19.0.
- `lang/en.json` keys: `campaign.createButton`, `campaign.created`,
  `campaign.convertFolder`, `campaign.converted`, `campaign.strayBlocked`,
  `campaign.strayUpgraded`, `campaign.noCampaignFolder`,
  `migration.campaignStructure`, `migration.campaignStructureSkipped`.
- Release 0.19.0, dataVersion 7, no new zip paths.

## §6 Testing

**Unit (vitest):** `planCampaignStructure` — folder with/without timeline,
multiple timelines untouched, stray single-page → upgrade, stray multipage
→ skipped, stray in campaign → skipped, portal pages ignored;
`classifyCampaignPageCreate` — every row of the §3 table;
`canConvertFolder` — root plain folder yes; nested, campaign, non-journal
no.

**e2e v14 (World A, id-tracked cleanup; ownership-offer dialog answered
No):** new `tests/e2e/23-campaign-creation.spec.mjs`:
- sidebar button creates folder + portal + timeline in one click (core
  sidebar and MEJ shell sidebar); player seat sees no button;
- flag icon on campaign folder rows, none on plain folders;
- right-click convert on a root folder: entries stay, portal + timeline
  appear; no option on nested or campaign folders;
- MEJ New Entry and core Create Page dialogs offer no Campaign option;
- API-created campaign page on a fresh entry is upgraded (folder, portal
  flags, timeline, toast); inside an existing campaign, or into a
  multi-page entry, refused with the toast;
- migration: set dataVersion to 6, seed one campaign without timeline, one
  single-page stray, one multipage stray, reload as GM → timeline
  backfilled, one campaign created, one skipped with console warning.

`14-campaigns` test 7 flips to assert the timeline exists right after
creation. `02-hub-timeline` (world singleton) and `15-campaign-portal`
unchanged. Cleanup for spec 23 closes the MEJ shell first and deletes
journals in tracked folders (lesson from spec 22).

**v13 stock gate (Foundry 13.351 + MEJ 13.06, native):** sidebar button,
flag icon, core Create Page stripping.

**Guide images:** one new `docs/images/campaign-create-button.png` via the
`GUIDE_SHOTS` spec; `settings.png` unaffected.

## Out of scope

- Nested campaigns (still refused by construction).
- Removing Session from MEJ's New Entry dialog.
- A folder-level "New Campaign" inside the Create Folder dialog (considered
  and declined: campaigns are root-only and that dialog serves all folder
  types).
- Deleting stray campaign pages the migration cannot convert.

## Deviations

(Recorded during implementation.)
