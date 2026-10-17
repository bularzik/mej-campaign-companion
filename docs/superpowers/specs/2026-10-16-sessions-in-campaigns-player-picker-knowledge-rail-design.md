# Sessions in campaigns, player campaign picker, knowledge side rail — design

Date: 2026-10-16. Target release: **0.28.0** (carries the PR #60 live-run fixes, which are merged into main or still on `fix/live-run-0.27.0` when this ships — this branch is based on that branch so it carries them either way).

## Intent

The 2026-10-16 live run of 0.27.0 and its fix PR (#60) left five decisions with the owner. The owner answered them on 2026-10-16 evening; this document turns the answers into a buildable design. Four of the five are product changes; one is a test-suite consequence.

The owner's answers, verbatim where they were short:

1. Sessions outside a campaign: "sessions should only exist within campaigns". A session created with no campaign chosen: "create a campaign to hold it", with a "default name that can be changed later".
2. Players and the Hub scope: no "All campaigns"; "is there a campaign choice dropdown? if so, select the first on that list".
3. Knowledge panel vs. page text: "I really like the side rail — can it be collapsible (slide out/in from the right-hand side)?" Between pushing the text narrower and overlaying it: push.
4. Attendees: "players should be able to manage along with GM", and yes to showing the drag hint again to anyone who can actually drop.
5. Release: cut 0.28.0 once this lands, carrying the unreleased PR #60 fixes.

## Goals

- A session never exists outside a campaign folder after creation completes, whichever path created it.
- The world-level "Campaign Timeline" is never auto-created again; campaign-less sessions were the only reason it existed.
- A player's Hub shows exactly their campaigns in a dropdown and nothing else; it opens on a sensible one.
- The knowledge panel stops competing with page text for height: it becomes a collapsible right-hand rail that pushes the text narrower while open.
- Players who own a session can add and remove attendees and are told how.
- `/note` on Foundry 13 keeps literal `<…>` text in plain notes.
- Everything above is covered by unit tests where the logic is pure and by e2e specs where it is UI, and the v13 stock gate stays green.

## Non-goals

- Moving sessions that sit in a plain, non-campaign folder (only folderless ones are filed; see 1b).
- Changing what the knowledge panel contains or how its sections collapse.
- Any change to GM scoping of the Hub (GMs keep All / Unfiled / New Campaign).
- Any MEJ change. The companion never patches MEJ.
- A data migration (pre-1.0 releases skip migration work).

## Anti-goals (what would make this a failure even if it "works")

- A GM is interrupted with a naming dialog when the fallback campaign is created. It must be silent.
- A pile of "New Campaign" folders accumulates from repeated fallbacks.
- The rail hides the page text on a narrow window or on the popped-out sheet.
- Spec 02's timeline tests are made green by weakening their guard instead of by the product no longer creating a world timeline.
- Readability regresses on any MEJ background (spec 29 is the floor).

## Constraints

- Foundry 13.351 and 14.368/14.369; stock MEJ 13.06 (native mode) and the fork line in api mode. The v13 stock smoke gate (`npm run e2e:stock:v13`) must pass.
- Companion CSS is scoped under `.monks-enhanced-journal` and uses the `--mej-cc-*` tokens; 4.5:1 on all 16 MEJ backgrounds in both schemes.
- Test documents are `TT-` prefixed and swept by their spec. Live e2e runs are time-boxed: run only the spec under change, never two Playwright invocations at once, `--trace off`.
- No Claude attribution in PR bodies or comments.

## Decisions

### 1. Sessions always live in a campaign

**1a. Hub "New Session" with no campaign resolved.** Today `CampaignHubPage.onNewSession` (`scripts/apps/CampaignHubPage.mjs:1274-1299`) prompts for a campaign when the scope is Unfiled/All and, when the prompt is cancelled or there are zero campaigns, creates the session unfiled. New behaviour: when no campaign is resolved, call the fallback (1c) and create the session inside it. The prompt itself stays (it lets the GM pick an existing campaign); cancelling it means "make me one", not "leave it loose". The same applies to `onStartSession` (`:1301`) when its prompt yields nothing.

**1b. Every other creation path.** Session pages can also be created unfiled from the core sidebar's New Entry dialog, MEJ's New Entry dialog, the API, or imports. A GM-side post-create hook (active GM only, like `session-timepoint.mjs`) on `createJournalEntry` / `createJournalEntryPage` detects a session page whose entry is **folderless** (`entry.folder` null) and files the entry into the fallback campaign (1c) with `entry.update({ folder, "ownership.default": <level> })` — the same move idiom `upgradeEntryToCampaign` uses (`scripts/data/campaign-store.mjs:126`). Session detection uses `storedPageType()` (MEJ rewrites the in-memory type).

- **Which entries (my call):** only folderless ones. A session the GM deliberately placed in a plain, non-campaign folder ("Archive", "One-shots") is left alone; the hook never pulls an entry out of a folder the GM chose. Multi-page entries holding a session page are filed whole.
- **Ownership level (my call, from the existing rule):** the level is the companion's session-aware level for that campaign (`campaignSessionTargetLevel` / `sessionAwareLevel`, `scripts/data/campaign-store.mjs:190`, `scripts/logic/session-ownership.mjs:77`), not the plain folder baseline — so players keep owning campaign sessions and Decision 4 holds. Explicit per-user ownership already on the entry is preserved.
- **Who files:** the active GM's client. A player-created folderless session waits until a GM client is present (see 1g).

**1c. The fallback campaign.** Name: **"New Campaign"** (localized key; English "New Campaign", matching the sidebar button). Created with `createCampaign(name, { ownershipDefault: "observer" })`, which already makes the folder, the portal entry and the campaign timeline. **Reuse rule (my call):** if a campaign folder named exactly "New Campaign" already exists at the root, reuse it instead of creating another — this is what stops the pile-up. The GM renames it later like any folder; after a rename the next fallback creates a fresh "New Campaign".

**1d. Timepoints follow the campaign.** `createSessionTimepoint` (`scripts/hooks/session-timepoint.mjs:13-15`) runs on create and resolves the timeline from `campaignOf(page)`. The filing hook must run first or re-trigger it, so that a session filed by the fallback ends with its timepoint on the fallback campaign's timeline, not on a world timeline. Builder's choice of mechanism; the requirement is the end state.

**1e. No world-level timeline.** `ensureTimelineJournal(null)` (`scripts/data/timeline-journal.mjs:83-100`) stops creating a root "Campaign Timeline"; with no campaign it returns `getTimelineJournal()` (which still reads the legacy `timelineJournalId` setting so worlds that already have one keep showing it) or null. `createSessionTimepoint` already tolerates null. The Hub's pre-adoption path (`CampaignHubPage.mjs:437`, zero campaigns) shows its empty state instead of creating a timeline.

The three other features that today call `ensureTimelineJournal(null)` and would otherwise silently do nothing in a world with no campaign — auto-capture with no target campaign (`scripts/hooks/auto-capture.mjs:113`), the Hub's "Add Timepoint" with no campaign in scope (`CampaignHubPage.mjs:1859`), and the import wizard importing with no campaign (`scripts/apps/import-wizard.mjs:684`) — use the fallback campaign (1c) instead **(my call, extending the owner's rule that a campaign is the container)**.

**1f. Existing unfiled sessions are filed too (owner's decision).** Once per GM client load, the active GM's client sweeps the world for folderless session entries and files each into the fallback campaign exactly as 1b does (same level rule, same reuse rule), so players do not lose sight of sessions when "All" disappears (Decision 2). Idempotent: a world with nothing folderless does nothing. No schema change, so this is not a dataVersion migration; it is a ready-time sweep. The changelog says so plainly: "unfiled sessions are moved into a 'New Campaign' campaign the first time a GM loads the world".

**1g. Campaign guard.** `hooks/campaign-guard.mjs` handles Campaign-typed pages only and needs no change.

**1h. Start Session is different (owner's decision).** `onStartSession` (`CampaignHubPage.mjs:1301`) keeps today's behaviour: closing its campaign prompt aborts and starts nothing. Only New Session (1a) falls back to a created campaign.

**1i. Zero-campaign warning (my call).** When the fallback runs, the existing "no campaign folder" warning from `promptCampaignChoice` is not shown; the fallback is silent as the owner asked.

### 2. Players see only their campaigns

`scopeOptionsForUser` (`scripts/logic/hub-player-view.mjs:22-25`) today always prepends `{ value: "", label: All }`. New rule for a non-GM: options are exactly the campaigns visible to them (`#visibleCampaigns()`), in the Hub's existing campaign order; no All, no Unfiled, no New Campaign. GM options are unchanged.

Default scope for a non-GM: the remembered client setting (`HUB_CAMPAIGN_SCOPE_SETTING`) if it names a campaign still visible to them, otherwise the first option; never "". The existing single-campaign "title" header mode stays. Zero visible campaigns: the header shows a short "No campaigns yet" title (my call; localized) and the Hub body shows nothing scoped. `#effectiveScopeId` maps "" and stale ids to the first visible campaign for players, not to "".

The Search tab's "search all campaigns" control (`onSearchAllCampaigns`, `CampaignHubPage.mjs:1644`) today works by setting the scope to "". For players it must instead widen only that search across their visible campaigns without changing the scope **(my call)**; for GMs it is unchanged. Unfiled content is never shown to players (there should be none after 1f; anything a GM leaves unfiled on purpose is GM-only).

### 3. Knowledge side rail

**Where.** The knowledge panel (`scripts/hooks/knowledge-ui.mjs`, mounted by `element.appendChild(panel)` at :210 on MEJ-typed and media pages, both in the shell and on the popped-out sheet) moves from a bottom strip in the sheet's flex column to a right-hand rail beside the sheet body.

**Behaviour.**
- Closed: a thin vertical tab on the sheet's right edge showing a chevron and the panel's summary count (the existing bar's counts). Page text has the full width.
- Open: the rail occupies a fixed width (my call: 300 px, clamped so the page text keeps at least 320 px; on sheets too narrow for both, the rail clamps to 40% of the sheet width) and the page text re-flows narrower. The rail scrolls internally; its `<details>` sections behave as today.
- The tab toggles the rail; it is a real `<button>`, keyboard-focusable, with `aria-expanded`. The open/closed state is stored in the existing client setting `knowledgePanelCollapsed` (closed = collapsed), so a user's choice persists across pages and reloads, as today.
- Default state: open (today's default), since the rail no longer steals height.
- The `:has(.editor-parent.editing) .mej-cc-knowledge { display:none }` rule added in PR #60 is removed; the rail stays available while editing. The `.session-details` scroll fix from PR #60 stays.

**Layout mechanism — left to the builder,** with these requirements: MEJ's own layout on pages with no panel must be byte-for-byte unaffected; the rail must work in the shell, on the popped-out sheet, and in v13 native mode; the rail must never cover the page text (push, not overlay); the rail's surface and ink follow the existing `--mej-cc-*` tokens and the dark-surface rule at `styles/campaign-companion.css:1295`. A plausible approach is wrapping MEJ's `.sheet-container` and the panel in a flex row the companion owns, inserted only when a panel mounts; another is CSS grid on the sheet root. Pick what survives MEJ's `.sheet-container { height:100%; overflow:hidden }` and `.sheet-body { height:100% }` (`monks-journal-sheet.css:40-46, 331-336`).

**Readability.** Spec 29's knowledge-panel checks (`29-readability.spec.mjs:363-369, 504-510, 552-558`) keep measuring the rail; update selectors, not thresholds.

### 4. Attendees: anyone who can edit can manage, and is told how

Revert the PR #60 gate in `templates/session.hbs:121` to `{{#if @root.editable}}` so the "Drag an Actor here" hint appears for anyone who can drop (GM or owning player). The remove control (`:116-118`) is already `editable`-gated and stays. The unit test `test/session-template-gates.test.js:8-10` is updated to assert the `editable` gate. Spec 34 test 3 becomes: an **owning** player sees the drag hint; a **non-owning** player with view access sees "No attendees recorded yet." and no Secrets block.

### 5. `/note` on Foundry 13: keep literal tag text

`chatMessageText` (`scripts/logic/note-command.mjs`) treats a message as HTML whenever any tag-like text appears. New rule: treat it as HTML only when the trimmed message **starts with** a block wrapper (`<p`, `<div`), which is what Foundry 14's chat box sends; otherwise it is plain text and returned trimmed, so `/note the <div> tag` on Foundry 13 keeps its text. Unit tests for both.

### 6. Release 0.28.0

After this lands: `module.json` version 0.28.0, CHANGELOG moves the "Unreleased" section (PR #60 fixes) plus this work under `## 0.28.0 — <date>`, PR squash-merged, annotated tag `0.28.0` pushed to trigger `release.yml`. PR #60 must be merged before or together with this; if it is still open, this branch's PR targets `fix/live-run-0.27.0` or is rebased onto main once #60 merges — the owner merges, not the agent.

## Testing

Unit (vitest, `test/*.test.js`): `scopeOptionsForUser` (player: campaigns only, no All/Unfiled/__new; GM unchanged), player default-scope resolution (remembered → first → none), fallback-campaign name/reuse rule as a pure function, filing decision (`shouldFileSession(entry)`: folderless session entries only; plain-folder sessions untouched), the filed entry's ownership level (session-aware, explicit users preserved), `ensureTimelineJournal(null)` returns the legacy world timeline or null and never creates, Start Session abort on cancel, `chatMessageText` start-of-message rule.

E2E (Foundry 14 World A unless noted):
- New spec: sessions in campaigns — Hub New Session with the prompt cancelled creates/reuses "New Campaign" and files the session there with a timepoint on that campaign's timeline; a session created via `JournalEntry.create` with no folder is filed by the GM client with the session-aware ownership level; a session created inside a plain TT- folder is NOT moved; the ready-time sweep files a pre-existing folderless TT- session on GM reload; Start Session with its prompt closed starts nothing; no root "Campaign Timeline" appears and `timelineJournalId` stays unset. Sweeps the TT- sessions and folders; deletes the "New Campaign" folder it created (only if the spec created it — World A may legitimately hold one afterwards).
- New spec: player campaign picker — a player with two visible TT- campaigns sees exactly those two options and opens on the first (or the remembered one); no All/Unfiled/New Campaign.
- New spec: knowledge rail — on a TT- person page the rail opens/closes from the tab, the text column is wider when closed, the state persists across a page reopen, the rail renders on the popped-out sheet; edit mode leaves the rail available.
- Updated: 02-hub-timeline (its world-timeline tests become campaign-timeline tests inside a TT- campaign, or are retired if 16-multi-timeline already covers them — builder's call, documented in the spec header), 14-campaigns (test 6: cancel creates "New Campaign"; tests that read `timelineJournalId`), 34 test 3, 07-knowledge and 29-readability selectors, `global-setup.mjs`'s stranded-timeline sweep (now also reclaims a `TT-`-created "New Campaign").
- v13: `npm run e2e:stock:v13` (stock gate) plus the knowledge-rail spec's native-mode subset.

## Out of scope / follow-ups

- Renaming "New Campaign" automatically from its first session's name.
- Letting a GM opt a plain folder out of being considered "unfiled" explicitly (today: any non-campaign folder already counts as deliberate).
