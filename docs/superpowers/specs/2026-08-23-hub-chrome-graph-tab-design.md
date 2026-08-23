# Hub Chrome & Graph Tab — Design

**Date:** 2026-08-23
**Status:** Design approved in discussion; spec pending user review
**Scope:** Sub-project B of the 2026-08-23 type-system/UI rationalization
round (A import type-list cleanup — shipped 0.8.0; C campaign-as-entity;
D multiple named timelines; E PDF/video shell routing, floating). B covers
the Hub's chrome (header bar, Tools menu, Index toolbar cleanup) and the
relationship graph's move into a scoped Hub tab.

## Problem

Every companion control — campaign picker, New Campaign, New Session,
Graph, Help, Auto-capture target, Import, Export, plus the index-only
filter/sort/file-all controls — lives on the Index subtab's toolbar
(hub.hbs, inside the `data-tab="index"` pane). Consequences the user
called out: global actions are buried one tab deep, unordered, and a mix
of icon-only and labeled buttons; the relationship graph is a separate
popup window that ignores the Hub's campaign picker entirely
(graph-app.mjs's `graphRows()` walks all of `game.journal`).

## Decisions

| Question | Decision |
|---|---|
| Header layout | **Primary + Tools menu**: a bar ABOVE the tab nav — campaign picker (+ edit pencil), New Session, Tools ▾. Icon + label on every control, one visual weight. |
| New Campaign placement | **Inside the campaign picker** as its last option "➕ New Campaign…" (same idiom as the import destination select). It is an action-as-option: cancel must revert the picker to the previous scope; success switches scope to the new campaign. No header button. |
| Campaign settings | **Pencil only** (beside the picker, acting on the scoped campaign). NOT duplicated in Tools. |
| Tools menu contents & order | **Import Document…, Export…, Auto-capture target…, User Guide** — bring-in/out pair first, configuration, help last. GM-only items hidden for players (Import, Export, Auto-capture are GM-gated as today; players see User Guide). |
| Graph surface | **A Hub tab**, not a popup. Tab order: **Index \| Timeline \| Graph \| Search \| Dashboards \| Secrets**. The standalone `RelationshipGraphApp` popup is retired (file deleted). |
| Graph scoping | The pane feeds `buildGraph` from the Hub's scoped entries (same seam as every pane): campaign → members only; All → whole world (today's behavior); Unfiled → unfiled entries. Out-of-scope relationship targets are **clipped** (no ghost nodes) — All shows the full web. |
| Graph entry points | Hub's old Graph button removed (the tab replaces it). The entity-header graph button opens the Hub → Graph tab, ego-centered on that entity; if the entity belongs to a campaign, scope switches to that campaign first. Node click re-centers (existing behavior preserved). |
| Index toolbar | Keeps ONLY index-scoped controls: type-filter menu, sort menu, "File all shown…". Adoption banner stays on the Index pane (content, not chrome). |
| New Session semantics | Unchanged (scoped campaign, or prompt with cancel-to-stay-loose in All/Unfiled). |

## 1. Header bar & Tools menu

New partial `templates/hub-header.hbs`, included in `hub.hbs` above the
`tab-navigation.hbs` partial (so sub-project C can reuse the bar as the
campaign sheet's header without rework). Contents, left to right:

- **Campaign picker** (`select[name="campaign-scope"]`, moved up from the
  Index toolbar with its existing options: All campaigns, each campaign,
  Unfiled-when-nonempty) plus, GM-only, a trailing option
  `value="__new"` labeled "➕ New Campaign…". The change handler routes
  `__new` to the existing New Campaign dialog; on cancel it re-renders
  with the prior `campaignId` (state is never written until the dialog
  resolves); on success it sets scope to the created campaign (existing
  `onNewCampaign` behavior).
- **Edit pencil** (existing `editCampaign` action) beside the picker,
  visible to GMs when the scope is a single campaign — the one home for
  campaign settings.
- **+ New Session** (existing `newSession` action), icon + label.
- Spacer, then right-aligned **Tools ▾** opening a dropdown (same
  open/close pattern as the Index type-filter and sort menus: a summary
  button + absolutely-positioned menu, closed on outside click). Items,
  each icon + label: Import Document… (`openImportWizard`, GM), Export…
  (`openExportDialog`, GM), Auto-capture target… (`setCaptureCampaign`,
  GM), User Guide (`openHelp`, all seats). A player's menu shows only
  User Guide.

The bar renders for every seat; GM-only controls are template-gated with
the existing `isGM` context flag, exactly as the current toolbar gates
them. All moved buttons are DELETED from the Index toolbar (not hidden).
Existing action handlers are reused unchanged — this section is chrome
relocation, not behavior change, except the picker's `__new` option.

## 2. Graph tab

- `subtabs` gains `graph` (label: existing graph title string) between
  `timeline` and `search`; `hub.hbs` gains the corresponding
  `data-tab="graph"` pane.
- Pane structure: a toolbar (mode chips All/Ego — Ego shown only when a
  center is set, matching the popup's current conditional; the existing
  "Show mention links" backlinks toggle) above an SVG container filling
  the pane.
- Rendering: the popup's d3-force simulation + SVG draw code moves to
  `scripts/apps/hub-graph-pane.mjs` (exports a `prepareGraphContext` /
  `drawGraphPane(paneEl, state)` pair the Hub calls from its render
  path); `logic/graph-data.mjs` (`buildGraph`) is untouched.
  `scripts/apps/graph-app.mjs` is deleted. The pane draws on tab
  activation and re-draws on Hub render while active (the Hub already
  re-renders on scope change, which is what re-scopes the graph).
- **Scoping**: node rows come from the Hub's scoped entries — the same
  `campaignEntries`/`unfiledEntries` seam other panes use — via a pure
  row builder that takes the entry list (unit-testable). Campaign scope
  shows members only; All shows everything (parity with today's popup);
  Unfiled shows unfiled entries. Edges whose far end is out of scope are
  dropped with the missing node (buildGraph already drops edges lacking
  endpoints — verified behavior to assert in unit tests, not new code).
- Graph state (`mode`, `centerUuid`, `includeBacklinks`) lives in the
  module-level HUB_STATE alongside the other pane states, so it survives
  re-renders and tab switches within a session.
- **Entry points**: the Hub `openGraph` action and its Index-toolbar
  button are removed. The entity-header button
  (campaign-companion.mjs:152) now: opens/focuses the Hub, sets scope to
  the entity's campaign when it has one (via `campaignIdOf`), sets
  `centerUuid` + ego mode, and activates the Graph tab. Node click
  re-centers within the pane (existing popup behavior).

## 3. Non-goals

- No graph feature changes (layout algorithm, node styling, max-node cap
  stay as-is).
- No changes to Dashboards/Secrets/Search panes beyond selector updates
  forced by the moved chrome.
- Prep-board's per-session mini-graph (prep-board-app.mjs) is untouched —
  it is a separate surface and never used RelationshipGraphApp.
- Campaign-sheet integration (opening a campaign renders the Hub) is
  sub-project C; this spec only positions the header partial for it.

## 4. Testing

- **Unit** (vitest, pure logic): the scoped row builder (campaign
  members only / unfiled / all; clipped out-of-scope edges via
  buildGraph's existing endpoint-dropping, asserted); picker option
  construction incl. the GM-only `__new` entry (if extracted pure —
  otherwise covered by e2e).
- **E2E** (Playwright, `--trace off`, TT- fixtures, World A restored,
  id-tracked cleanup):
  - Header bar: controls render above the tab nav; the moved buttons are
    absent from the Index toolbar; Tools opens/closes and lists the four
    items for a GM; a player seat sees only User Guide.
  - Picker "New Campaign…": cancel reverts scope; create switches scope
    to the new campaign.
  - Graph tab (updates to `08-query-graph.spec.mjs`): in campaign scope,
    only member nodes render; an out-of-scope entity's node is absent,
    and present after switching to All; ego-centering from an entity's
    header button lands on the Graph tab, scoped and centered.
  - Existing hub/e2e specs updated for moved selectors — updated, not
    weakened.
