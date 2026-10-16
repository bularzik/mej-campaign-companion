# Campaign Companion — UI review and target experience

Date: 2026-10-15. Reviewed against `origin/main` @ 191026f (0.26.0 line, party relationships merged) and the live World A install (0.25.0, Foundry 14.368, MEJ fork in api mode). Sources: README, GM and Player guides, the 35 guide screenshots, a read-only survey of every template, hook, app and `lang/en.json` string, and a live pass on World A as `User 1` and as `Gamemaster`.

## 1. Intent

The Companion exists so that a party can **cooperatively keep a journal of their progress through an adventure** inside Foundry, on top of Monk's Enhanced Journal (MEJ). This document judges the UI the Companion presents against that job, says what the optimal UI would be, and lists the changes needed to get there, ranked.

Two questions drive it:

1. Does the UI need to change to be more intuitive to its users?
2. Where does MEJ + Companion, as seen through the Companion's overlay, fall short of what players would ideally have?

**The owner's model (stated during this review, and the design input everything below follows):** the Session is the primary thing players interact with during an actual game session. Players write there as play happens, and extract a Person, Place or other entry from the session text when it makes sense. A real campaign the owner's party kept in a Google Doc imported into the Companion as 34 sessions, so the session-as-document shape is proven; the question is whether the UI makes it the natural place to write *during* play rather than after.

## 2. Who this is for, and the bar

- A server admin installs the module. A GM enables it and sets up a campaign. Players arrive later.
- Players know the game's rules and have a character. They may be strangers to the GM. **They have had no onboarding to the Companion.**
- A world may host several parties running the adventure independently. Each party's journal is its own campaign, and nothing from one party's experience leaks into another's.

**The bar (user's standard):** a player with basic Foundry familiarity and zero Companion coaching should complete each job below without asking the GM how.

## 3. Goals, non-goals, anti-goals

**Goals**

- Make the five jobs in §4 completable by a first-time player from the screen alone.
- Keep the GM's prep surfaces (secrets, import, timelines, dashboards) intact while moving the player's surfaces to the front.
- Keep every player-facing surface inside one campaign unless the player can see more than one.

**Non-goals**

- Visual restyling of MEJ itself. The Companion overlays MEJ; MEJ's sheet chrome stays as it is.
- Replacing MEJ's typed entries (Person, Place, Quest…) as the canon layer. The GM's canon stays MEJ's; the party's layer sits beside it.
- Changing data models unless a job cannot be done without it (§5 names the two places where it cannot).

**Anti-goals (what would make a change a failure even if it works)**

- A "fix" that adds a seventh Hub tab or another settings toggle for the player to discover. The problem is already too many equal-weight surfaces, not too few.
- Anything that makes a player's note visible to another party in the same world.
- Anything that requires the GM to be online for a player to write their own note (the party notebook in PR #49 proved GM-offline writes are possible; new player writes should use the same pattern).
- Mixing party notes into the GM's canon text so the GM can no longer tell what they wrote.

## 4. The jobs, the ideal, and what the screen does today

Each job states what a first-time player should see and do, what they see today, and the gap. Screen descriptions are from the guide screenshots and the live pass; code citations are `file:line` on origin/main.

### 4.1 Capture in the moment ("we just learned the duke is lying")

**Ideal.** From anywhere in Foundry, in under five seconds and without leaving the scene: type a line, it lands in tonight's session, stamped with who wrote it and when, with "the duke" turned into a link. Later it is findable from the duke's own page and from the session.

**Today.** There is no capture primitive. The path is: a Session page for tonight must already exist (GM creates it via **New Session**); **Players Write Sessions** must be on (off by default, `campaign-companion.mjs:115`); the player opens the sidebar, finds the Session entry among the others, opens Recap, clicks the pencil, types, then clicks the pencil again to commit (the player guide spends a paragraph on this). One shared recap, no author stamp, no timestamp. Alternative: edit the Duke's Person page directly, which only works when the campaign baseline is **Players can edit**, and writes into the GM's canon description. MEJ's **Notes** tab on an entry is per-user and private, so it is not a party note.

Extraction, the second half of the owner's model, does exist: the recap is a linkable region (`logic/link-targets.mjs:15-23`), so **Create Entity from Selection** and **Link to Entity** work on recap text. For a player this needs them to be a campaign Contributor and a GM to be online; otherwise the menu item is absent and nothing says why.

**Gap.** Functional. No "tonight's session", no low-friction write, no author/time, no party-owned place to say something about an entity. Extraction works but is gated in a way a first-time player cannot see.

### 4.2 Recording a session: one scribe, or everyone independently

**Ideal.** During play the table has one obvious place to write. A single scribe writes a running recap; or each player drops their own lines, each attributed, and the session page shows them together in order. After the session the recap reads as one narrative, with the raw lines still reachable. Attendees are recorded without anyone doing it by hand.

**Today.** The recap is a single collaborative ProseMirror document (`session.hbs:43-55`). That serves the scribe case well: simultaneous owners see each other type. It serves the independent case badly: no attribution, one cursor fight, no way to tell who wrote what, no per-line timestamp. Attendees are a GM drag-and-drop target; the hint "Drag an Actor here to add them as an attendee." shows to players who cannot drop (`session.hbs:96`). The Session tab mixes player-relevant fields (number, date, attendees) with GM-only machinery (secrets checklist, GM Notes) and a Secrets heading that renders for players with "No secrets yet." (`session.hbs:101-124`).

**Gap.** Functional for independent capture (needs attributed lines); UI for the Session tab layout and player-facing hints.

### 4.3 The GM feeds information in

**Ideal.** When the GM hands the party something (a handout, a revealed secret, a new NPC, an image shown at the table) it shows up in one place the player checks: "new since last session", and it is also filed onto tonight's session so looking back finds it. The GM's act of revealing is the act of filing; no second step.

**Today.** The pieces exist but do not join up. Reveals send a chat whisper (good, but it scrolls away). Revealed blocks get an orange rule on the page. The Index eye toggle flips entry ownership. **Show Players** images can be auto-captured onto the newest timepoint, off by default and silent. Encounter capture is on by default but gives no success feedback and warns on every combat when no target campaign is set (`hooks/auto-capture.mjs:156-230`). Nothing tells a player "three things changed since you last looked". The GM has two parallel note fields per session (GM Notes on the sheet, Scratch notes on the prep board) and two reveal controls on the session checklist that look alike but only one whispers (`SessionSheet.mjs:436` vs `:452`).

**Gap.** Functional: a "what's new" view and reveal-to-session filing. UI: consolidate the two session-checklist reveal controls and the two GM note fields.

### 4.4 Looking back and connecting things

**Ideal.** A player asks "when did we meet the duke, and what did we know then?" and gets, from the duke's page, the sessions and notes that mention him in order. The timeline shows sessions and party notes alongside the GM's timepoints. The graph shows what the party believes connects, not only what the GM has drawn. Search results read like prose.

**Today.** The Hub has Index, Timeline, Graph, Search and Dashboards, all of equal weight and all GM-shaped. The Index mixes sessions with every other type in one alphabetical list; there is no chronological session list. The Timeline is GM-authored timepoints (plus one auto-timepoint per session); players read it. The Graph's **Focus** mode is unreachable on MEJ v14 because the only thing that enables it is a header button the guides say does not render (`hub-graph-pane.mjs`, `campaign-companion.mjs:271-285`). Search snippets show raw `@UUID[...]` markup (player guide, "Quick answers"). The knowledge panel's "Mentioned in" lists backlinks but with no order and no session context. Party relationships (PR #49) are the one party-owned layer and appear as dotted graph lines; good, and the pattern to extend.

**Gap.** Functional: entity history in session order; sessions as a first-class chronological view; search snippet enrichment. UI: Focus reachability, tab weighting.

### 4.5 Scoping to one party's campaign

**Ideal.** A player in one campaign never sees a picker, a count, or a result from another campaign. The campaign name is always visible. Opening the Hub from anywhere lands in their campaign.

**Today.** The Hub's default scope is **All campaigns** (`CampaignHubPage.mjs:454-467`), and the only on-screen scope indicator is the picker. The portal entry scopes it correctly, but the shell's Campaign Hub control and a timeline-journal open do not necessarily. Search reports "N more matches in other campaigns" and the spillover button switches every tab to All (`:1410-1414`). A timeline picked under one campaign persists under another as "— Selected elsewhere —" (`:529-534`). Surfaces that ignore scope entirely: Word export (`export-dialog.mjs:103-115`), the party relationship target picker (`party-relationships-ui.mjs:149`), the knowledge panel's "Mentioned in" (`search/live-index.mjs:229`), and `@CampaignQuery`. Dashboards and the Index are scoped.

**Gap.** UI mostly: lock scope for single-campaign players and show the campaign name; functional for the four unscoped surfaces.

### 4.6 Finding the way in (cross-cutting)

**Today.** A brand-new player gets no welcome, no empty-state guidance, and no in-app help (Tools → Open the user guide opens GitHub in a new tab). The scene-controls Hub button is GM-only in code (`campaign-companion.mjs:307-308`) while both guides tell players it is theirs. The shell's Campaign Hub control exists only once some MEJ window is open. In practice the one reliable route is the portal entry, which looks like any other journal entry in the sidebar. Opened outside MEJ's shell (observed live by rendering the entry's own sheet), a Person shows only its name and the Hub renders cramped inside Foundry's stock multi-page sheet.

## 5. The target experience

Design principles that the change list below follows:

1. **The session is the unit of play; the campaign is the unit of memory.** This is the owner's model (§1). Players land on "tonight", write there, extract entries from what they wrote, and look back through the campaign.
2. **One capture primitive.** A *note*: short text, author, real time, optional in-world date, the session it belongs to, the entries it is about. Everything player-written that is not the polished recap is a note. Notes render on the session page (in order), on each entry they mention (under "Party notes"), and on the timeline.
3. **The party layer sits beside the GM's canon, never inside it.** Party notes, party relationships and the recap are party-owned; MEJ's description, attributes and GM relationships stay the GM's. Storage follows the party-notebook pattern from PR #49: a hidden per-campaign entry the Contributors own, so no GM needs to be online.
4. **Revealing is filing.** Anything the GM reveals or shows is recorded as a GM-authored note on the current session, so "what's new" and "what happened" are the same list.
5. **A player sees one campaign.** The picker is a GM tool.

### 5.1 The player's Hub

The Hub keeps its six panes for the GM. For a player it is re-weighted, not rebuilt:

- **Header:** the campaign name as a title (not a picker) when the player can see exactly one campaign; the picker only when they can see more. No "All campaigns" or "Unfiled" for players.
- **Tonight strip** under the header, on every tab: "Session 14 · started 19:05 · 4 attending" with a one-line capture box ("Note something…") and the three most recent notes. If no session is open: "No session running" and, for the GM, a **Start session** button. Players never create sessions; the GM starts one (or the Companion offers to when the GM logs in on a new day, a world setting, off by default).
- **Tabs, player order:** Sessions · Entries · Timeline · Graph · Search. Dashboards stays for the GM and for players only when a dashboard is marked visible (then it appears as a sixth tab, as now).
  - **Sessions** (new): chronological, newest first, each row with number, title, in-world date, attendees, recap first line, note count. Opens the Session page.
  - **Entries** is today's Index.
- **Empty states** teach: the Sessions tab with no sessions reads "Your GM hasn't started a session yet. Notes you take will go into the first one." The Timeline's "…next time a GM opens this tab" line goes.
- **Help** is a short in-Hub panel (five lines: what a session is, how to note, where notes go, how reveals reach you, where to look back), with the GitHub guide as a link under it.

### 5.2 The Session page

- **Recap tab** stays the one collaborative document, editable by attendees of that session by default when the campaign baseline is at least **Players can view** (today it needs the separate **Players Write Sessions** world setting). The pencil toggles stay, but a visible "Saving…/Saved" state replaces the "click the pencil again to commit" rule.
- **Notes stream** (new, on the Recap tab under the recap, or its own first tab; builder's call): the session's notes in order, each with author token, time, text, linked entries. The capture box sits at its top. A GM's reveals and shown images appear in the same stream as GM-authored notes.
- **Session tab** for players holds number, in-world date, attendees. The Secrets heading, "No secrets yet.", the attendee drag hint and GM Notes render only for the GM. Attendees default to the players connected when the session started (editable by the GM).
- **Relationships** and **Notes** (MEJ private notes) stay as they are.

### 5.3 Capture from anywhere

- **Chat command** `/note <text>` (and `/n`): appends a note to the current session for the sender. Confirms with a one-line chat echo visible to the sender. Mentions of entry names are auto-linked by the existing auto-link pass. If no session is running, the note is held as "unfiled, tonight" and the Hub strip says so; the GM's next Start session adopts it.
- **The Tonight strip's capture box** does the same from the Hub or any Session page.
- **"Note about this"** on an entry page (a small button beside the knowledge bar): opens the same box prefilled with a link to the entry.

### 5.4 Entity pages: the party layer

- **Party notes** section in the knowledge panel, above Tags: every note that mentions this entry, newest first, with session and author. Writable through "Note about this". This is where "the duke is lying" lives from the duke's side.
- **History** replaces "Mentioned in" for players: the same backlinks, grouped by session in order, with non-session mentions after. The GM keeps the current flat list as a second view.
- **Party relationships** stay as shipped; the target picker is scoped to the campaign.

### 5.5 Looking back

- **Timeline** shows sessions (already auto-timepointed) and, toggled, party notes with in-world dates, drawn in a second colour. Players read; the GM arranges.
- **Graph**: Focus is reachable by clicking a node ("Focus on this") and from a "Focus on…" picker in the toolbar.
- **Search** snippets are enriched before display (links show as their text).

### 5.6 Scoping

- A player who can see one campaign never sees the picker, the spillover count, "— Selected elsewhere —", or **Unfiled**.
- Export, the party relationship picker, "Mentioned in" and `@CampaignQuery` honour the campaign scope. Export offers "this campaign" (default, with its timelines) and "whole world".
- Opening the Hub from the shell control scopes to the campaign of the entry currently open, when there is one.

### 5.7 GM surfaces: consolidation, not expansion

- One reveal control per session-checklist secret (the audience dialog, which whispers). The eye becomes the "Everyone" shortcut inside that dialog.
- One GM note field per session: Scratch notes on the prep board merges into GM Notes, or the prep board shows GM Notes.
- Delete confirms on dashboards, groups, session secrets and attributes, matching timepoints and timelines.
- The campaign settings dialog explains Contributors fully ("can take notes, add party relationships and create entries from selected text in this campaign"). Player groups are editable from that dialog as well as from the Secrets tab.
- Auto-capture: a success toast per capture; when the world has one campaign it is the target automatically with no warning.
- Wording: one casing rule for "Add …" labels, one ellipsis form, "entry" everywhere the UI means a journal entry, and the Index eye's tooltip says what it does ("Hide entry from players" / "Share entry with players") so it stops colliding with secret reveals.
- Docs corrected to match the code on the three contradictions found (scene-control access, header buttons, player Relationships tab).

## 6. Ranked change list

Kind: **UI** = change to how existing function is presented; **Gap** = function missing from MEJ + Companion. Size: S (a day or less), M (days), L (a week or more). Jobs refer to §4.

| # | Change | Kind | Size | Jobs |
|---|--------|------|------|------|
| 1 | **Notes primitive and session notes stream.** A note = text, author, time, in-world date, session, mentioned entries. Stored on a hidden per-campaign party notebook (PR #49 pattern) so players write without a GM online. Rendered on the Session page in order with author tokens. Auto-link runs on save. | Gap | L | 4.1, 4.2, 4.4 |
| 2 | **Current session and Tonight strip.** One open session per campaign at a time; GM **Start session** / **End session** (New Session stays as the prep-ahead path). Strip on every Hub tab and Session page with a capture box and last three notes. "No session running" state. | Gap | M | 4.1, 4.2 |
| 3 | **`/note` chat command** and "Note about this" on entry pages, both writing through #1. Held-until-session behaviour when none is open. | Gap | S after #1 | 4.1 |
| 4 | **Player-scoped Hub.** Campaign name as title and no picker for single-campaign players; remove All/Unfiled/spillover/"Selected elsewhere" from the player view; shell control scopes to the open entry's campaign. | UI | S | 4.5, 4.6 |
| 5 | **Sessions tab** in the Hub, chronological with recap preview and note counts; player tab order Sessions · Entries · Timeline · Graph · Search. | UI | M | 4.4 |
| 6 | **Party notes and History on entry pages.** Knowledge panel gains Party notes (from #1) and a session-ordered History view of backlinks. | Gap | M after #1 | 4.1, 4.4 |
| 7 | **Revealing is filing.** Secret reveals, relationship reveals and Show Players images write a GM-authored note to the current session; the whisper stays. Auto-capture success toasts; single-campaign auto-target. | Gap | M after #1 | 4.3 |
| 8 | **Recap editable by attendees by default** when the campaign baseline allows players to view; retire or demote **Players Write Sessions**. Visible save state in the recap editor. | UI | S | 4.2 |
| 9 | **Session page for players**: hide Secrets heading, attendee drag hint and GM machinery from non-GMs; attendees default to connected players at Start session. | UI | S | 4.2 |
| 10 | **Entry points.** A player-visible way into the Hub that needs no open window: either grant the scene-control tool to players (one-line gate change) or pin the portal at the top of the journal sidebar with a distinct icon. Fix the three doc/code contradictions. | UI | S | 4.6 |
| 11 | **Empty states and in-Hub help panel** as in §5.1. | UI | S | 4.6 |
| 12 | **Graph Focus reachable**: focus-on-node click and a "Focus on…" picker. | UI | S | 4.4 |
| 13 | **Search snippets enriched** (link text, not `@UUID`). | UI | S | 4.4 |
| 14 | **Scope the four unscoped surfaces**: export (campaign default, with its timelines), party relationship picker, "Mentioned in", `@CampaignQuery`. | Gap | M | 4.5 |
| 15 | **GM consolidation**: one reveal control per checklist secret, one GM note field per session, delete confirms, Contributors hint, player groups editable from campaign settings. | UI | S | 4.3 |
| 16 | **Timeline shows party notes** with in-world dates as a toggled second series. | Gap | S after #1 | 4.4 |
| 17 | **Wording pass** per §5.7 (casing, ellipsis, entry/entity, Index eye tooltip, "Edit Timepoint" action name). | UI | S | all |
| 18 | **Import wizard**: review hint only on step 2. | UI | S | GM |

Items 1–3 are one feature and should be designed together; 4, 9, 10 and 11 are the cheapest wins for a first-time player and need no data change; 5–7 and 16 build on 1.

## 7. Ideas beyond the ask (reviewer's suggestions, not requirements)

- **"Previously on…"** When the GM starts a session, the previous session's recap (or its first paragraph) is posted to chat for everyone, as a card linking to the session.
- **Open questions list.** A per-campaign list of things the party wants to find out ("Who paid off the guards?"), each a note flagged as a question, closable with a link to the note that answered it. The GM's Quest type covers objectives the GM sets; this covers the party's own.
- **Per-character perspective.** A note can be tagged "in character" so the Sessions view can filter to one character's view of events.
- **Narrow layout.** Players increasingly join on tablets; the Hub's header and tab strip already wrap awkwardly at the stock sheet's width (seen live). A single-column layout under about 900px.
- **Recap assist.** End session offers the GM/scribe a draft recap assembled from the session's notes in order, to edit rather than write from blank.

## 8. Constraints

- Stock MEJ (native mode) and the API-carrying fork must both keep working; nothing here may depend on the MEJ extension API beyond what the Hub already uses.
- Foundry 13 and 14.
- The companion never patches MEJ; party layers live in the companion's own flags or its own hidden entries (`companion-features-never-patch-mej`).
- Secret text stays soft-hidden (client-side filtering) as documented; notes that mention a secret entry are subject to the same audience containment rule auto-link already enforces.
- Pre-1.0: no migration ceremony is required for the notes store, but existing party notebooks (PR #49) must keep working.

## 9. Decisions made at the builder check (reviewer's calls, open to override)

A fresh reader planned from this document and asked five questions. Two are the owner's to answer and are tracked in §11. The other three are settled here:

- **Reveal notes carry the reveal's audience.** A note written by "revealing is filing" stores the same audience the reveal had (everyone, named users, groups), references the page and block rather than copying the secret text, and is soft-hidden for non-audience readers exactly as secrets are. When the GM un-reveals, the note is marked retracted and its reference stops rendering; the audit line ("revealed X to Y on …") stays for the GM. Show Players images file a note beside the existing timeline capture; neither replaces the other, and no new toggle is added.
- **A note is editable and deletable by its author and by any GM.** Other players cannot edit it. An edit is stamped ("edited"). This differs from party relationships on purpose: relationships are a shared belief, a note is a signed statement.
- **`/note` routes to the campaign with the open session.** If exactly one campaign has a session open, the note goes there regardless of Hub scope. If none is open and the sender can see one campaign, it is held for that campaign. Otherwise the command refuses with a one-line hint naming the fix. It never writes to "All".
- **Recap ownership keys on users, not actors.** At Start session the connected non-GM users become recap owners; a user who connects while the session is open is added live. Attendees (actors) remain what the sheet displays and the GM can edit; a user with no assigned character is still an owner.

## 10. Left to the builder

- Whether the notes stream lives under the recap on the Recap tab or as its own first tab on the Session page.
- Exact storage shape of a note on the party notebook (one page per session vs one flag array), as long as writes are per-note and concurrent authors do not clobber each other.
- Whether "Start session" creates the Session entry immediately or promotes a prepared one.
- The visual treatment of the Tonight strip and of party notes in the knowledge panel, within MEJ's existing palette and the readability tokens from the 0.24 sweep.
- How `/note` registers (chat command hook vs. `chatMessage` hook) and the exact short aliases.
- Ordering of the wording pass with any in-flight branch to avoid conflicts.

## 11. Open to the owner

1. **Who can write notes by default?** Today only campaign Contributors own the party notebook (`logic/party-access.mjs`), and a new campaign has none, so the headline capture feature would be dead until the GM finds the Contributors checkboxes. Recommendation: every player at a campaign baseline of **Players can view** or above can write notes, with notes on their own hidden entry so this does not also make everyone a party-relationship writer. The alternative keeps Contributors as the single gate and auto-adds connected players to it at Start session.
2. **Notes stream in addition to the recap, or the recap alone?** The owner's Google-Doc model is one narrative per session. The stream adds attributed, timestamped lines and entity-side visibility; it also adds a second thing to look at on the Session page. Recommendation: keep both, with the stream feeding a recap draft at End session (§7), so the narrative stays the artifact and the stream is how it gets written during play.

## 12. Evidence appendix

Live pass (World A, 2026-10-15, headless Chromium 1440×900, script in the job tmp dir, screenshots not committed):

- Player first login: Foundry's own User Configuration dialog; nothing from the Companion.
- Radiant Citadel campaign (a test fixture, not a played campaign): 13 entries (9 Person, 1 Place, 1 Organization, 1 Loot, portal, timeline), no Sessions. Baseline **Players can edit** (players are owners of every entry). Its shape is not evidence about how sessions get used.
- Player portal → Hub, Index in campaign scope: correct, no GM controls. Graph: one node, "Show player connections" checkbox (0.25.0 label).
- GM campaign settings dialog: Player access, Apply to all, Contributors (Players list only, no groups defined), Confirm.
- GM Tools menu: Import Document, Export, Auto-capture campaign, Open the user guide; items wrap to two lines at the stock sheet width.
- Entries opened via the document's own sheet render in Foundry's stock multi-page journal view with a bare page.

Code citations are on origin/main @ 191026f and are listed inline in §4.
