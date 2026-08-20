# Campaign Companion — GM Guide

This guide walks a GM through Campaign Companion end to end: installing it, running your first session, and using everything it adds on top of Monk's Enhanced Journal (MEJ) — the timeline, the Campaign Hub, tags and the relationship graph, auto-linking, secrets, and Word import/export. It assumes you've never opened the module before.

If you're a player on a table that uses Campaign Companion, read the [player guide](player-guide.md) instead — this one is written from the GM's seat.

## What Campaign Companion adds

Campaign Companion adds a session-and-campaign layer on top of MEJ: a Session journal type for recapping your table's sessions, a searchable Campaign Hub that indexes everything campaign-relevant, a timeline you can bind to in-world calendar dates, tags and a relationship graph for tracking who's connected to what, automatic linking and capture, GM-managed secrets, and Word document import/export. Everything it does builds on entries and pages MEJ already knows how to render — nothing here replaces MEJ, it extends it.

The screenshot below is the Campaign Hub — the module's home base. You'll spend most of your GM prep time here once you're set up.

![The Campaign Hub's entry index, listing campaign entries by name and type](images/hub-index.png)

## Installation & first-time setup

1. In Foundry's **Add-on Modules** screen (Setup → Add-on Modules → Install Module), paste this manifest URL and click Install:

   ```
   https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json
   ```

   If you'd rather install manually, download or clone the repository into your Foundry `Data/modules/mej-campaign-companion` directory (the folder name must match the module id) and restart Foundry so it picks up the new module.

2. Open your world's **Manage Modules** dialog and enable **both** "Monk's Enhanced Journal" and "Campaign Companion for Monk's Enhanced Journal". Load order doesn't matter — Campaign Companion listens for MEJ's own setup hook regardless of which module's script loads first.

3. Open **Configure Settings → Module Settings** and find the Campaign Companion section, shown below. You don't need to turn anything on to start using the module — the Session sheet, Hub, tags, graph, secrets, and docx import/export all work with every setting left at its default. The five settings here (auto-link, retroactive auto-link, the two auto-capture toggles, and player-writable sessions) are opt-in conveniences you can turn on once you know you want them; [Settings reference](#settings-reference) below covers each one and when to flip it.

   ![Campaign Companion's module settings panel, showing all five visible settings with their descriptions](images/settings.png)

## Running your first session

Create a Session entry the same way you'd create any other MEJ entry:

1. Open the Journal sidebar tab.
2. Click the button that creates a new entry (MEJ's own "Create Entry" control).
3. In the dialog, give it a name — for example, "Session 12 — Shadows over Daggerford".
4. From the Type dropdown, choose **Session**.
5. Confirm the dialog. MEJ opens the new Session entry.

(If you're running a stock MEJ install without the extension API, Session doesn't appear in this dialog at all — use the Hub's **New Session** button instead. See [Running on stock MEJ (native mode)](#running-on-stock-mej-native-mode) below.)

The Session sheet has four tabs — **Recap**, **Session**, **Relationships**, and **Notes** — plus the same generic page header (Page Name, Type, File Path, Page Category, Sort Order) every MEJ page type shares.

![The Session sheet's Recap tab, showing the GM recap text and the Player Recaps section below it](images/session-sheet-gm.png)

- **Recap** is where you write your own GM recap of what happened. Below it, under **Player Recaps**, each player's own recap lists in turn once they've written one (players write these themselves once `playersWriteSessions` is on — see [Player collaboration](#player-collaboration) — or, without that, over the GM-relay path); the shot above catches this session before any player has written theirs, so that section is still empty.
- **Session** holds the session number, the in-world campaign date (year, month, day, hour, minute), the attendee list (drag player-character or NPC Actors onto it), and the secret checklist described below.
- **Relationships** is MEJ's standard relationships panel — link the session to other campaign entries from here.
- **Notes** is GM-only free text; the template hides this tab's content entirely from non-GM viewers.

The campaign-date fields on the Session tab use the same Year / Month / Day layout you'll see everywhere Campaign Companion asks for an in-world date — including the Hub's own "Add Timepoint" dialog (the Hub's Timeline pane covers this in more detail further down). Here's that dialog, filled in with this session's date, from adding a matching timepoint to the timeline so the session shows up there too:

![The Add Timepoint dialog with Label, Year, Month, Day, and Time fields filled in for Session 12](images/campaign-date-picker.png)

The Session tab's secret checklist lets you track secrets tied to this session specifically — separate from the block-level secrets covered under [Secrets](#secrets) below, though both reveal through the same audience machinery. Click the add-secret button to add a row, type the secret text, and use the per-row controls to hide/reveal it, open its reveal-audience dialog, or delete it:

![The Session tab's secret checklist, with two secret rows and their hide, audience, and delete controls](images/session-checklist.png)

## The Campaign Hub

Open the Hub from the "Campaign Hub" tab inside MEJ's own tabbed shell, or from the notes group in Foundry's scene controls. It has five panes along the top: **Index**, **Timeline**, **Search**, **Dashboards**, and **Secrets**. This section covers the Index; Timeline is covered next, and Dashboards and Secrets are covered as part of [Building your campaign record](#building-your-campaign-record) and [Secrets](#secrets) below.

The **Index** is a filterable, sortable list of every campaign-relevant entry — every MEJ-typed entry (Person, Place, Quest, Shop, and so on) plus Session pages. Use the type filter and the name-filter box to narrow it down, and the sort icon to change ordering. Entries with incoming `@UUID` mentions from elsewhere in your campaign show a mention-count badge next to their name, like the badges on "The Gilded Flagon" and "The Missing Caravan" below:

![The Hub's Index pane, listing campaign entries with mention-count badges next to some of them](images/hub-index.png)

The Index toolbar is also where you'll find **New Session**, **Import Document**, and **Export** — the latter two are covered further down, in the Word import & export section.

Once you know roughly what you're looking for, the **Search** pane is faster than scrolling the index. Type a query and results appear as you type, matching across entry names, descriptions, attributes, and Session fields (secrets and GM notes match too — but only for a GM; a player's search never surfaces GM-only content):

![The Hub's Search pane, showing results for the query "caravan" across two Persons, a Session, and a Quest](images/hub-search.png)

## The timeline & campaign dates

The Hub's **Timeline** pane holds a single world timeline of timepoints — labeled markers you can attach documents or images to, and optionally bind to an in-world calendar date using Foundry's v14 calendar API.

![The Hub's Timeline pane, listing four timepoints including one with a document attached](images/hub-timeline.png)

Three buttons at the top switch how the list orders itself: **Manual** (drag entries into whatever order you want — a fractional-key drag-insert under the hood, so you can drop a new point between any two existing ones), **Date Added** (creation order), and **Campaign Date** (chronological by the in-world date you gave each timepoint, for the ones that have one).

Click **Add Timepoint** at the bottom to create one — give it a label, and optionally fill in a campaign date (the same Year/Month/Day/Time dialog shown in [Running your first session](#running-your-first-session) above). To attach a document or image to a timepoint, drag it from the sidebar (or from a Hub search result) onto the timepoint's row — that's how "The Caravan Departs" above ended up with "The Missing Caravan" attached to it. A dragged-in document's own permissions decide whether players can see it, but an attached image is different: it's hidden from players by default, and stays that way until you toggle its own eye icon on the timepoint row to make it visible to them.

## Building your campaign record

This section covers the knowledge-layer tools: tags and attributes, backlinks, the relationship graph, and Hub Dashboards.

**Tags and attributes.** Every MEJ entry gets a knowledge panel where you can add free-text tags and custom key/value attributes. Each attribute row has a `playerHidden` toggle (the eye icon) — check it to keep that one row off a player's view of the sheet, even if the player can otherwise see the entry:

![The Tags and Attributes section on a Person entry, showing two tags and two attribute rows, one marked player-hidden](images/knowledge-tags-attributes.png)

**Backlinks.** The same knowledge panel's "Mentioned in" section lists every other campaign entry that links to this one via an `@UUID` link, with a count. This is also where the Index's mention-count badges come from:

![The Mentioned In backlinks panel, showing one incoming link from "Mira Thornwood"](images/knowledge-backlinks.png)

**The relationship graph.** Open it from the graph icon in the Hub's toolbar — always available, regardless of your MEJ build — to visualize entries connected via MEJ's own relationships. MEJ can also add a header button to a specific entry's sheet for this, but that route needs an MEJ build carrying the v14 header-button fix; most MEJ builds published as of this writing don't have it yet, so the button simply won't appear on your Session sheet or entry windows until it does. It has two modes: **Focus** centers on one entry and shows only its direct connections, while **Whole campaign** lays out everything at once (capped at the 200 most-connected entries, for performance — additional nodes and links to them are left out of the view). There's also an optional dashed overlay ("Show mention links") that layers `@UUID` backlinks on top of the relationship edges. The shot below is Focus mode centered on Captain Aldric Vane, showing his one relationship to "The Missing Caravan":

![The relationship graph in Focus mode, centered on Captain Aldric Vane with one connected node](images/graph-gm.png)

**Hub Dashboards.** The Dashboards tab holds saved searches using a simple grammar — `type:`, `tag:`, `attr:`, and plain free-text terms combined together (for example, `type:person tag:ally`). Click **Add dashboard**, give the query a name, and its results render inline right there in the tab whenever you open it. Each saved dashboard also has its own **Visible to players** checkbox in that same dialog — leave it unchecked (the default) to keep a dashboard GM-only, or check it to let players see that saved query and its live results too:

![The Dashboards tab, showing a saved "Allies" query and its live results](images/hub-dashboards.png)

The same query syntax works as an `@CampaignQuery[...]` enricher you can drop directly into any MEJ entry's text — type `@CampaignQuery[type:person tag:ally]` and it renders its results inline wherever that text appears, the way it does on "The Gilded Flagon" below:

![The Gilded Flagon's description page, with an inline @CampaignQuery result showing Mira Thornwood](images/campaign-query-inline.png)

One thing to keep in mind: enricher results refresh only when the page re-renders, not live — rebuild the dashboard (or reopen the page) to see the latest matches after you've added new entries.

## Auto-linking

The **Auto-Link Entry Names** setting (off by default) turns newly-typed mentions of existing MEJ entry names into `@UUID` links automatically, as soon as you save the page. It never touches text that's already inside a link, and it never rewrites inside a code block. Any individual page can opt out entirely with its own `noAutoLink` flag.

A separate **Retroactive Auto-Link** setting (default: Confirm) handles the other direction: when you create a *new* MEJ entity, it finds existing plain-text mentions of that entity's name elsewhere in your journal and offers to link them. In Confirm mode you get a review dialog with a checkbox per matching page, like the one below — check the pages you want linked and click **Link Checked**, or **Skip** to leave them as plain text. In Silent mode it links immediately and sends you a whispered summary instead of asking. Off disables retroactive linking entirely.

![The Auto-Link New Entry confirm dialog, offering to link one page mentioning "Old Toby Rackett"](images/autolink-confirm.png)

Both paths skip names that are ambiguous — shared by more than one entity in the audience — rather than guessing; ambiguous names are listed in the dialog or summary instead of being linked.

Both paths are also bounded by audience containment, stated in plain terms: a mention only ever becomes a link when everyone who can already read the page can also see the entity being linked to. A GM is exempted from that check, but a page a player can see will never get auto-linked to something that player can't.

## Auto-capture

Two more opt-in settings automate filing things onto the timeline for you, so you don't have to remember to do it by hand mid-session:

- **Auto-Capture Encounters**: when combat ends, this creates (or updates) an Encounter journal entry summarizing the participants and outcome, and files it onto the timeline's newest timepoint.
- **Auto-Capture Shared Media**: whenever you use Foundry's "Show Players" on an image or video, this files it onto that same newest timepoint automatically.

Both are independent of each other and off by default. Neither ever blocks the operation it's hooked into — see [Troubleshooting](#troubleshooting) below.

## Secrets

Campaign Companion gives you two related but distinct ways to keep things hidden from players until you're ready to reveal them, and both reveal through the same audience machinery.

**Block-level secrets** live inside an entry's own description text — mark a block as a secret section the same way you would with Foundry's native secret blocks, on any MEJ entry that has a text region (Persons, Places, Quests, Shops, and so on). Session pages don't have a text-content region of their own, so a Session's secrets surface is its **secret checklist** instead, described above under [Running your first session](#running-your-first-session) — for block-level secrets, use the entry they're actually about. In the demo campaign, the secret about the caravan ambush being staged lives on the Quest "The Missing Caravan," not on the Session page.

Click a block secret's audience control to open the reveal dialog. Check **Everyone**, individual players, or one of your player groups, then apply:

![The Reveal secret dialog, with Everyone, individual player, and player-group checkboxes](images/secret-audience-dialog.png)

You can reveal secrets from two places: the audience dialog on the secret itself (as above), or from one place — the **Hub Secrets tab**, which lists every secret across your campaign — both block secrets and checklist secrets — filterable by entry type, revealed state, and which specific player you're checking. Each row still opens its own reveal dialog, one secret at a time — the Secrets tab's advantage over hunting down secrets one entry at a time is that everything is already in one list, not that it reveals in bulk. That last filter answers "what does player X know" at a glance: pick a player and the list narrows to what's been revealed to them.

![The Hub Secrets tab, filtered to show secrets and their reveal state across the campaign, with player groups listed below](images/hub-secrets-tab.png)

Player groups — named collections of players you manage from this same tab — are reveal targets alongside individual players, so you can reveal one secret to "Inner Circle" instead of checking three players individually every time.

The **session prep board**, opened from the clipboard-icon button in the Session tab's own toolbar (next to the secret checklist, not a header button — always available regardless of your MEJ build), is a GM-only board for tracking reveal decisions across a session: which secrets and clues are relevant, which are already revealed, who attended, and any linked entries — plus a scratch-notes box for anything else you want on hand while running the table:

![The session prep board, showing attendees, the secrets/clues checklist, linked entries, and a scratch-notes box](images/prep-board.png)

When you reveal a secret to a player, they get a private whisper notification with the secret's text and which entry it's from:

![The private chat whisper a player receives when a secret is revealed to them](images/reveal-whisper.png)

The relationship graph, described above under [Building your campaign record](#building-your-campaign-record), has its own reveal mechanism too: you can designate which players or groups can see each edge, with a label per edge, so a player's view of the graph only shows the relationships and labels you've granted them.

**Before you rely on any of this to protect something sensitive at the table:** secrets here are hidden by client-side filtering, the same trust model as Foundry's own secret blocks and MEJ's GM notes — the data still reaches every client that can see the page. Read the README's [secrets trust model](../README.md#secrets-layer-030) for the full statement, including the caveat about choosing "Everyone" in the reveal dialog versus Foundry's own native Reveal control.

## Word import & export

The docx import wizard turns a `.docx` (from Word or a Google Docs export) into MEJ entries and Session pages.

1. From the Hub's Index toolbar, click **Import Document**.
2. Choose an **Audience** — "GM only" or "All players (Observer)". This sets the ownership of every entry the import creates, and it's also what bounds which entities the imported text is allowed to auto-link to.
3. Select your `.docx` file. The wizard parses it and shows a review screen with one row per detected section.
4. For each section, check the suggested MEJ type in its dropdown (it guesses from title keywords or a `Campaign Record type:` marker left by a prior export) and adjust it if needed. Sections whose heading looks like a dated header (e.g. "Session Zero 10/6/2024") get a checkbox and a detected date pre-filled — leave it checked to create a timepoint for that date on import.
5. Click **Import**. Import is transactional per run: entries are only created once you confirm, and if anything fails, you get a per-section warning with no partial writes.

![The docx import wizard's review screen, showing detected sections with their suggested types and detected dates](images/docx-import-wizard.png)

Export walks the other direction — selected entries and the timeline out into a round-trippable `.docx`:

1. From the Hub's Index toolbar, click **Export**.
2. Check the entries you want included (everything is checked by default).
3. Leave **Include GM Content** unchecked to produce a document that's safe to hand directly to players — session GM notes and player-hidden relationships are left out. Check it if this export is for your own GM-side backup or reference.
4. Click **Download**.

![The docx export dialog, listing selected entries with the Include GM Content toggle unchecked](images/docx-export-dialog.png)

For the details of what does and doesn't survive a round trip — type markers, date-parsing behavior against non-Gregorian calendars, and the vendored libraries used — see the README's [docx round-trip notes](../README.md#docx-round-trip-notes).

## Player collaboration

Turning on the **Players Write Sessions** setting lets players write their own session recaps directly, without you relaying anything. Once it's on, new Session entries created through the docx import wizard or MEJ's own New Entry dialog are owned by all players by default, so an owning player can open the Recap tab and edit their own recap the same way you edit yours.

Players who don't have Foundry's file-upload permission (or who don't have ownership at all, if the setting is off) still get their recap and inline-image writes through — those are relayed through an active GM's client instead, over the same channel MEJ uses for its own per-user notes. From a player's seat this is invisible: they just edit their recap and it saves, whichever path is actually carrying the write.

For the full trust-model detail behind that relay — what it does and doesn't protect against — see the README's [player collaboration notes](../README.md#player-collaboration-notes).

## Running on stock MEJ (native mode)

Campaign Companion works against a stock Monk's Enhanced Journal install, not just one carrying MEJ's extension API. Mode detection happens automatically and silently at startup — there's no warning, no setting to flip, and native mode is a fully supported configuration, not a degraded fallback. Everything in this guide still applies; only four things differ:

- Session doesn't appear in MEJ's own "New Entry" dialog — create sessions with the **New Session** button in the Campaign Hub instead (see [Running your first session](#running-your-first-session) above).
- Session pages can't be MEJ *relationship* targets (MEJ's own picker only enumerates its own registry). Companion relationships are unaffected.
- The Hub opens as its own standalone window rather than as a tab inside MEJ's shell.
- The "open graph" and "prep board" header buttons aren't present on the Session sheet or Hub. This isn't unique to native mode, either: as of this writing, most MEJ v14 builds don't render either header button in *any* mode, due to an upstream MEJ header-injection bug — it's fixed only in MEJ builds that carry the v14 header-button fix. Both remain reachable regardless — the graph from the Hub's own toolbar, the prep board from its button on the Session sheet.

If your world moves between a build with the extension API and a stock build (in either direction), no migration step is needed — a stock MEJ install strips the module's own MEJ type flag from Session pages, and an API-carrying build's GM client silently re-stamps it the next time it loads.

## Settings reference

Five settings are visible in **Configure Settings → Module Settings**, all world-scoped (they apply to everyone in the world, and only a GM can change them):

![Campaign Companion's module settings panel](images/settings.png)

- **Auto-Link Entry Names** (default: off) — see [Auto-linking](#auto-linking). Turn this on once you have enough named entries that manually linking every mention becomes tedious; it's safe to leave on indefinitely, since it only links names that already exist and never touches an existing link or a code block.
- **Retroactive Auto-Link** (default: Confirm) — see [Auto-linking](#auto-linking). Confirm is the safer default: you review a checklist before anything gets linked. Switch to Silent once you trust the results and don't want the dialog interrupting you; set it to Off if you don't want retroactive linking at all (new-mention auto-linking on save, above, is independent of this).
- **Auto-Capture Encounters** (default: off) — see [Auto-capture](#auto-capture). Turn this on if you'd rather have an Encounter entry appear automatically after every fight than create one yourself.
- **Auto-Capture Shared Media** (default: off) — see [Auto-capture](#auto-capture). Turn this on if you regularly show players images or video during a session and want them filed onto the timeline without extra effort.
- **Players Write Sessions** (default: off) — see [Player collaboration](#player-collaboration). Turn this on if you want players writing their own recaps directly instead of relaying them through you.

Four more settings exist with no UI at all — `timelineJournalId`, `savedQueries`, `playerGroups`, and `forceNativeMode` — and shouldn't be hand-edited: the first is set automatically by the Hub, the next two are managed from the Hub's own Dashboards and Secrets tabs, and the last is an internal testing escape hatch. The README's [Settings table](../README.md#settings) is the authoritative reference for every setting, visible or not, including exact defaults.

## Troubleshooting

**Startup notifications.** Campaign Companion can show one of two permanent error notifications when a world loads:

- If Monk's Enhanced Journal isn't installed or isn't active, the module disables itself and shows a notification saying so, rather than half-loading with silent failures.
- If MEJ *is* active but the module's own registration throws (a bug in Campaign Companion itself), you'll see a more specific `init-failed` notification instead, with the error logged to the console.

A world [running native mode](#running-on-stock-mej-native-mode) shows neither of these — that's a fully supported path, not an error.

**Auto-link and auto-capture never block a save.** Both are pure observers: if either one fails for any reason, the failure is logged to the console and skipped, and the underlying page-save or combat-end action that triggered it still completes normally.

**Docx import is all-or-nothing per run.** Entries are only created once you confirm the import wizard; if anything fails partway, you get per-section error messages and no partial documents are left behind.

**Filing issues.** If you hit a bug, file it at the [GitHub repository](https://github.com/bularzik/mej-campaign-companion/issues).
