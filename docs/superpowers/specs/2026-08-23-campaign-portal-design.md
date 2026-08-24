# Campaign Portal (Campaign as an Openable Entity) — Design

**Date:** 2026-08-23
**Status:** Design approved in discussion; spec pending user review
**Scope:** Sub-project C of the 2026-08-23 type-system/UI rationalization
round (A import type-list cleanup — 0.8.0; B Hub chrome + Graph tab —
0.9.0; D multiple named timelines and E PDF/video shell routing follow,
each with its own spec).

## Problem

A campaign is a flagged Folder (campaign-container spec, 0.6.0) — correct
as the membership container, but nothing about it is *openable*: no entity
appears in journal lists or search, nothing links to a campaign, and "go
to my campaign" means opening the Hub and working the picker. The user's
original diagnosis stands: "we may be missing the Campaign entity type."

## Decisions

| Question | Decision |
|---|---|
| What is openable | **Both** (user-selected): a campaign *portal* entity inside each campaign folder AND an "Open Campaign Hub" folder context-menu entry. |
| Entity mechanism | **Approach 1 (user-approved): native subtype portal** — a JournalEntry at the campaign folder root, named after the campaign, with one page of native type `mej-campaign-companion.campaign` + the MEJ interop flag (`flags["monks-enhanced-journal"].type = "campaign"`) — the proven Session pattern. Approach 2 (flag-only + open-interception hooks) rejected: interception routing is the fragile pattern behind the original "opens outside MEJ" complaints. |
| What opening does | The portal's registered **sheet IS the Hub**: `CampaignHubPage` mapped to the subtype, with a shim that, when the mounted document is a campaign portal, sets the Hub scope from `campaignOf(portal)` (persisting the client scope setting, same as the picker) before context prep. Works in api mode (shell) and native mode (hub window) alike. |
| Source of truth | **The folder, unchanged.** The portal is a view/handle, never the campaign itself. |
| Create | `createCampaign()` creates folder + portal together. |
| Rename | Two-way sync via update hooks: folder rename → portal rename, portal rename → folder rename, loop-guarded (skip when names already equal; pure rename-sync planner decides writes). |
| Delete portal | Deletes only the portal. The campaign settings (edit) dialog gains **"Restore campaign entry"**; migration/adoption also recreates missing portals. |
| Delete campaign | Still and only: delete the folder (portal dies with the folder's contents handling, as today). |
| Migration | `dataVersion` **2**: on ready, active GM, idempotent — every campaign folder lacking a portal gets one. |
| Ownership | Portal stamped with the campaign baseline at creation; thereafter a normal member for bulk-apply/hide purposes. |
| Hub index | Portals are **excluded** from Hub index rows and Unfiled/All listings (like the timeline journal — the picker already lists campaigns). |
| Ecosystem | Everywhere else, first-class via MEJ typing: Foundry sidebar + search, companion search (name hit opens the campaign), auto-link candidacy (typing a campaign name links to its portal). |
| Type label/icon | "Campaign" label via the companion's label path (same as Session); icon `fa-solid fa-flag`. |
| Import wizard | Does NOT gain a "campaign" type (portals are not importable content). |
| Folder context menu | "Open Campaign Hub" on campaign folders in the journal sidebar; scope-set + `openHub()`. The exact v13/v14 hook/wrap surface is pinned at plan time (MEJ's own folder-context wrapper at `monks-enhanced-journal.js:1827` shows the surface). Companion-side only — MEJ stays unpatched. |

## 1. Data model & lifecycle

- `scripts/logic/campaign-portal-data.mjs` (pure, vitest-loadable, beside
  `session-page-data.mjs`): `buildCampaignPortalData(name)` returning the
  page payload (native subtype + MEJ interop flag + icon-relevant bits),
  and `renameSyncPlan({ folderName, portalName, changedSide })` returning
  the write (or none) that reconciles names without loops.
- `scripts/data/campaign-store.mjs`:
  - `createCampaign()` additionally creates the portal (`JournalEntry` in
    the new folder, ownership = baseline, page via
    `buildCampaignPortalData`).
  - `campaignPortal(campaign) -> JournalEntry|null` (find by subtype among
    `campaign.contents`), `ensureCampaignPortal(campaign)` (create when
    missing; used by createCampaign, the restore control, and migration).
- Membership listings: `campaignEntries`/`unfiledEntries` exclude portal
  entries the same way they exclude the timeline journal (a
  `isCampaignPortal(entry)` predicate in `logic/campaigns.mjs`).
- Rename sync: `updateFolder` / `updateJournalEntry` hooks call the pure
  planner and apply at most one write; equal names produce no write
  (loop guard). GM-side only (players can't rename either object anyway).
- Migration: `CURRENT_DATA_VERSION` bumps to 2; the versioned hook in
  `campaign-companion.mjs` runs `ensureCampaignPortal` over
  `getCampaigns()` before recording the new version.

## 2. Routing

- Sheet registration (api-mode wiring, same place Session's sheet is
  registered): the campaign subtype maps to `CampaignHubPage`.
- `CampaignHubPage` shim: when `this.document` is a real
  JournalEntryPage of the campaign subtype (not the shell's synthetic
  hub page or the native window's synthetic document), then before body
  context prep set `HUB_STATE.campaignId = campaignOf(this.document).id`
  and persist `HUB_CAMPAIGN_SCOPE_SETTING` — once per mount, not per
  render (a mount marker on state; the user can still re-scope with the
  picker afterwards without the portal fighting them).
- Native mode: opening the portal from the sidebar goes through the core
  sheet dispatch to the same class via the registered mapping; the
  existing `hub-window` path is unaffected.
- Folder context menu: companion-registered entry "Open Campaign Hub",
  shown only for campaign folders (isCampaignFolder), any seat that can
  see the folder; performs scope-set + `openHub()`.
- MEJ shell affordances (recents, bookmarks, back/forward) treat the
  portal like any typed entry — no special-casing.

## 3. Non-goals

- No per-campaign Hub windows; the single-Hub model stands.
- No campaign metadata content on the portal page (description, banner,
  landing text) — room to grow in a later round; the page's text stays
  empty.
- No changes to timelines (sub-project D) or to MEJ itself (standing
  rule).
- Import/export: portals are neither imported nor exported; the doc
  exporter's eligibility filter must exclude the campaign subtype the
  same way it excludes the timeline journal.

## 4. Testing

- **Unit** (vitest): `buildCampaignPortalData` payload shape;
  `renameSyncPlan` (folder-changed, portal-changed, equal-names no-op,
  loop safety); `isCampaignPortal`; membership exclusion (portal not in
  campaignEntries/unfiledEntries); migration planner (campaigns lacking
  portals → creation list, idempotent second run empty).
- **E2E** (Playwright, `--trace off`, TT- fixtures, id-tracked cleanup,
  World A restored):
  - Create campaign → portal exists in the folder with baseline
    ownership; opening the portal lands on the Hub scoped to that
    campaign (scope select shows it).
  - Rename folder → portal follows; rename portal → folder follows.
  - Delete portal → campaign works; "Restore campaign entry" recreates
    it.
  - Folder context menu "Open Campaign Hub" → scoped Hub.
  - Player seat: portal visible per baseline, opening it yields the
    scoped read view; no restore control.
  - Portals absent from Hub index rows in every scope.
  - Migration: a campaign folder seeded WITHOUT a portal gains one after
    reload/ready path runs (or via directly invoking the migration).
  - Existing suites (14-campaigns et al.) updated where fixtures/cleanup
    now see portals created alongside campaigns — updated, not weakened.
