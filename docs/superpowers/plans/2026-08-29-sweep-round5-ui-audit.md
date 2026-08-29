# Live UI audit — 2026-08-29 (source of truth for the guide rewrite)

Every statement below was read off a live screen or a DOM dump taken from one.
Nothing here is inferred from `CHANGELOG.md` or from the templates. Where a
screen could not be reached, it says so instead of guessing.

## Method and environment

- Foundry **14.367**, world **world-a**, dnd5e 5.3.3.
- Monk's Enhanced Journal active (manifest reports `14.01`); Campaign
  Companion active, served from this checkout. The server's cached manifest
  reports the module version as `0.9.0` because the Foundry process has been
  up since before the version bump — the **code** on disk and served is the
  current 0.13.4 tree (verified on screen: the Graph tab, the campaign
  picker, the timeline picker and the portrait-bearing graph nodes are all
  post-0.9 features and all render).
- Two seats toured: **Gamemaster** and **User 1** (a non-GM player).
- Strictly read-only. Nothing was created, edited or deleted. Dialogs were
  opened and dismissed with Escape/Cancel. A before/after snapshot of every
  journal id, folder id and page count was taken across the destructive-looking
  passes (import wizard, New Entry dialog) and came back **identical**.

### ⚠️ Environment limitation that bounds this audit

**World A currently holds no campaign content at all.** As GM the world
contains exactly four journal entries:

| Entry | Pages | Note |
|---|---|---|
| `TTTypedPage1788014838958` | 1 (`place`) | leftover test fixture |
| `TTPubAlly1788014838958` | 1 (`text`, MEJ type `place`) | leftover test fixture |
| `TTGmSecret1788014838958` | 1 (`text`, MEJ type `place`) | leftover test fixture |
| `Campaign Timeline` | 0 pages, 0 timepoints | empty legacy timeline journal |

There are **zero campaign folders**, **zero Session pages**, **zero secret
blocks**, **zero tags/attributes**, **zero dashboards**, **zero player
groups** and **zero timepoints**. (The three `TT…` names have no dash, which
is why the harness's `TT-` sweep never reclaimed them.) A world-a backup from
2026-08-21 exists at
`/Users/danbularzik/FoundryVTT-14/Data/Backups/worlds/world-a/world.world-a.2026-08-21.*.bak`
and the live journal LevelDB still contains the byte strings of the lost
content ("Arc 1 Session 1 10/26/24", "Radiant Citadel", "Session Zero
10/6/2024", …), so the loss is recoverable — but restoring it is a world
mutation and was out of scope here.

Consequence: everything about **chrome** (controls, labels, `data-action`s,
menus, dialogs, empty-state text, GM-vs-player differences) is fully audited
and reliable. Everything that needs **populated content** — a Session sheet,
the prep board, a real secret and its reveal path, a campaign portal, a
second timeline, a real portrait on a graph node — could not be put on
screen and is marked **NOT OBSERVED** below. Those sections must not be
rewritten from this audit alone.

---

## Hub header bar

Root: `#MonksEnhancedJournal .mej-cc-hub-header`. It sits **above** the tab
nav, inside the Hub subsheet. (Note: MEJ strips the template's outer
`div.mej-cc-hub` when it mounts the subsheet — the usable root selector is
`.mej-cc-hub-container`, not `.mej-cc-hub`.)

GM, left to right:

| Control | Selector / action | Visible label(s) |
|---|---|---|
| Campaign picker | `select[name="campaign-scope"]`, `.mej-cc-campaign-scope`, `aria-label="Campaign"` | options: `All campaigns` (value `""`), `Unfiled` (value `unfiled`), `➕ New Campaign…` (value `__new`) |
| Campaign settings gear | `button.mej-cc-edit-campaign[data-action="editCampaign"]`, `fa-gear`, tooltip **Campaign settings** | icon only — **only rendered when the picker is scoped to a campaign**; absent in All and Unfiled |
| New Session | `button.mej-cc-new-session[data-action="newSession"]`, `fa-dice-d20` | **New Session** |
| Tools | `button.mej-cc-tools-summary[data-action="toggleToolsMenu"]`, `fa-ellipsis` | **Tools** |

Tools menu (`.mej-cc-tools-menu`, opened by the Tools button), GM:

- `[data-action="openImportWizard"]` `fa-file-import` — **Import Document**
- `[data-action="openExportDialog"]` `fa-file-export` — **Export**
- `[data-action="setCaptureCampaign"]` `fa-crosshairs` — **Auto-capture campaign**
- `[data-action="openHelp"]` `fa-circle-question` — **Open the user guide**

Observed: **Open the user guide** opens a new browser tab at
`https://github.com/bularzik/mej-campaign-companion/blob/main/docs/gm-guide.md`
for a GM (the player seat gets the `player-guide.md` URL).

Observed: with zero campaigns in the world, **Auto-capture campaign** does
nothing at all — no dialog, no notification. Same for the Unfiled filing
controls (below). This is the zero-campaign short-circuit, and it is silent.

Player seat: the picker shows only `All campaigns` and `Unfiled` (**no
"➕ New Campaign…"**), there is **no gear**, **no New Session**, and the
Tools menu contains exactly one item — **Open the user guide**.

Also on screen above the header, GM only, when the world has typed content
but no campaign — the adoption banner (`.mej-cc-adoption-banner`, rendered
inside the Index pane):

> This world has campaign content but no campaign. Create one from it?
> [ **Create campaign from this world** ] `[data-action="adoptWorld"]` · [ ✕ ] `[data-action="dismissAdoption"]`

## Hub panes

Tab nav: `#MonksEnhancedJournal nav.sheet-tabs a[data-group="primary"][data-tab="…"]`.
GM sees **six** tabs, in this order and with these labels and icons:

`Index` (fa-list) · `Timeline` (fa-timeline) · `Graph` (fa-circle-nodes) ·
`Search` (fa-magnifying-glass) · `Dashboards` (fa-table-columns) ·
`Secrets` (fa-user-secret)

**A player sees five.** The `secrets` tab is not rendered for a non-GM at all
(confirmed: `nav.sheet-tabs a[data-tab="secrets"]` count = 0 as User 1).

### Index (`.tab[data-tab="index"]` → `.mej-cc-index`)

Toolbar (`.mej-cc-index-controls`), in DOM order:

- Type filter: `button.mej-cc-doctype-summary[data-action="toggleTypeMenu"]`,
  `fas fa-filter`, tooltip **Filter by Type**, label text is the current
  summary — **All Types** when nothing is checked. Opens
  `.mej-cc-doctype-menu` containing one `<label>` per type actually present
  in scope, each with `input[name="doctype-check"][value="<type>"]` and the
  type's MEJ icon. In this world only **Place** was offered — the menu is
  built from what exists, not a fixed list.
- Sort: `button.mej-cc-sort-summary[data-action="toggleSortMenu"]`,
  `fas fa-arrow-down-short-wide`, tooltip **Sort By**. Opens
  `.mej-cc-sort-menu` with radios `input[name="sort-select"]`: **Name**
  (default, checked) and **Type**. Only those two.
- Name filter: `input[name="index-filter"]`, placeholder **Filter by name...**
- Filtered count `.mej-cc-filtered-count` — only when the filter box has text.
- **File all shown into…** `button.mej-cc-file-all[data-action="fileAllShown"]`,
  `fa-folder-open` — **GM only, and only in Unfiled scope** (confirmed
  absent in All).

Rows (`li.mej-cc-index-row[data-action="openIndexRow"][data-uuid=…]`): type
icon (`i.mej-cc-index-icon` — a font-awesome class, **not** a portrait),
name, an optional mention badge (`.mej-cc-mention-badge`, link icon + count,
`title="Mentions"`), the type label, an optional campaign badge, then GM-only
row buttons:

- `button.mej-cc-row-hide[data-action="toggleEntryHidden"]` — eye /
  eye-slash, tooltip flips between **Hide from players** and **Reveal to
  players**.
- `button.mej-cc-row-file[data-action="fileIntoCampaign"]`, `fa-folder-open`,
  tooltip **File into campaign…** — **Unfiled scope only**.

A player's rows carry **no** hide and **no** file button.

Empty state (not reachable here — rows were always present):
`li.instruction` with **"No journal entries yet."**

### Timeline (`.tab[data-tab="timeline"]` → `.mej-cc-timeline`)

Controls row `.mej-cc-timeline-controls`:

- `select[name="timeline-select"].mej-cc-timeline-select`,
  `aria-label="Timeline"`. Observed options: **All timelines in scope**
  (value `""`, selected by default), a **disabled** separator
  **— World timelines —** (value `__sep`), then each timeline by name
  (here: `Campaign Timeline`), then **➕ New timeline…** (value `__newtl`,
  **GM only** — absent from the player's select).
- When a real timeline is selected, GM-only management buttons appear beside
  it: `button.mej-cc-timeline-rename[data-action="renameTimeline"]` (`fa-pen`,
  tooltip **Rename timeline**) and
  `button.mej-cc-timeline-delete[data-action="deleteTimeline"]` (`fa-trash`,
  tooltip **Delete timeline**). A **Make default**
  (`[data-action="makeTimelineDefault"]`, `fa-star`) button also lives here
  but did not render for the world timeline in this world — **NOT OBSERVED**
  in its rendered state. *(Now observed on a campaign-owned, non-default
  timeline — see Supplement.)*

Per-stack: an order button group `.mej-cc-order-menu`
(`[data-action="setTimelineOrder"]`) with exactly three buttons —
**Manual** (`data-order="manual"`, active by default), **Date Added**
(`created`), **Campaign Date** (`campaign`).

Empty states, both seen on screen:

- Timeline exists but has no points: **"No timepoints yet."**
- The scope has no timeline at all (seen in Unfiled scope):
  **"No timeline in this scope."** — and in that state the order buttons and
  Add Timepoint are gone; only the picker remains.

`button.mej-cc-add-timepoint[data-action="addTimepoint"]`, `fas fa-plus`,
label **Add Timepoint** — GM only (absent for the player).

**Add Timepoint dialog** (opened and cancelled): window title **Add
Timepoint**; fields `input[name="label"]` labelled **Label**; a fieldset
**Campaign Date** with **Year** (`input[name="year"]`), **Month**
(`select[name="month"]` — blank `—` plus January…December), **Day**
(`input[name="day"]`), **Time** (`input[name="time"]`, a text field, not
hour/minute spinners); submit button reads **Create**.

**New timeline dialog** (from the picker's `➕ New timeline…`): window title
**➕ New timeline…**, single field labelled **Timeline name**, submit reads
**Confirm**. Cancelling reverts the picker and creates nothing (verified).

### Graph (`.tab[data-tab="graph"]` → `.mej-cc-graph-pane`)

Controls `.mej-cc-graph-controls`:

- **Focus** — `button[data-action="setGraphMode"][data-mode="ego"]`,
  `fa-bullseye`. Rendered **greyed out / disabled** when the Hub was not
  opened centred on an entity (that is its state on screen here).
- **Whole campaign** — `button[data-action="setGraphMode"][data-mode="all"]`,
  `fa-circle-nodes`, carries `.active` by default.
- **Show mention links** — `label.mej-cc-graph-backlinks` wrapping
  `input[type=checkbox][data-action-change="toggleGraphBacklinks"]`,
  unchecked by default.
- A truncation notice `.mej-cc-graph-truncated` exists in the markup —
  **NOT OBSERVED** (too few nodes).

Canvas: `svg.mej-cc-graph-svg`. Both seats get the same three controls.

### Search (`.tab[data-tab="search"]` → `.mej-cc-search`)

- `input[type=search][name="search-query"].mej-cc-search-input`, placeholder
  **Search everything...**
- Empty, no query: **"Type at least 2 characters to search."**
- Query with no hits: **"No matches."**
- Result rows `li.mej-cc-search-row[data-action="openIndexRow"]` carry a type
  icon, name, type label and a `ul.mej-cc-search-matches` of
  field-label + snippet pairs — **NOT OBSERVED populated** (no content).
  *(Now observed populated — see Supplement.)*
- The cross-campaign spillover button
  `button.mej-cc-search-spillover[data-action="searchAllCampaigns"]` —
  **NOT OBSERVED** (needs multiple campaigns).

Identical chrome for GM and player.

### Dashboards (`.tab[data-tab="dashboards"]` → `.mej-cc-dashboards`)

- GM only: `button[data-action="addDashboard"]`, `fa-plus`, **Add dashboard**.
  The player's pane has **no controls at all**.
- Empty state (both seats): **"No dashboards yet."**
- **Add dashboard dialog** (opened and cancelled): window title **Add
  dashboard**; **Name** (`input[name="name"]`), **Query**
  (`input[name="query"]`) with the hint **"Tokens: type:<key>, tag:<tag>,
  attr:<key>=<value>; anything else is full-text search."**, and a
  **Visible to players** checkbox (`input[name="showPlayers"]`, unchecked by
  default). Submit reads **Save** (not "Create").
- Row chrome (`.mej-cc-dashboard`: name, `<code>` query, eye when visible to
  players, `[data-action="editDashboard"]`, `[data-action="deleteDashboard"]`,
  inline results, per-dashboard **"No matches."**) — **NOT OBSERVED**
  populated. *(Now observed populated — see Supplement.)*

### Secrets (`.tab[data-tab="secrets"]` → `.mej-cc-secrets`) — GM only

Filter bar `.mej-cc-secrets-controls`, all
`button[data-action="secretsSetFilter"]`:

- One button per entry **type** present (`data-filter="type"`) — none in this
  world, so the row began with the state filters.
- State: **All** (`data-value="all"`, active by default) · **Revealed**
  (`revealed`) · **Unrevealed** (`unrevealed`).
- One button per player user (`data-filter="player"`, `fa-user` + the user's
  name): **User 1**, **User 2**.

List `.mej-cc-secrets-list`. Empty state: **"No secrets tracked yet."**
A populated row (`li.mej-cc-secret-row`) carries an icon, the source entry as
a link (`a.mej-cc-secret-source[data-action="openIndexRow"]`), a preview, an
audience label — **"Hidden from players"** when there is none — and
`a[data-action="trackerAudience"]` (`fa-user-secret`, tooltip **Reveal to…**).
**NOT OBSERVED populated.** *(Now observed populated — see Supplement.)*

Player groups block `.mej-cc-groups` at the bottom of the same pane:

- Header **Player groups** with `button[data-action="addGroup"]` (`fa-plus`,
  **Add group**).
- Empty state: **"No groups defined yet — manage them on the Hub's Secrets
  tab."**
- **Add group dialog** (opened and cancelled): window title **Add group**;
  **Group name** (`input[name="name"]`); a fieldset **Members** with one
  checkbox per player (`input[name="member-<userId>"]`) — **User 1**,
  **User 2**. Submit reads **Save**.

## Campaigns

Everything in this section is chrome-level; **no campaign exists in this
world**, so the created state is NOT OBSERVED. *(A campaign was later seeded
and every item below observed — see Supplement.)*

- **Creation** is inside the campaign picker, as an option — `➕ New
  Campaign…` (value `__new`) in `select[name="campaign-scope"]`. It is
  GM-only (absent from the player's picker). Not selected during this audit
  (it creates). The New-Campaign dialog itself is therefore **NOT OBSERVED**.
  *(Now observed — see Supplement.)*
- **Campaign settings** is the gear beside the picker,
  `[data-action="editCampaign"]`, tooltip **Campaign settings**, and it only
  renders while the picker is scoped to a campaign — **NOT OBSERVED** here,
  and so is **Restore campaign entry**, which the code only offers inside
  that dialog when the campaign's portal entry is missing. *(Both now
  observed — see Supplement.)*
- **Unfiled scope** is real and observed: choosing `Unfiled` adds
  **File all shown into…** to the Index toolbar and a per-row **File into
  campaign…** button to every row. Both are GM-only.
  **Observed defect-shaped behaviour:** with zero campaigns in the world both
  controls are still rendered and clickable, and clicking either does
  **nothing at all** — no dialog, no notification, no feedback.
- Openable **campaign entries** exist as a registered page type
  (`mej-campaign-companion.campaign` is in `game.documentTypes.JournalEntryPage`,
  and **Campaign** appears in MEJ's own New Entry type list) — but no
  campaign entry document exists to open. See **Portal** below.
- **"Open Campaign Hub" on a campaign folder's right-click menu** —
  **NOT OBSERVED**: there are no campaign folders in the journal sidebar to
  right-click. *(Now observed — see Supplement.)*
- **What a player sees:** the picker still offers `All campaigns` and
  `Unfiled` (so the scope concept is exposed to players), with no create
  option, no gear, and no filing buttons.

## Portal

**NOT OBSERVED — no campaign portal entry exists in this world.**
*(All three items below now observed — see Supplement.)*
`campaignPortal()` returned `null` for every campaign (there are none), so
none of the following could be put on screen: the portal entry in the journal
sidebar, opening it routing straight to the Hub scoped to its campaign, or
`restorePortal` (which the settings dialog only offers when a portal is
missing).

What *was* confirmed: the portal's page type `mej-campaign-companion.campaign`
is registered on this server and shows up as **Campaign** in MEJ's own
"Create Journal Entry" type dropdown.

## Multi-timeline

The picker is real and rendered (see the Timeline pane above):
`select[name="timeline-select"]` with **All timelines in scope**, a disabled
**— World timelines —** group separator, the timelines themselves, and the
GM-only **➕ New timeline…** action-option.

- The lone timeline in this world (`Campaign Timeline`) is grouped under
  **— World timelines —**, i.e. it belongs to no campaign.
- **New**: selecting `➕ New timeline…` opens a dialog titled **➕ New
  timeline…** with one field, **Timeline name**, and a **Confirm** button.
  Cancelling reverts the picker to the previous selection and creates
  nothing (verified: journal ids unchanged).
- **Rename** / **Delete**: `[data-action="renameTimeline"]` (pen, **Rename
  timeline**) and `[data-action="deleteTimeline"]` (trash, **Delete
  timeline**) appear beside the picker as soon as a real timeline is
  selected. Their dialogs were not opened (delete is destructive).
- **Make default** (`[data-action="makeTimelineDefault"]`, **Make default**,
  star icon) did **not** render for this world timeline — consistent with it
  being suppressed for world timelines, but the campaign case is **NOT
  OBSERVED**.
- A player's picker shows the same timelines and the same separator but
  **no `➕ New timeline…`** and **no management buttons**.

## Portraits

- **Graph nodes do carry an image.** Each node is a `<g>` containing two
  `<circle>`s (a type-hued ring) plus an `<image>` clipped into the circle
  via a `clipPath`. Confirmed live: three nodes, three `<image href>`
  elements, and visually the pictures are drawn inside the node circles.
- In this world every entity is a Place with no picture set, so the href
  observed on all three nodes was MEJ's per-type icon —
  `modules/monks-enhanced-journal/assets/place.png`. **A real portrait
  (a person's own image) was NOT OBSERVED**, only the fallback path.
  *(Now observed — see Supplement.)*
- **Index rows do NOT show portraits.** The row image is
  `i.mej-cc-index-icon` carrying a font-awesome class
  (`fas fa-place-of-worship` here) — a glyph, not a picture. Same in the
  Dashboards result rows and the Knowledge panel's backlink rows.
- **How a portrait is set was NOT OBSERVED** — it is the entity's own MEJ
  image, and no entity in this world has one. *(Now observed — see
  Supplement.)*

## Secrets (0.13.3 semantics)

**Almost entirely NOT OBSERVED.** *(The audience dialog, the "Everyone" path
and the player's view of both a group reveal and a native reveal are now
observed — see Supplement. The recap-secret path remains unobserved.)* There
is not one secret block, session checklist secret, or recap secret anywhere
in this world (`hasSecret` was
false on all three pages; `section.secret` count was 0 on every sheet
opened), so:

- The **audience/reveal dialog** could not be opened from any real secret.
  Its shape is therefore unverified on screen. The one dialog of that family
  that *was* opened — **Add group** — confirms the surrounding vocabulary:
  a **Members** fieldset listing player users by name.
- **What "Everyone" does natively** (0.13.3's headline change: the checkbox
  writing Foundry's own reveal marker onto the block) is **NOT OBSERVED** and
  must not be restated in the guide on the strength of this audit. *(Now
  observed end to end — see Supplement.)*
- The **recap-secret reveal path** (0.13.3's second change) is **NOT
  OBSERVED** — there is no Session page in the world.
- The **Hub Secrets tab** chrome *is* audited (above): type / state / player
  filter buttons, the row's `trackerAudience` control, the audience label
  defaulting to **"Hidden from players"**, and the Player groups block.
- Confirmed structurally: the Secrets tab is **not rendered for players at
  all**, so a guide sentence saying players "won't see the Secrets tab" is
  correct.

## Session sheet

**NOT OBSERVED — there is no Session page in this world.** `game.journal`
contains no page of type `mej-campaign-companion.session`.
*(A Session page was later created through this very dialog and the whole
sheet observed — see Supplement.)*

What was confirmed adjacent to it:

- The type is registered (`mej-campaign-companion.session` is in
  `game.documentTypes.JournalEntryPage`), and **Session** appears in MEJ's
  own **Create Journal Entry** dialog under **Type**
  (`select[name="flags.monks-enhanced-journal.pagetype"]`, value `session`).
  So the guide's "choose Session from the Type dropdown" route is live in
  this build. The same dropdown also lists **Campaign**, which the current
  guides never mention.
- The Session sheet's tabs, the campaign-date fields, the attendee list, the
  secret checklist, the GM Notes block, the **Prep board** button
  (`[data-action="openPrepBoard"]`) and the prep board itself are all
  **NOT OBSERVED**. *(All now observed — see Supplement.)*
- **Entry-sheet header buttons:** on every MEJ entry sheet opened as GM, the
  window header contained only Foundry/MEJ's own controls —
  `toggleControls`, `copyUuid`, **Copy image path**, `close`. **No graph
  button and no prep-board button was present on any sheet.** (The sheets
  available were Places, not Sessions, so this is evidence about the graph
  header button specifically, not the prep-board one.)

## Knowledge panel

Root `section.mej-cc-knowledge[data-page-uuid]`, rendered on MEJ typed entry
sheets. Three `<details>` sections, in this order:

1. `<summary>` **Tags** (`fa-tags`), **open by default**. GM (editable) gets
   `input.mej-cc-tag-input` with placeholder **Add tag…**; existing tags
   render as `.mej-cc-tag-chip` with an `a.mej-cc-tag-remove` (✕, title
   **Remove tag**). A **player sees no input** and gets the empty text
   **"No tags"** instead.
2. `<summary>` **Attributes** (`fa-table-list`), **collapsed by default**.
   Editable rows are key/value text inputs plus an eye-slash checkbox
   (`input.mej-cc-attr-hidden`, title **Hidden from players**) and a trash
   link (title **Delete attribute**), with `a.mej-cc-attr-add`
   **Add attribute** underneath. Read-only for a player. **NOT OBSERVED
   populated** — no entry in this world has attributes, so the rendered
   row layout and the player-hidden behaviour were not seen in action.
   *(Rendered rows now observed — see Supplement.)*
3. `<summary>` **Mentioned in (N)** (`fa-link`), **open by default**. The
   count is in the summary itself. Rows are
   `li.mej-cc-backlink-row[data-uuid]` with a type icon, the name, an
   optional GM-only-mention eye-slash (title **Mentioned only in GM-only
   content**) and a `×N` count. Empty text: **"No mentions yet"**.
   **Observed live:** `TTPubAlly…` showed **Mentioned in (1)** listing
   `TTTypedPage… ×1`, for both the GM and the player.

The panel is present and identical in structure for both seats; the only
differences are the missing tag input, missing attribute editors, and the
**"No tags"** placeholder on the player side.

## Player view

Toured as **User 1**. Differences from the GM seat, all observed:

| Surface | GM | Player |
|---|---|---|
| Hub tabs | 6 (Index, Timeline, Graph, Search, Dashboards, **Secrets**) | **5 — no Secrets tab** |
| Campaign picker | All campaigns · Unfiled · ➕ New Campaign… | All campaigns · Unfiled only |
| Gear (Campaign settings) | present when scoped to a campaign | never |
| New Session button | present | **absent** |
| Tools menu | Import Document · Export · Auto-capture campaign · Open the user guide | **Open the user guide only** |
| Adoption banner | shown | **not shown** |
| Index row buttons | hide/reveal eye + (Unfiled) File into campaign… | **none** |
| Index toolbar | type filter, sort, name filter, (Unfiled) File all shown into… | type filter, sort, name filter only |
| Timeline picker | includes **➕ New timeline…** | excludes it |
| Timeline management (rename/delete/make default) | rename/delete present; **make default** never rendered on the world timeline this audit could reach — now observed on a campaign-owned, non-default timeline (see Supplement) | **absent** |
| Add Timepoint | present | **absent** |
| Timeline order buttons | Manual / Date Added / Campaign Date | **same three, present and clickable** |
| Graph controls | Focus · Whole campaign · Show mention links | **identical** |
| Search | same input, same placeholder, same empty text | identical |
| Dashboards | Add dashboard button + list | **list only, no button** |
| Knowledge panel | tag input, attribute editors | read-only, **"No tags"** |
| Hub entry points | shell `.nav-button.campaign-hub` + scene-controls **Campaign Hub** tool | **same shell nav button** |

The player's graph and index showed **fewer nodes/rows than the GM's**
(2 vs 3), i.e. permission filtering is visibly in effect.

## Entry points into the Hub (observed, both seats)

- MEJ shell nav button `#MonksEnhancedJournal .nav-button.campaign-hub`,
  tooltip **Campaign Hub** — present for GM *and* player.
- Foundry scene controls: the **notes** group (**Journal Notes**) contains a
  tool named `campaign-hub` titled **Campaign Hub**. So the guides' "or from
  the notes group in the scene controls" is still true.
- The Hub opens as a tab inside MEJ's tabbed shell (window title
  "Campaign Hub - Monk's Enhanced Journal", tab strip showing "Campaign
  Hub"), i.e. this world runs in extension-API mode, not native mode.

## Word import / export (observed)

**Import wizard** (`.application.mej-cc-import-wizard-app`, window title
**Import Document**). Reached by parsing the repo's own fixture docx; the
**Import** button was never clicked and the before/after world snapshot is
identical.

- **Step 1** is *only* a file chooser: the intro line **"Review the detected
  sections. Choose a type for each, or skip/merge them, then create."**, a
  fieldset **Word document (.docx)** with the hint **"Choose a .docx file. In
  Google Docs use File → Download → Microsoft Word (.docx); from Word, any
  .docx works."**, a file input, and **Cancel**. **There is no Audience
  control on step 1.**
- **Step 2 (review)** carries, above the table:
  - **Import into** — `select[name="destination"]`. With no campaigns the
    only option is **New Campaign…**.
  - **Create a subfolder named after the document** —
    `input[type=checkbox][name="subfolder"]`, **checked by default**.
  - **Audience** — `select[name="audience"]` with **three** options:
    **Campaign default** (selected by default), **GM only**, **All players
    (Observer)**; hint **"Sets ownership of the created entries and bounds
    which entities the imported text may auto-link to."**
  - A detection line: **"1 sections detected as sessions — their type and
    timepoint are pre-set."** (rendered exactly like that, with the
    ungrammatical "1 sections").
  - The document name as a heading (**guide-demo-import**).
- The table's column headers are **Title · Type · Timepoint · Adjust**.
  Each row has an editable title input, a type `select[name="type-N"]`, a
  timepoint checkbox, and two Adjust buttons:
  `[data-action="mergeUp"]` and `[data-action="splitSection"]`.
- The type list, in exactly this order, with no legacy "text" entry:
  **Text and Image · Session · Person · Place · Organization · Quest ·
  Encounter · Event · Point of Interest · Shop · Loot · List · Skip**.
- Detection observed working: the four fixture sections pre-selected
  **Text and Image**, **Session** (with its timepoint box pre-checked),
  **Person**, **Place**.
- Footer buttons: **Cancel** · **Back** (`backToSource`) ·
  **Import** (`createImport`, rendered upper-cased as "IMPORT").

**Export dialog** — window title **Export to Word**. One checkbox per entry
(all checked by default, each labelled "<name> <type>"), then **Include GM
Content** (`input[name="includeGM"]`, unchecked) with the hint **"When
checked, session GM notes and relationships hidden from players are included
in the export."**, and a submit button reading **Download**.

## Gaps vs current guides

| Guide statement | What is true now |
|---|---|
| GM guide: "It has **five** panes along the top: Index, Timeline, Search, Dashboards, and Secrets." | There are **six**, and **Graph** sits between Timeline and Search. |
| GM guide: "The Index toolbar is also where you'll find **New Session**, **Import Document**, and **Export**." | None of the three are on the Index toolbar. **New Session** is a header-bar button; **Import Document** and **Export** are inside the header bar's **Tools** menu. The Index toolbar holds only the type filter, sort, name filter and (Unfiled only) **File all shown into…**. |
| GM guide: "From the Hub's Index toolbar, click **Import Document**" / "click **Export**" (Word section, steps 1) | Both are under **Tools** in the header bar. |
| GM guide: "Open the relationship graph from **the graph icon in the Hub's toolbar**… It has two modes: Focus / Whole campaign." | There is no graph icon on any toolbar — the graph is its own **Graph tab**. The two modes are correct: **Focus** and **Whole campaign**, plus a **Show mention links** checkbox. **Focus** renders disabled unless the Hub was opened centred on an entity. |
| Player guide: "The Hub also has a relationship graph… **Open it from the graph icon**". | Same — it is the **Graph** tab. |
| GM guide: import step 2 — "Choose an **Audience** — 'GM only' or 'All players (Observer)'." | The Audience select is on the **review** screen (step 2 of the wizard's own flow, after the file is parsed), not before choosing the file, and it has **three** options with **Campaign default** as the default. |
| GM guide's import steps say nothing about destination. | The review screen leads with **Import into** (campaign picker, "New Campaign…" when there are none) and **Create a subfolder named after the document**, checked by default. |
| GM guide's import steps say nothing about merge/split. | Every review row has **Merge into previous** and **Split section** buttons under an **Adjust** column. |
| GM guide: "The Hub's **Timeline** pane holds **a single world timeline** of timepoints." | The pane leads with a **timeline picker** (`All timelines in scope`, a `— World timelines —` group, the timelines themselves, and GM-only **➕ New timeline…**) plus **Rename timeline** / **Delete timeline** buttons. |
| GM guide: "Click **Add Timepoint** at the bottom… the same Year/Month/Day/**Time** dialog." | Correct — the dialog is **Label / Year / Month (select) / Day / Time (text)**, submit **Create**. Note the Session sheet uses Year/Month/Day/**Hour/Minute** instead; the two are not the same layout despite the guide implying they are. (Session side is now **OBSERVED** and the guide's implication is wrong: the Session tab really does use **Year / Month / Day / Hour / Minute** — see Supplement.) |
| GM guide: "Click **Add dashboard**, give the query a name… Each saved dashboard also has its own **Visible to players** checkbox." | Correct. Dialog title **Add dashboard**; fields **Name**, **Query** (+ token hint), **Visible to players**; submit reads **Save**. |
| GM guide: "the **Hub Secrets tab**… filterable by entry type, revealed state, and which specific player." | Correct, and the state filter's exact labels are **All / Revealed / Unrevealed**. Player-group management (**Player groups**, **Add group**) lives at the bottom of the same tab. |
| GM guide / player guide never mention it. | The Secrets tab **does not exist at all for a player** — worth saying in the player guide. |
| GM guide: "the **prep board**, opened from the clipboard-icon button in the Session tab's own toolbar… always available regardless of your MEJ build" and "most MEJ v14 builds don't render either header button". | **Now observed and CORRECT on both halves — see Supplement.** Originally **NOT OBSERVED** either way — no Session exists in this world. What *was* observed: no companion header button (graph or otherwise) appears on any MEJ entry sheet's window header in this build. The guide's claim needs re-testing against a world with a Session before it is rewritten. |
| GM guide: "Session doesn't appear in this dialog at all" (native mode caveat). | In this (extension-API) world, MEJ's **Create Journal Entry** dialog does list **Session** — and also **Campaign**, which no guide mentions. |
| GM guide: "campaign entries", "Open Campaign Hub" folder context item, "Restore campaign entry". | **All three now observed — see Supplement.** Originally **NOT OBSERVED** — this world has no campaigns, so none of the campaign-entity surfaces could be checked. The page type is registered, which is as far as this audit goes. |
| GM guide: settings reference lists five visible settings and four hidden ones. | Live settings read back: `autoLink=false`, `retroLinkMode="confirm"`, `autoCaptureEncounters=false`, `autoCaptureSharedMedia=false`, `playersWriteSessions=false` — defaults match. The hidden set is now **larger** than the guide's four: `timelineJournalId`, `savedQueries`, `playerGroups`, `forceNativeMode`, plus `dataVersion`, `autoCaptureCampaign`, `hubCampaignScope` (client), `adoptionPrompted`, `hubTimelineSelection` (client). |
| Neither guide mentions it. | With **zero campaigns**, **File all shown into…**, **File into campaign…** and **Auto-capture campaign** are all rendered, clickable, and silently do nothing. Worth a sentence, or worth filing as a bug. |
| Both guides' screenshots (`docs/images/*.png`). | Every screenshot predates the header bar and the Graph tab, and depicts a demo campaign that no longer exists in the test world. They cannot be regenerated from World A in its current state. |

## What still has to be verified before the rewrite ships

The following are load-bearing for the guides and were **not** observable:

1. Session sheet — tabs, campaign-date fields, attendees, secret checklist,
   GM Notes, prep-board button; and the prep board itself.
2. Any block secret — the audience dialog's actual on-screen labels, the
   0.13.3 "Everyone"-is-Foundry's-reveal behaviour, the recap-secret path,
   and the reveal whisper.
3. Campaign creation, campaign settings, **Restore campaign entry**, the
   campaign portal entry and its routing, and the folder context menu's
   **Open Campaign Hub**.
4. A campaign-owned timeline (**Make default**, the default ★ marker, and
   filing behaviour).
5. A real portrait on a graph node (only the type-icon fallback was seen).
6. The player's revealed-secret view and the reveal whisper.

Each needs a world with campaign content. The 2026-08-21 world-a backup is
the obvious source; restoring it is a decision for the repo owner.

---

## Supplement — seeded demo observations (Task 5/6)

Same standard as the audit above: every statement here was read off a live
screen, a live DOM dump, or a document read back from the running world after
the action that wrote it. Nothing is taken from `CHANGELOG.md` or a template.

**How it was produced.** The gated screenshot harness
(`tests/e2e/guide-screenshots.spec.mjs`, `GUIDE_SHOTS=1`) was extended to seed
a real campaign into World A — a campaign folder **The Vale Chronicles**
(`createCampaign`, baseline `observer`), its portal entry, two campaign-owned
timelines, five filed entries (Place, Quest, two Persons, a Session), one
deliberately unfiled Person, two Actors, a block secret, a saved dashboard
query and a player group. Everything it creates carries the
`mej-campaign-companion.guideDemo` flag and is removed by the same flag-driven
sweep at the end of the run (folders with `deleteSubfolders`/`deleteContents`;
never by name). Four items the harness does not need for a screenshot — the
New-Campaign dialog, the folder context menu, **Restore campaign entry**, and
the "Everyone" reveal path — were observed in a separate, throwaway
observation pass against the same flag discipline; that file was deleted
afterwards and the world verified empty of `guideDemo` documents.

Screenshots cited below are the committed ones in `docs/images/`.

### Campaign creation dialog — OBSERVED

Reached exactly as the audit predicted: `➕ New Campaign…` (value `__new`) in
`select[name="campaign-scope"]`. Selecting it opens a DialogV2 whose

- window title is **New Campaign**
- fields are **Name** (`input[name="name"]`) and **Player access**
  (`select[name="baseline"]`)
- **Player access** options are exactly three: **GM only** (`none`), **Players
  can view** (`observer`, *selected by default*), **Players can edit**
  (`owner`)
- submit button reads **Confirm**.

Cancelling (Escape) creates nothing — folder and journal counts identical
before and after (6 / 4 both times), and the picker reverts to its previous
selection.

### Campaign folder context menu — OBSERVED

With a campaign folder present, right-clicking it in Foundry's own journal
sidebar (`#journal [data-folder-id=…]`) produces a context menu whose items
are, in order:

**Edit Folder · Configure Ownership · Create Rollable Table · Export to
Compendium · Remove Folder · Delete All · Open Campaign Hub**

So the guide's **Open Campaign Hub** item is real, and it is the last entry,
appended after Foundry's own six.

Caveat worth recording: the MEJ shell, when open, covers Foundry's sidebar tab
button, so the shell has to be closed first to reach the core directory. The
same hook (`getFolderContextOptions`) also serves MEJ's own embedded sidebar,
but only the core-directory menu was put on screen here.

### Campaign settings dialog + Restore campaign entry — OBSERVED

The gear (`button.mej-cc-edit-campaign[data-action="editCampaign"]`) renders
as soon as the picker is scoped to a campaign (visible in
`campaign-picker.png`). Its dialog:

- window title is **the campaign's own name** (here `Vale Observation`), not a
  fixed string
- **Player access** (`select[name="baseline"]`), same three options and the
  campaign's current value selected
- **Apply to all current members now** (`input[name="applyNow"]`,
  **checked by default**)
- buttons: **Confirm** — and nothing else while the portal exists.

With the portal entry deleted, re-opening the same dialog adds a second
button, `[data-action="restorePortal"]`, labelled **Restore campaign entry**.
Clicking it recreated the portal immediately: name `Vale Observation`, page
type `mej-campaign-companion.campaign`, ownership `{default: 2}` (the
campaign's observer baseline). The button is absent again on the next open.

### The portal — OBSERVED (`portal.png`)

- `createCampaign()` creates the portal with the campaign; no separate step.
  Its **JournalEntry** carries `ownership.default = 2` (the campaign
  baseline); its single **page** carries `ownership.default = -1` (inherit)
  and `type = "mej-campaign-companion.campaign"`.
- The portal is an ordinary entry in the journal sidebar, named after the
  campaign, and both seats can see it when the baseline allows.
- Opening it mounts the Hub: the window title becomes
  **"The Vale Chronicles - Monk's Enhanced Journal"**, the shell tab reads
  **The Vale Chronicles**, and `.mej-cc-hub-container` is present — i.e. the
  portal's sheet *is* `CampaignHubPage`, not a text page.
- It arrives **already scoped to its own campaign**:
  `select[name="campaign-scope"]` reads `The Vale Chronicles` on open, and the
  client setting `hubCampaignScope` is written to that folder id. Asserted in
  the harness, so it is a standing check, not a one-off.
- The player's portal view (`portal.png` is User 1's) shows the five-tab Hub
  (**no Secrets tab**), no **New Session**, no gear, and index rows with no
  hide/file buttons — the same player/GM split the audit recorded for the Hub
  generally.
- **Quirk, observed:** the Knowledge panel (**Tags** / **Attributes** /
  **Mentioned in (0)**) renders underneath the Hub on the portal page, because
  the portal is a typed MEJ page like any other. Visible at the bottom of
  `portal.png`.

### Campaign-owned timeline, ★ default and Make default — OBSERVED (`timeline-selector.png`, `hub-timeline.png`)

- Scoping the Hub to a campaign with no explicit timeline pick **creates** the
  campaign's timeline on the spot (`ensureTimelineJournal(campaign)`), named
  **`<campaign name> — Timeline`** — here `The Vale Chronicles — Timeline`. It
  is a JournalEntry inside the campaign folder.
- That first timeline is the campaign's default by fallback, with no flag
  written, and the picker labels it **★ `<name>`**.
- A second timeline created through the picker's **➕ New timeline…**
  ("Side Quests") is *not* the default, and selecting it renders the full
  management trio beside the picker:
  `button.mej-cc-timeline-default[data-action="makeTimelineDefault"]` labelled
  **★ Make default**, plus the pen (**Rename timeline**) and trash
  (**Delete timeline**) the audit already had. This is the state the audit
  could not reach; `timeline-selector.png` is that screen.
- In **All campaigns** scope the pane stacks each campaign's *default*
  timeline under an `<h3>` bearing the campaign's name, then every world
  timeline under its own name — confirmed live with two stacks on screen
  ("The Vale Chronicles" and the world's own "Campaign Timeline").
- **Cosmetic defect, observed:** `.mej-cc-timeline-controls` has **no CSS rule
  at all** in `styles/campaign-companion.css`, so it lays out as a plain
  block: the `<select>` spans the full pane width and **Make default**, the
  pen and the trash each drop onto their own line instead of sitting in a row
  beside the picker. Plainly visible in `timeline-selector.png`.

### A real portrait on a graph node — OBSERVED (`portrait-node.png`, `hub-graph.png`)

- The node image is the **page's own `src` field** (`nodeImage(page.src, …)`
  in `logic/graph-rows.mjs`); setting `src` on a Person's page is exactly how
  a portrait gets onto its node. Two demo Persons were given real images and
  the rendered `<image href>` on the node was asserted to equal the file that
  was set (`icons/environment/people/commoner.webp`) — i.e. the first branch,
  not MEJ's per-type placeholder.
- Both branches are visible side by side in `hub-graph.png`: the two Persons
  draw their pictures, while the Quest and Place draw MEJ's type icons and the
  Session node draws a plain coloured disc with no image at all.
- Index rows still show a font-awesome glyph, never the portrait — unchanged
  from the audit.

### A block secret, the audience dialog, and the 0.13.3 "Everyone" — OBSERVED

**The dialog** (`secret-audience-dialog.png`), opened from the GM overlay
button `.mej-cc-secret-audience` on a `<section class="secret">` inside a
Quest page's `text.content`:

- window title **Reveal secret**
- a lead checkbox `input[name="all"]` labelled **Everyone** (bold), outside
  any fieldset
- fieldset **Players** — one `input[name="user-<id>"]` per non-GM user
  (**User 1**, **User 2**)
- fieldset **Groups** — one `input[name="group-<id>"]` per player group, each
  with a `fa-users` icon (**Inner Circle**)
- submit button reads **✓ Apply**.

**What "Everyone" does** (checked, applied, then read back from the document):

- The page body itself is rewritten: the section becomes
  `<section class="secret revealed" id="…">`. That is **Foundry's own
  `revealed` class**, in the page's stored HTML — not a companion flag.
- The stored companion audience for that section is
  `{users: [], groups: [], all: false, revealedAt: <timestamp>}`. `all` is
  written **false** even though the GM asked for everyone; `revealedAt` is
  stamped. So the native class is the single source of truth and the flag
  deliberately does not duplicate it.
- The GM's own chip on the secret nevertheless reads **Everyone** — the chip
  reads the class, not the flag.
- A whisper goes out to **every** non-GM player: the chat message header reads
  *"A secret from Observation Quest has been revealed to you:"*, addressed
  `To: User 1, User 2`.

**What the player then sees** (User 1, same page):

- With **Everyone**: the section is present with class exactly
  `secret revealed`, **no** `mej-cc-revealed-to-you`, **no** tooltip, and no
  audience button. Core Foundry's own secret control renders on it — the
  section's text begins with the word **"Hide"**, i.e. the core reveal/hide
  toggle is drawn for this viewer. Worth a second look as a possible defect:
  the toggle is core's, not the companion's, but it appears on a player's
  screen.
- With a **group-only** reveal (Inner Circle, containing User 1 —
  `revealed-secret-player.png`): the section renders with the companion's own
  `mej-cc-revealed-to-you` marker (the orange left rule) and **no** core
  Hide toggle, and the player gets the same whisper (`reveal-whisper.png`,
  `To: User 1`).
- Secrets the viewer is not cleared for are removed from the DOM entirely
  before it is painted — a player's page never contains them.

**Still NOT OBSERVED:** the recap-secret reveal path (a secret inside a
Session page's `system.recap`). The demo seeds its block secret on the Quest
page instead, because the Session sheet never renders a
`.editor-display[data-key="text.content"]` region for the GM overlay to hook.

### Session sheet and prep board — OBSERVED (`session-sheet-gm.png`, `session-sheet-player.png`, `session-checklist.png`, `prep-board.png`, `recap-editing.png`)

Created through MEJ's own **Create Journal Entry** dialog with **Type →
Session**, exactly the route the guide teaches.

- **Tabs, GM:** `description`=**Recap** · `session`=**Session** ·
  `relationships`=**Relationships** · `notes`=**Notes**. **A player sees
  three** — Recap, Session, Notes; no Relationships.
- **Session tab**, in DOM order: **Session Number**
  (`input[name="flags.mej-campaign-companion.session.sessionNumber"]`); a
  **Campaign Date** group of **Year** / **Month** / **Day** / **Hour** /
  **Minute** (`…session.campaignDate.{year,month,day,hour,minute}`; Month is a
  `<select>` with a blank option then January…December); **Attendees**;
  **Secrets**; **GM Notes**.
  This settles the audit's open question: the Session sheet uses
  **Hour/Minute**, while the Hub's **Add Timepoint** dialog uses a single
  free-text **Time** field. The two layouts are genuinely different.
- **Secrets block** (`session-checklist.png`): heading **Secrets**, then two
  icon-only buttons — `[data-action="addSecret"]` tooltip **Add Secret** and
  `[data-action="openPrepBoard"]` tooltip **Prep board** — then one row per
  checklist secret with an eye-slash, a `fa-user-secret` audience control and
  a trash.
  **So the GM guide's "prep board, opened from the clipboard-icon button in
  the Session tab's own toolbar" is correct**, and it is the only route: the
  entry sheet's window header carried exactly `toggleControls`, `copyUuid`,
  **Copy image path**, `close` — no prep-board button and no graph button, on
  a Session sheet as well as on the Place/Quest sheets the audit checked. The
  guide's "most MEJ v14 builds don't render either header button" is
  confirmed on this build.
- **GM Notes** block sits at the foot of the Session tab with an
  `[data-action="editGmNotes"]` control tooltipped **Edit GM Notes**.
- **Prep board** window (`prep-board.png`): window title **Session prep
  board**; the session's name as an `<h1>`; sections **Attendees**,
  **Secrets & clues** (numbered, each with the eye-slash + audience icons),
  **Linked entries** (empty state **"No linked entries."**) and **Scratch
  notes** (a textarea, placeholder **"GM-only notes for running this
  session…"**).
  **Defect, observed:** the Attendees list renders each attendee's *image
  only* — the two demo Actors show as bare icons with **no names** beside
  them. Present in the previously-committed screenshot too, so it is not new.
- **Recap tab:** the GM recap renders first with an `editor-edit` pencil, then
  a **Player Recaps** heading. `recap-editing.png` shows a player editing
  their own recap with the full ProseMirror toolbar in place.
  **Possible defect, observed:** on the *GM's* Recap tab the **Player Recaps**
  block was empty apart from an edit pencil, even though User 1's recap
  existed and rendered on the player's own sheet (`session-sheet-player.png`).
  The GM appears to be shown only their own (empty) recap slot, not the
  players'.
- **Cosmetic, observed on every Session shot:** MEJ's shared detailed-header
  partial fills the top ~250px of the sheet with a broken image placeholder
  and five empty generic fields (**Page Name**, **Type**, **File Path**,
  **Page Category**, **Sort Order**), leaving little room for the recap body.

### Unfiled scope — OBSERVED (`campaign-unfiled.png`)

With one campaign in the world and one entry deliberately left out of it:

- The picker's **Unfiled** option is present and selectable (observed on the
  GM seat here; the audit already observed it on the player's picker too).
- The Index toolbar gains **File all shown into…**
  (`button.mej-cc-file-all[data-action="fileAllShown"]`, `fa-folder-open`) and
  every row gains **File into campaign…**
  (`button.mej-cc-row-file[data-action="fileIntoCampaign"]`) — both GM-only,
  both asserted present in the harness.
- The filtered-count chip reads **1 of 4**: World A's three pre-existing
  fixture entries plus the demo's unfiled Person. Campaign members, the portal
  and every timeline journal are excluded from the Unfiled set.
- The audit's zero-campaign defect (both filing controls rendered, clickable
  and silently doing nothing) was **not re-tested on screen here** — neither
  filing button was clicked, since doing so would move a real World A entry.
  What is observed is only that both controls render in this state. The
  dead-control report stands as the audit filed it, for a world with zero
  campaigns.

### Populated states the audit could only see empty

- **Search results** (`hub-search.png`): rows carry the type icon, name, type
  label and a match list of **field-label + snippet** pairs — observed labels
  **Description**, **Name**, **Secrets**. *Cosmetic defect:* the snippet is
  taken from the **raw** page text, so an `@UUID[…]{…}` link shows through as
  markup (`…rnalEntry.rMYO0mN9F6sSvpxN]{The Missing Caravan}` in that shot).
- **Dashboard rows** (`hub-dashboards.png`): name, the query in `<code>`, a
  pen and a trash at the right, and the matching entries listed inline
  underneath.
- **Secrets tracker rows** (`hub-secrets-tab.png`): one row per tracked
  secret, source entry name, preview text, the audience label
  **Hidden from players** while unrevealed, and the `fa-user-secret` control.
  The type filter now offers real buttons — **Quest** and **Session** — built
  from the types actually present. The **Player groups** block below lists
  **Inner Circle — User 1** with pen and trash.
- **Knowledge attributes** (`knowledge-tags-attributes.png`): key and value
  text inputs, an eye-slash checkbox per row (checked on the player-hidden
  attribute) and a trash, with **Add attribute** underneath.
- **Index rows with a campaign badge** (`hub-index.png`): in All scope a filed
  row shows its campaign's name in its own column; the unfiled row shows
  nothing there.

### Still NOT OBSERVED after this pass

1. The **recap-secret** reveal path (a secret inside a Session's
   `system.recap`) — see above.
2. The **cross-campaign search spillover** button
   (`.mej-cc-search-spillover`) — it needs two or more campaigns; the demo
   seeds one.
3. The **graph truncation notice** (`.mej-cc-graph-truncated`) — needs far
   more nodes than the demo has.
4. The **adoption banner in its acted-on state** (`adoptWorld`) — it is
   suppressed as soon as a campaign exists, and clicking it would move every
   loose entry in this real world into a folder.
