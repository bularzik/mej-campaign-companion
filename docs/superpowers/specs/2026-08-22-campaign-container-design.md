# Campaign Container & Membership — Design

**Date:** 2026-08-22
**Status:** Approved in discussion; spec pending user review
**Scope:** Sub-project 1 of 4 (campaign container). Successors: (2) search
rationalization across MEJ + Companion, (3) import/export parity, (4) MEJ
open-routing/type UX coherence. Each gets its own spec.

## Problem

When campaign-record was rebuilt as mej-campaign-companion, its "group"
construct was dropped without the trade ever being surfaced as a decision.
The group flag did eight jobs at once — containment, sidebar organization,
Hub scope, search scope, timeline home, ownership baseline, import
destination, auto-link boundary. Seven were replaced with nothing; the
eighth (auto-link boundary) was rebuilt as permission math with strictly
weaker guarantees (same-name entities across campaigns are unresolvable).

The root defect: **ecosystem membership was conflated with typing.**
campaign-record's membership token was the group flag on the container,
independent of page type. The Companion's de-facto token is the MEJ type
flag on the page — which a plain text page by construction cannot carry.
Consequences observed in practice:

- docx-imported prose (created as plain unflagged text entries,
  `import-wizard.mjs` `#createPage`) is invisible to Hub index, search,
  auto-link targets, the graph, and even export (round-trip data loss).
- Every NPC/place/quest/session lands as a loose top-level journal entry;
  a 60-section import creates 60 root entries.
- The timeline collapsed from per-group to one world singleton.
- One-flip campaign-wide permission control was lost.
- Multiple campaigns per world became impossible.

**Decision (user):** restore a true campaign container supporting multiple
campaigns per world, with scoped Hub, search, and timeline.

## Decisions

| Question | Decision |
|---|---|
| Container mechanism | **Campaign = flagged Foundry journal Folder**; membership = folder ancestry (Approach 1; approaches 2 "flag-on-entry" and 3 "registry document" rejected — invisible membership, drift) |
| What is a member | **Every JournalEntry under the folder, regardless of type** — MEJ-typed, plain text, multi-page core books. Membership, not typing. |
| Multi-campaign | Yes; one Hub window with a campaign picker (per-campaign side-by-side windows deferred) |
| Timeline | Per-campaign timeline journal inside the folder; world singleton retired via adoption |
| Ownership | Baseline on the campaign flag, stamped at creation; explicit bulk apply for retro changes; hide/reveal restored |
| Migration | Non-destructive opt-in adoption dialog; plain text entries adopted manually via Unfiled scope |

## 1. Data model & membership seam

A campaign is a Foundry `Folder` (JournalEntry type) carrying flag
`mej-campaign-companion.campaign`. The folder's name is the campaign name;
the folder's id is the campaign id — no separate registry. Flag shape:

```js
flags["mej-campaign-companion"].campaign = {
  ownershipDefault: "none" | "observer" | "owner",  // §5
}
```

Room to grow (future keys added under the same object; versioned via the
`dataVersion` world setting, §6).

- Created from the Hub ("New Campaign", GM-only) or the import wizard
  ("New Campaign…"). Deleting the folder (contents kept) un-campaigns the
  entries — Foundry moves them to root; nothing is destroyed.
- **Membership = folder ancestry.** An entry belongs to campaign C iff its
  folder chain reaches C's flagged folder. Subfolders inside a campaign are
  supported and are pure user organization. Campaign folders may not nest:
  creation UI prevents it; resolution defensively takes the nearest flagged
  ancestor.
- The campaign's timeline journal (§3) is excluded from member listings via
  its existing `timeline` flag.

Seam API — `scripts/logic/campaigns.mjs` (pure logic + thin Foundry glue),
the single module all other subsystems consume:

```js
isCampaignFolder(folder)
getCampaigns()                       // -> Folder[]
campaignOf(entryOrPage)              // ancestry walk -> Folder | null
campaignEntries(campaign, { user })  // visibility-filtered members
unfiledEntries({ user })             // relevant entries under no campaign
```

No new eventing: moving an entry between folders fires
`updateJournalEntry` with `changes.folder`; existing hook infrastructure
(search index, backlinks) adds a listener for it.

Non-goals: non-journal documents (actors, scenes) as members; per-campaign
Hub windows; a `campaign:` query-grammar token (both deferrable without
rework).

## 2. Hub scoping

Hub header gains a campaign picker: **All campaigns | ‹each campaign› |
Unfiled** (Unfiled shown only when non-empty) + "New Campaign". The choice
persists per-client. Single Hub window; the module-level `HUB_STATE`
singleton assumption is preserved.

Per pane:

- **Index** — rows from `campaignEntries()`. Plain text member entries
  appear as a new "Journal" row type (book icon) with a matching type-filter
  chip — campaign-record's `journal` rows restored. In All mode rows carry a
  campaign badge.
- **Timeline** — the scoped campaign's timeline. All mode stacks per-campaign
  timelines, never interleaved (campaign-record's rule, kept).
- **Search** — scoped to the picker, with the spillover affordance: "N more
  matches in other campaigns" as a one-click switch to All. (Index/search
  *content* changes — indexing text pages, page-keying — belong to
  sub-project 2; this spec only defines the membership seam they consume.)
- **Dashboards / Secrets** — scoped by the picker.
- **Unfiled** — doubles as the adoption workspace (§6): per-row "file into
  campaign…" plus "File all shown into…".

Index listing keeps its LIMITED visibility gate; the LIMITED-vs-OBSERVER
inconsistency with search is resolved in sub-project 2.

## 3. Per-campaign timeline

- The `timelineJournalId` world setting is retired (cleared by adoption, §6).
- `ensureTimelineJournal(campaign)` lazily creates a "Campaign Timeline"
  journal **inside the campaign folder**, same `timeline` flag and timepoint
  machinery as today; created with `ownership.default = OBSERVER`.
- The Timepoints API already operates on a journal document — callers
  resolve it via the campaign instead of the world setting.
- **Attachment discipline restored:** an entry may only attach to timepoints
  of its own campaign (campaign-record declared this rule but its
  enforcement had gone dead; enforce it for real). Unfiled entries cannot
  attach — filing into a campaign is the prerequisite.

## 4. Creation, import, and auto-capture destinations

- **Hub creations** (New Session, new entry): created into the scoped
  campaign's folder. In All/Unfiled scope, the create dialog includes a
  campaign select rather than guessing.
- **Import** regains "Import into": a select of campaigns + "New Campaign…",
  alongside the existing Audience select (destination and permission are
  orthogonal). Audience gains a default option "Campaign default" (§5
  baseline), with GM-only / All players as explicit overrides. A "Create
  subfolder ‹document title›" checkbox (default on) keeps large imports from
  flooding the folder root — subfolder members are members by ancestry.
  Import timepoints go to the chosen campaign's timeline. Imported prose is
  a member the moment it is created — the orphan defect fixed at the root.
- **Auto-capture** target restored: a world setting + Hub control naming the
  auto-capture campaign. Captures file into it and its timeline. Unset →
  capture declines with a nameable message ("No campaign set to receive
  captures — choose one in the Hub"); never a silent loose entry.
- **MEJ-side / core creations: no changes.** Foundry's create dialogs
  already offer folder placement; anything created inside a campaign folder
  is a member automatically. Loose creations surface in Unfiled.

## 5. Ownership baseline & bulk apply

- `ownershipDefault`: **GM only / Players observe / Players edit**, chosen in
  the New Campaign dialog (default: Players observe).
- Every Companion creation path (Hub, import unless Audience overrides,
  auto-capture) stamps new entries with the baseline.
- Folders don't confer ownership, so retro changes are explicit: campaign
  action **"Apply permissions to all members"** batch-updates
  `ownership.default` across members (confirmation with count). Only the
  default level is touched — per-user overrides live under separate keys and
  are preserved. Editing the baseline offers to run the bulk apply.
- `playersWriteSessions` unchanged: force-upgrades Session entries to OWNER;
  composes with any baseline as a pure escalation.
- **Hide/reveal restored:** GM-only per-row toggle in the Hub index. Hide
  sets `ownership.default = NONE`; reveal restores the campaign baseline
  (campaign-record's semantics — meaningful again now that a campaign exists
  to define "restore").

## 6. Adoption & migration

Non-destructive, opt-in:

- On first Hub open by a GM in a world with **zero campaigns** but existing
  Companion content (MEJ-typed entries or a timeline journal), a one-time
  dialog offers **"Create a campaign from this world's content"**: name
  (default: world title) + baseline select. It creates the folder,
  batch-moves all MEJ-typed entries in, moves the singleton timeline journal
  in as the campaign's timeline, and clears `timelineJournalId`.
- Declining leaves everything functional under All/Unfiled; setup remains
  reachable from the Hub.
- **Plain text entries are not auto-adopted** (worlds contain module
  journals, rules references, etc.). They surface in Unfiled, with per-row
  "file into campaign…" and "File all shown into…" (respects the current
  name/type filter) for bulk adoption.
- The adoption planner is a pure function returning the move list (dialog is
  a thin consumer; unit-testable without Foundry).
- New world setting `dataVersion` introduced now, giving this and future
  schema changes a versioned migration hook (campaign-record had a migration
  runner; the Companion currently has none).

## 7. Testing

- **Unit** (existing setup; pure logic per repo convention):
  `campaigns.mjs` membership (ancestry, nearest-flagged-ancestor, nesting
  prevention), unfiled computation, ownership-baseline application, adoption
  planner.
- **E2E** (existing Playwright harness): campaign creation; picker scoping
  of Index/Timeline/Search; import-into-campaign incl. subfolder; adoption
  dialog on a seeded legacy world (loose entries + singleton timeline);
  Unfiled filing incl. "file all shown"; bulk permission apply verified from
  a **player** seat; timepoint attachment refusing cross-campaign drops.
- Existing suites (notably search e2e) updated for scoped expectations, not
  replaced.

## Provenance

Findings that motivated this design (investigated 2026-08-22): the group
construct's eight roles and their fates; the import wizard's unflagged text
entries (`import-wizard.mjs` "the companion has no such container");
`live-index.mjs` skipping non-MEJ-typed pages; the migration spec's silence
on dropping groups. See the discussion record in the session that produced
this spec.
