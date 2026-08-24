# Multiple Named Timelines — Design

**Date:** 2026-08-24
**Status:** Design approved in discussion; spec pending user review
**Scope:** Sub-project D of the type-system/UI rationalization round
(A import type-list cleanup — 0.8.0; B Hub chrome + Graph tab — 0.9.0;
C campaign portal — 0.10.0; E PDF/video shell routing still floating).

## Problem

A campaign has exactly one timeline: `campaignTimelineJournal()` takes the
first timeline-flagged entry in the campaign folder and
`ensureTimelineJournal()` creates precisely that one. A GM who wants to
keep world history separate from session events has nowhere to put it, and
a timeline that belongs to no campaign (shared lore, a world chronology)
cannot exist as a first-class thing at all.

The data model is already closer than the UI suggests: the Timepoints API
(`data/timepoints.mjs`) operates on *a* journal document holding the
timeline flag, so N timelines is a resolution-and-surface problem, not a
rewrite.

## Decisions

| Question | Decision |
|---|---|
| Timeline identity | Unchanged: any JournalEntry carrying `flags[MODULE_ID].timeline`. **The journal's name is the timeline's name.** No new document type, no new flag shape. |
| Multiple per campaign | Yes — any number of timeline journals may live in one campaign folder. |
| Campaign-less timelines | **World timelines** (user-selected): a timeline journal outside any campaign folder. No dedicated container, no new scope. Surfaced in the Hub's **All** scope. |
| Default target | **Each campaign designates one default timeline** (user-selected), pointed to by `campaign.defaultTimelineId` on the existing campaign flag. Unset/stale falls back to the oldest timeline in the folder. |
| Auto-filing | Always the campaign's default timeline — combat capture, docx import timepoints, Show-Players media. **No prompts during play.** The auto-capture *campaign* setting is untouched (it names the campaign; the campaign names its timeline). |
| Attachment discipline | Unchanged in shape: a campaign's timeline accepts that campaign's members; a **world timeline accepts anything** (the existing null-campaign branch of `canAttachToTimeline`). Deliberate — world history references any campaign. |
| Hub surface | A **timeline picker** atop the Timeline pane; All scope stacks each campaign's default plus every world timeline (never interleaved); Unfiled stays empty. |
| Management | GM-only, in the Timeline pane toolbar: Rename, Make default, Delete (confirm names the timepoint count). Creation via the picker's "➕ New timeline…" action-as-option with cancel-revert. |
| Migration | **None.** Existing campaigns have one timeline; the default-fallback makes it the default with zero writes. The legacy pre-adoption singleton keeps resolving via its world setting. `dataVersion` stays 2. |

## 1. Data model & resolution

`flags[MODULE_ID].campaign` gains one optional key:

```js
campaign = { ownershipDefault, defaultTimelineId }   // defaultTimelineId: string|undefined
```

Pure planner (`scripts/logic/timelines.mjs`, vitest-loadable, doc-shaped
inputs — same convention as `campaigns.mjs`):

- `orderTimelines(timelines, defaultId) -> Timeline[]` — the default first,
  then the rest name-sorted (locale compare).
- `resolveDefaultTimelineId(timelines, flagId) -> string|null` — `flagId`
  when it names one of `timelines`; else **the first element of
  `timelines` as given** (the glue passes them in Foundry collection
  order, i.e. creation order, so a legacy campaign's sole timeline is
  always its default); else null. The planner never re-sorts to decide
  the fallback — ordering for display is `orderTimelines`' job.
- `partitionTimelines(entries, campaignIdOf) -> { byCampaign: Map, world: [] }`
  — separates timeline journals by owning campaign; those with no campaign
  are world timelines.

Foundry glue (`scripts/data/timeline-journal.mjs`, replacing the
singleton-shaped helpers, keeping their names where callers depend on them):

- `campaignTimelines(campaign, { user }) -> JournalEntry[]` — visibility-
  filtered timeline journals in that folder, ordered by `orderTimelines`.
- `worldTimelines({ user }) -> JournalEntry[]` — visibility-filtered
  timeline journals under no campaign folder, name-sorted.
- `defaultTimeline(campaign) -> JournalEntry|null` — via
  `resolveDefaultTimelineId`.
- `createTimeline({ campaign = null, name }) -> JournalEntry` — GM-only;
  creates a timeline-flagged journal in the campaign folder (ownership =
  campaign baseline) or at root for a world timeline (Foundry default
  ownership). Never touches `defaultTimelineId` — the fallback covers the
  first one, and later ones are made default explicitly.
- `setDefaultTimeline(campaign, timelineId)` — GM-only; writes the flag.
- `resolveTimelineJournal(campaign)` keeps its name and now returns the
  **default** timeline; `ensureTimelineJournal(campaign)` keeps its
  contract (ensure at least one exists, return it).

Timeline journals stay excluded from Hub index rows, member listings, and
export exactly as today; campaign portals are unaffected.

## 2. Filing & attachment

- `hooks/auto-capture.mjs`, `apps/import-wizard.mjs`, and the Show-Players
  media path resolve `defaultTimeline(campaign)` (via
  `ensureTimelineJournal` where creation-on-demand is wanted) instead of
  the campaign's sole timeline. No call sites gain prompts.
- `canAttachToTimeline(entry, timelineJournal)` (logic/campaigns.mjs) is
  unchanged: `campaignIdOf(timelineJournal) === null` → accept (world
  timeline, and the legacy singleton); otherwise require the entry's
  campaign to match. Adding timelines to a campaign therefore cannot
  loosen or tighten cross-campaign discipline.

## 3. Hub surface

- **Picker** at the top of the Timeline pane: the scoped campaign's
  timelines (default marked with a leading "★"), a separator, world
  timelines, then GM-only "➕ New timeline…" (action-as-option: revert the
  visible selection, open a name prompt, create, then select the new one;
  cancel leaves the previous selection — the same idiom the campaign
  picker uses for New Campaign…). Selection persists per client in a new
  client setting `HUB_TIMELINE_SELECTION_SETTING` (`"hubTimelineSelection"`,
  scope `"client"`, default `""` = the scope's default/stacked view),
  mirroring `HUB_CAMPAIGN_SCOPE_SETTING`. A stale id (timeline deleted or
  no longer visible) resets to `""`, exactly as a stale campaign scope
  does.
- **All scope**: stacks each campaign's default timeline plus every world
  timeline, each stack labeled `campaign — timeline` (world stacks labeled
  by timeline name alone). Never interleaved (campaign-record's rule,
  kept). Choosing a specific timeline in the picker narrows to it.
- **Unfiled scope**: empty, as today.
- **Management toolbar** (GM-only, beside the picker): *Rename* (renames
  the journal; picker follows), *Make default* (hidden when the selection
  is already default or is a world timeline), *Delete timeline* (confirm
  states the timepoint count; deletes the journal).
- Player seats see the picker with only the timelines they can observe,
  and no management controls.

## 4. Non-goals

- No per-timeline permissions beyond ordinary journal ownership.
- No moving or merging timepoints between timelines (curate by hand with
  the existing add/remove link controls).
- No per-timeline auto-capture overrides (one default per campaign).
- No world-timeline container/scope; no changes to campaigns, portals,
  the Graph tab, or MEJ itself.

## 5. Testing

- **Unit** (vitest): `orderTimelines` (default first, name-sorted rest,
  missing default); `resolveDefaultTimelineId` (valid flag, stale flag,
  absent flag, empty list); `partitionTimelines` (campaign grouping, world
  bucket, non-timeline entries ignored).
- **E2E** (Playwright, `--trace off`, TT- fixtures, id-tracked cleanup,
  World A restored, scope + timeline selection reset):
  - Create a second timeline in a campaign; the picker switches panes and
    each shows its own timepoints.
  - Auto-capture (or an import timepoint) lands on the **default**, not on
    the currently-viewed second timeline.
  - "Make default" on the second timeline changes where the next filing
    lands.
  - A world timeline appears in All scope and accepts a link from a
    campaign entry (the same drop a campaign timeline refuses
    cross-campaign).
  - Rename and delete (confirm names the timepoint count).
  - Player seat: picker lists only observable timelines; no management
    controls.
  - Existing timeline coverage (02-hub-timeline, 14-campaigns) updated for
    the picker — updated, not weakened.
