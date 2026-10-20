# Session page redesign — design

Date: 2026-10-19. Based on `main` @ 17f2d5d (0.28.1). Mockups from the brainstorm live in `.superpowers/brainstorm/61668-1792462429/content/` (git-ignored): `a-live-vs-ended.html`, `links-tab.html`, `attendees.html`, `details-tab.html` are the agreed direction; `layout-directions.html` shows the rejected alternatives.

## 1. Intent

The owner ran a live game on v13 with 0.28.1 and called the resulting Session page "an utter disaster". Their walk-through: created the session at the start of play, added attendees (dragging a PC from the Actor bar "did nothing visible", though they turned out to be there later), started the session, players added notes with `/notes`, ended the session without "Add notes to Recap" because they wanted to paste in a recap written elsewhere, pasted and saved the recap, then picked an image from the night to memorialize it.

What they saw, in their words:

- Space: "maybe 15% of the screen real estate usable". The image wastes vertical space and "looks odd that it's above the menu". The Start/End session row wastes vertical space. Notes can't be collapsed.
- Look: "really inconsistent with MEJ — the MEJ entity UI is a lot cleaner and intuitive." The background should "behave consistently with the core MEJ entities".
- Naming: a Notes *section* and a Notes *tab* on the same page "mean completely different things".
- Notes after the session ended "disappeared" while their timestamps and usernames stayed. (Diagnosed during the brainstorm: nothing was deleted. `endSession` never removes notes; the note text is drawn in near-black ink over the session sheet's dark surface, so only the muted metadata stayed legible.)

The job of the page, as agreed: **during play** it is where the table's quick lines (Table talk) land and the GM starts/ends the session; **afterwards** it is the keepsake — the recap, the image, who was there. The redesign makes each state use the screen for what matters in it, and makes the page look and behave like a native MEJ entry.

The redesign is scoped to the Session page. Its rules (§6) are written down so the Campaign Hub, Timeline, Media page and Prep board can follow them later; **those pages are not changed in this work**.

## 2. Goals, non-goals, anti-goals

**Goals**

- The Session page uses MEJ's chosen sheet background (parchment by default) exactly as a core MEJ entry does, with readable text everywhere, in both colour schemes and across all of MEJ's background images.
- A compact, MEJ-style header replaces the large image block, the empty title area and the standalone Start/End row.
- No two things on the page share a name.
- Table talk is prominent during a live session and folds away afterwards; it is never lost and can be added to the recap at any time.
- Text boxes the user writes in (Recap, GM Prep, My Notes) are always editable and save themselves.
- Attendees can be added from a checklist in one action; every add (dialog or drop) shows a visible result.
- The knowledge rail, renamed **Links**, takes ~22px when closed.

**Non-goals**

- The wider timepoint overhaul (the owner put timepoints in a separate, later feature). The one date change in scope is the first-start default in §4.2; otherwise the date fields keep today's behaviour and only their layout changes.
- A campaign Party roster (a list of characters belonging to the campaign). Agreed as the right model, deferred to the Campaign Hub redesign where party management belongs (§4.6).
- Restyling the Hub, Timeline, Media page, Prep board, or campaign settings.
- Restyling MEJ's own chrome (window title bar, entry tabs row, sidebar directory, search bar).

**Anti-goals** (would be a failure even if it technically works)

- Any path where a user's typed text can be lost silently: a re-render wiping an editor mid-typing, a close without a final save, a failed My Notes save with no message.
- A page that again reads differently from MEJ entries: a dark slab over parchment, oversized headings, full-width action rows.
- Reintroducing a name clash ("Notes" meaning two things), including via MEJ's own strings.
- A player seeing a note, image link, secret or GM Prep text they could not see before this change.

## 3. Constraints

- Foundry 13 minimum, 14 verified; MEJ 13.06 minimum. The v13 stock gate (`e2e:stock:v13`) must stay green.
- The Session sheet is rendered inside MEJ's shell (`SessionSheet.mjs`, `templates/session.hbs`), reusing MEJ partials (tab navigation, relationships, notes). MEJ's `sheet-detailed-header.hbs` is currently the sheet's only rename input and add-image control; the compact header must keep both functions (see the existing `mej-cc-session-header-compact` block and its value-carrier `img[data-edit="src"]`).
- Text colours must come from the existing `--mej-cc-*` ink tokens in `styles/campaign-companion.css` (the "readable ink inside MEJ's shell" block), which already map every MEJ `background-image` value in both schemes. The `29-readability` checks must cover the new markup.
- The recap editor is collaborative (`prose-mirror … collaborate`) for owners and is deliberately `toggled` today because activating a collaborative join during render raced re-renders (comment in `session.hbs`). Always-on editing must solve that race rather than reintroduce it (§4.4).
- Foundry's collaborative authority autosaves on the server every `core.editorAutosaveSecs` (default 60, clamped 30–300), and **does not save when the last editor leaves** (`pm.endSession` only clears the timer). A final client-side save is therefore required.
- MEJ's per-user notes (`flags.monks-enhanced-journal.<userId>.notes`) are written through MEJ's GM-relayed path; a player cannot save them with no GM connected (MEJ's own `CannotEditNotesWithoutGM`).
- Notes data (`data/notes-store.mjs`) already carries `sessionUuid` on every note and `ref` on reveal and media notes (`ref: { src, kind: "media" }` for Show Players; `revealNote()` for secrets/relationships, which also puts the entry in `mentions`).
- One running session per campaign (already the model: `currentSession` lives on the campaign flag). Different campaigns in one world may each have one running.

## 4. The design, as decided

### 4.1 Background and look

- The whole Session sheet sits on MEJ's background like any core MEJ entry. Remove the sheet-level dark surface; no block on the page paints its own opaque background unless a specific readability measurement requires it (then it uses `--mej-cc-surface`).
- All text uses the ink tokens. Section headings are normal heading size (MEJ's `h3` scale or smaller), not the current oversized "Notes" heading.

### 4.2 Header (design "A", MEJ-native)

One compact row above the tabs, in this order:

- **Thumbnail**, 56px, left. Shows the session image; click opens it full size (image popout, local only). With no image, a dashed "+" placeholder that opens the image picker (same flow as today's `addImage`). An owner can change or remove the image from the thumbnail (exact affordance — hover menu, right-click, or a small corner button — is the builder's choice).
- **Title**: the session name, editable in place by owners (replaces today's compact-header input).
- **Meta line** under the title: `#<session number>` · attendee chips (§4.6) · **status chip**.
- **Status chip**: `● Live · <elapsed>` (green) when this page is its campaign's running session; `Ended` when it has been started before and is not running; nothing (or `Not started`) when it was never started. Builder decides whether "never started" shows a chip.
- **Start history (new data, designer's call):** today only the campaign records the running session, so a page cannot tell "ended" from "never started". Add per-session flags `startedAt` and `endedAt` under the session's existing `flags.mej-campaign-companion.session` data, written by `startSession` / `endSession` (and the other-session end in the Start confirmation). Existing pages with no flags are classified at read time, with no migration: **ended** if they have any Table talk with their `sessionUuid` or a non-empty recap, otherwise **not started**. The page that is the campaign's `currentSession` is **live** regardless of flags.
- **In-game date default (owner's request):** when a session is started **for the first time** (no `startedAt` yet), its in-game date is set to the world date/time at that moment (`currentWorldComponents()`). Today only sessions auto-created by `startSession` get the world date; sessions made from the Hub's New Session or MEJ's Create Entry start with no date (shown with a year of 0), and promoting such a prepared page on Start leaves it empty. Designer's call: if the GM has already entered a date by hand before the first start, keep theirs. Restarting never changes the date. If no calendar is available (`currentWorldComponents()` returns null), leave the date as it is.
- **Session button** (GM only), right end of the header: `▶ Start session` / `■ End session` / `▶ Restart`.
  - Start/Restart on a page while **another** session of the same campaign is running asks once: "End <other session> and start this one?" Confirm ends the other (same as its End) and starts this one. Never two running in one campaign.
  - **End session shows no dialog.** It ends the session. The "Add notes to Recap" end-of-session prompt is removed; that action lives permanently on Table talk (§4.3).
  - Restart = start again on this same page (today's `startSession(campaign, { sessionUuid })` promotion path). Existing Table talk stays; new notes append.
- The "Tonight" strip (`hub-tonight.hbs`) is no longer rendered on the Session sheet; the header carries its state. (The Hub keeps its own strip unchanged.)

### 4.3 Recap tab and Table talk

- Tabs, in order: **Recap**, **Details** (renamed from "Session"), **Relationships**, **My Notes** (MEJ's paperclip Notes tab, relabelled).
- The Recap tab holds the recap editor (§4.4) and, below it, the **Table talk** drawer. "Table talk" is the new name for the session's notes stream (the timestamped lines players and the GM add during play, including via `/notes` and automatic reveal/media notes).
- Drawer header: `▾/▸ Table talk · <count>` plus, when collapsed, an `add to recap` link; a short hint that players can also type `/notes …` in chat.
- **Live session (this page running):** drawer open and given most of the tab's height; capture box directly under the drawer header; recap shrinks to its content (one placeholder line when empty: "No recap yet…").
- **Not running:** drawer collapsed to its one-line header by default; recap fills the tab. The user can open it; whether that choice is remembered (per user, per page, or not at all) is the builder's call.
- **Add to recap** is available whenever there is Table talk and the user can edit the recap. It appends the same draft `endSession` builds today (`recapDraft` over this session's notes) to the end of the recap. Builder decides whether it previews first; it must not be easy to append the same notes twice by accident (e.g. say "already added" or show what will be appended).
- Note rows: `time · author` muted, then text at full ink, then edit/delete icons — on the user's own notes for players, on all notes for the GM (today's `canEdit`).
- **Reveal and media notes become links** (owner-approved):
  - "Showed "<image>" to the players" — the image name opens that image in a local image popout for the clicking user only (not re-shared).
  - "Revealed a secret from <entry>" / "Revealed a relationship on <entry>" — the entry name opens that entry.
  - Only users who can already see the note see the link (audience filtering is unchanged). Notes filed before this release use their stored `ref` where present; notes with no usable `ref` stay plain text.

### 4.4 Always-editable text with autosave

Applies to **Recap**, **GM Prep** (§4.5) and **My Notes** on the Session page. (Whether My Notes on other MEJ entry types changes is out of scope; leave them as MEJ has them.)

- No quill/feather edit button and no Save button. Users with edit rights click into the text and type; users without edit rights see read-only enriched text (links work).
- The formatting toolbar appears only while the editor has focus.
- **Saving:**
  - Recap (collaborative): Foundry's server autosave covers the periodic save. In addition, save immediately on blur, on switching tabs (sheet tab or MEJ entry tab), and on closing the sheet/window.
  - GM Prep and My Notes (not collaborative): save on blur, tab switch and close, plus a periodic save while dirty (interval is the builder's call; match `core.editorAutosaveSecs` if convenient).
  - A small, quiet save-state indicator near each editor: "Saving…", "Saved", or an error.
- **No lost typing on re-render.** Live Table talk arrivals, attendee changes and status changes must not tear down an editor that has focus or unsaved content. Update the affected regions (Table talk list, header) without re-rendering the editors, or otherwise guarantee the editor survives. This also resolves the render/collaborative-join race that made the recap `toggled` today.
- **My Notes with no GM connected** (players): the editor stays usable, the indicator reads "Can't save until a GM connects", and the draft is kept locally (the module already has an input-draft mechanism, `logic/input-draft.mjs`) and saved once a GM is present. (Builder's-call item marked as such in §5.)
- My Notes keeps a visible hint at the top: "These notes can only be seen by you." (MEJ's own `MonksEnhancedJournal.OnlyViewable` string exists but renders faint; restyle or replace with a module string so it reads at full ink.)

### 4.5 Details tab

- **Session number** and **in-game date** on compact rows (fields unchanged; date behaviour unchanged).
- **Secrets & clues** (GM; players see only secrets already revealed to them, as today): collapsible section; header carries the count, `+ add` and the prep-board link; each row shows text, audience indicator, revealed state, delete.
- **GM Prep** (renamed from "GM Notes"; GM only, absent from players' context as today): collapsible section; always-editable per §4.4.
- The attendee list moves out of this tab to the header (§4.6).

### 4.6 Attendees

- Shown as small character chips (portrait + name) in the header meta line, visible from every tab. A trailing control (`+ Attendees` when empty, an edit control otherwise) opens the dialog. Who may manage attendees is unchanged (GM and session owners per 0.28.0).
- **Dialog "Who's playing tonight?":**
  - Lists **each campaign Contributor's assigned character** (`user.character`), with the player's name beside it, plus any current attendees not otherwise listed. (A real Party roster is deferred; when it exists it replaces this source.)
  - **No Contributors set** (designer's call): fall back to every non-GM user's assigned character, with a one-line note that the list comes from all players because the campaign has no Contributors. If that is also empty, show an empty state pointing to the search box.
  - **Checked state** (designer's call): when the session has **no attendees yet**, every row starts checked (owner's request). When it **already has attendees**, the dialog opens showing the current list: current attendees checked, other listed characters unchecked. Reopening never silently re-adds someone the GM removed.
  - A search box adds any other Actor (guests, NPC companions); a searched Actor is added to the list checked.
  - Confirm button states the result ("Add 3 attendees" / "Save attendees"); it sets the attendee list to the checked set (so unchecking removes).
- **Drag and drop** of an Actor adds an attendee and gives immediate visible feedback: the chip appears and a short confirmation names the actor. It works over the header and the Recap and Details tabs' non-editor areas, but **not** where an Actor drop already means something else (designer's call): MEJ's **Relationships** tab keeps making a relationship, and the **text editors** (Recap, GM Prep, My Notes) keep inserting a content link. Removing a chip asks for confirmation as today (`confirm.attendee`).
- Starting a session keeps today's behaviour of adding connected players' characters to the attendee list.

### 4.7 Links rail (renamed from "Knowledge")

- Renamed **Links** everywhere it appears (all entry types where the panel is injected today, not only Sessions).
- **Closed:** the rail collapses to a ~22px edge with a folder-style tab (rounded, protruding from the sheet's right edge, vertical text) reading `Links (<n>)`, where n = notes that mention this entry + tags + attributes + "mentioned in" entries. At n = 0 the tab reads `Links` in a fainter style. Click opens.
- **Open:** today's rail contents and behaviour; close via the tab or a `›` control. Open/closed stays a per-user client setting (`KNOWLEDGE_COLLAPSED_SETTING`).
- The "Party notes" section is renamed **Notes that mention this** (it lists notes whose mentions include this entry, from any session — e.g. a Session 9 note asking "didn't we see this in Session 5?" shows on Session 5).
- Each note row in the rail starts with its **session name as a link** to that session's page ("Session 9 · 7:19 PM · Jeff"); notes with no session show only the time.

## 5. Calls made by the designer (owner to check)

- Names: "Table talk", "My Notes", "Details", "GM Prep", "Secrets & clues", "Notes that mention this", "Links".
- Table talk open by default only while this page is live; collapsed otherwise.
- Header status chip wording and the "End <other> and start this one?" confirmation when another session is running.
- Reveal-note links (secret/relationship → entry) in addition to the owner-approved image link.
- Session-name links on rail note rows.
- My Notes with no GM: local draft + "Can't save until a GM connects", saved when a GM connects.
- Links tab shows at n = 0 in a faint style rather than hiding.
- Links rename and tab apply to all entry types the panel already appears on.
- New per-session `startedAt`/`endedAt` flags; existing pages classified from Table talk / recap without a migration.
- First start sets the in-game date to the world date only when no date was entered by hand; restart never changes it.
- Attendee dialog: all checked only when the session has no attendees yet; otherwise it shows the current list.
- Attendee dialog with no Contributors falls back to every player's assigned character.
- Actor drops on the Relationships tab and in text editors keep their existing meaning; everywhere else on the sheet they add an attendee.

## 6. Rules for later Companion pages (record only; not implemented here)

These come from the Session decisions and are the brief for redesigning the Campaign Hub, Timeline, Media page and Prep board:

1. **Follow MEJ's background.** Every page sits on MEJ's chosen background with the Companion ink tokens; no dark slabs, no text that disappears.
2. **MEJ-style header.** Small image, title, one meta line, actions as small header buttons — never a full-width action row.
3. **Modest, collapsible sections.** Normal heading size, a count, and the section's actions on its heading line.
4. **One word, one meaning** on any page.
5. **Layout follows the moment.** What matters now expands; the rest folds.
6. **Every action shows a result where the user is.**
7. **Side panels close to an edge tab.**
8. **Text boxes are always editable and save themselves.**

Recorded for the Campaign Hub redesign: a campaign **Party** roster (characters), seeded from Contributors' assigned characters, managed in campaign settings, which then feeds the attendee dialog; and the owner's note that the campaign settings UI (Contributors in particular) is unclear.

## 7. Left to the builder

- Exact spacing, sizes, icons and colours within MEJ's look and the ink tokens.
- The image change/remove affordance on the thumbnail.
- Whether "never started" shows a status chip.
- Remembering the Table talk drawer's open state, and the guard against double "add to recap".
- The periodic save interval for non-collaborative editors.
- How regions update without re-rendering editors (partial render, targeted DOM updates, or another approach), provided §4.4's no-lost-typing rule holds.
- Test coverage split between vitest and e2e, following the repo's existing pattern; the readability checks must include the new markup and the folder tab.
