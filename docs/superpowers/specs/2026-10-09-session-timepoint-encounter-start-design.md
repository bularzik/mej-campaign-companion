# Session timepoints & encounter capture at combat start — design

Date: 2026-10-09 · Status: approved in chat 2026-10-09 · Repo: mej-campaign-companion

## Problem

1. **Timepoints are hard to create.** The Hub Timeline tab's *Add Timepoint* button
   (`templates/hub.hbs`) renders only when the scope already has a timeline journal
   (`hasJournal`) and the user can edit. In a scope with no timeline the GM sees
   "No timeline in this scope." and no way to add one. Creating a Session never touches
   the timeline, so a fresh campaign has no timepoints until the GM adds them by hand.
2. **Encounter capture is late, off by default, and lossy.** `hooks/auto-capture.mjs`
   creates the Encounter only on `deleteCombat` (combat end), behind
   `autoCaptureEncounters` (default `false`). The entry is filed onto the timeline's
   newest timepoint; with no timepoints `fileOntoNewestTimepoint` returns after a
   `console.debug`, so the Encounter exists but is never filed.

## Goals

- G1. The GM can always add a timepoint from the Hub, even when the scope has no timeline yet.
- G2. Creating a Session page creates a timepoint carrying the session's name and campaign
  date/time, with the session attached as a link.
- G3. An Encounter entry is created when combat **starts** and finished (roster + outcome)
  when it ends.
- G4. `autoCaptureEncounters` defaults to `true`.
- G5. A capture is never silently dropped for lack of a timepoint.

Non-goals: real-world creation time as the stamp; retro-creating timepoints for existing
sessions; changing `autoCaptureSharedMedia`; changing MEJ itself (companion-side only).

## Design

### 1. Add Timepoint always available (G1)

- `hub.hbs`: render the *Add Timepoint* button for any stack/scope where the user is GM,
  including the "no timeline in this scope" state.
- `CampaignHubPage.onAddTimepoint`: when the target has no `data-journal-id`, resolve the
  scope's campaign (or world) and call `ensureTimelineJournal(campaign)` first, then run the
  existing dialog. Non-GM behaviour unchanged (no button, handler returns).
- The order buttons stay hidden in the empty state; only the add button is new there.

### 2. Session → timepoint (G2)

New hook module `hooks/session-timepoint.mjs` + pure logic `logic/session-timepoint.mjs`.

- **Trigger:** `createJournalEntryPage` for pages of type `SESSION_DOCUMENT_TYPE`.
  Single writer: `game.user === game.users.activeGM` (the hook fires on every client).
- **Skip:** pages created by the docx import wizard (it already creates dated timepoints);
  the wizard passes a creation option / flag `skipSessionTimepoint` that the hook honours.
  Also skip when the page already has `flags[MODULE_ID].session.timepointId` (duplicate
  entry / re-fire).
- **Target timeline:** the session entry's campaign default timeline
  (`ensureTimelineJournal(campaign)`; world timeline when the entry is in no campaign).
- **Stamp:** label = page name; `campaignDate` = the session's `campaignDate` flag. If the
  session has none (new sessions have none), use `currentWorldComponents()` and **write that
  date into the session's flag** so the two match.
- **Attach:** `addLink(journal, tp.id, { uuid: page.uuid, name: page.name, type: "JournalEntryPage" })`.
- **Link back:** store `timepointId` (and the timeline journal id) on the session flag
  (`flags[MODULE_ID].session`).
- All timeline writes go through `queueFiling()` like every other timeline mutation.
- **Sync:** on `updateJournalEntryPage` for a session page that has `timepointId`, when the
  name or `campaignDate` changed, `editTimepoint` the linked timepoint (label, campaignDate)
  and update the link chip name. If the timepoint no longer exists, do nothing (never
  recreate). GM single-writer as above.

### 3. Encounter at combat start (G3, G4)

- Register `Hooks.on("combatStart", …)`. It fires only on the client that began combat, so
  no GM election; require `game.user.isGM` and the `autoCaptureEncounters` setting.
- `createEncounter` runs at start with the roster at that moment; the new page's uuid is
  saved in a **Combat flag** (`ENCOUNTER_PAGE_FLAG`, constants.mjs). The Combat document is
  alive at start, so the flag write succeeds; it replaces the in-memory
  `encounterPagesByCombatId` map and survives reloads.
- `deleteCombat` (activeGM election retained, broadcast hook): read the page uuid from the
  combat's flag (data is still on the deleted document). If found → `mergeEncounter` with the
  final roster + outcome (GM-authored text preserved via the existing outcome marker). If not
  found (combat began before upgrade, or the setting was enabled mid-fight) → today's
  create-at-end path.
- `DEPARTED_FLAG` tracking is unchanged.
- Setting `autoCaptureEncounters`: `default: true`. Worlds that never saved the value flip
  to on; documented in CHANGELOG and the GM guide.

### 4. Filing never drops (G5)

`fileOntoNewestTimepoint`: when the target timeline has no timepoints, create one
(label from the current world date, `campaignDate = currentWorldComponents()`) and file
onto it. Applies to Encounter and shared-media captures. The "no timeline journal" debug
skip and the campaign-decline rule are unchanged.

## Errors / edge cases

- No timeline can be resolved/created: log with `console.warn`, skip; the session still saves.
- Session created by a non-GM (players may write sessions): the activeGM client performs
  the timepoint write; a player's own client does nothing.
- Hook failures are caught and logged; they never block page creation or combat.
- Concurrent writes serialize through `queueFiling()`.

## Testing

Unit (vitest, pure logic): session→timepoint payload (name/date fallback, flag shape),
skip rules, sync diff (name/date changed vs not), combat flag read/merge decision,
filing fallback label/date. Update `auto-capture` unit tests for the new default.

E2E (Playwright, v13 + v14, TT- prefix): extend `04-auto-capture` (start creates Encounter
with roster; end merges; no-timepoint timeline gets one); new spec for session→timepoint
(create, rename/date-edit sync, import skips, empty-scope Add Timepoint creates timeline).

## Docs

CHANGELOG entry; GM guide: Add Timepoint availability, session timepoints, encounter
capture timing and new default.
