# PDF & Video Shell Routing — Design

**Date:** 2026-08-24
**Status:** Design approved in discussion; spec pending user review
**Scope:** Sub-project E — the final item of the type-system/UI
rationalization round (A import type-list cleanup 0.8.0; B Hub chrome +
Graph tab 0.9.0; C campaign portal 0.10.0; D multiple named timelines
0.11.0).

## Problem

Foundry's native `pdf` and `video` JournalEntryPages open in Foundry's own
window, outside the MEJ shell — one of the concrete symptoms behind the
user's original complaint that "text entries have a disconcerting UI, as
sometimes they open outside of MEJ, sometimes inside." They also fall into
the Hub index's generic untyped bucket (`buildIndexSource` collapses every
untyped member to a `journal` row), so a campaign's reference PDFs and
session recordings are indistinguishable from prose.

Picture (an MEJ flag type) already demonstrates the in-shell experience for
images. PDFs and videos have no equivalent.

## Decisions

| Question | Decision |
|---|---|
| Mechanism | **Register a companion sheet over Foundry's native `pdf` and `video` page types** (user-approved) via `DocumentSheetConfig.registerSheet` with `makeDefault: true` — the mechanism the campaign portal proved in 0.10.0. NOT new MEJ flag types: no conversion of existing pages, no second representation of "a PDF", and it reduces type-system confusion rather than adding to it. |
| What renders | **Native viewer, MEJ chrome** (user-selected): the shell's header/tabs plus the existing knowledge panel, wrapping Foundry's own viewer surface (PDF.js iframe for `pdf`, `<video>` element for `video`). The companion hosts what core builds; it does not re-implement playback or paging. |
| Hub presence | **Full Hub citizens** (user-selected): dedicated Index row types with their own icons and type-filter chips, instead of the generic `journal` bucket. |
| Migration | **None.** Existing pdf/video pages route through the new sheet the moment the module updates; no data is touched. `dataVersion` stays 2. |
| Native mode | When MEJ is absent the registration never happens, so core's own sheet handles these pages exactly as today. Disabling the module fully restores stock behavior — the property that makes `makeDefault` safe to claim. |
| Content search | **Out of scope.** PDF text extraction is its own project; video has no text. These pages are findable by name, not by content. |
| Auto-link | These pages are link **targets**, never link **sources** — nothing scans a PDF for entity mentions. |

## 1. Routing

- `scripts/sheets/MediaPageSheet.mjs` (new): a thin `EnhancedJournalSheet`
  subclass, registered for the native `pdf` and `video` types. Its render
  part builds MEJ's frame and mounts the native viewer inside the content
  area:
  - `pdf` → the same PDF.js viewer surface core uses, pointed at the
    page's `src`, sized to the pane;
  - `video` → a `<video controls>` element bound to the page's `src`
    honoring the page's existing playback fields (`volume`, `loop`,
    `autoplay`, `timestamp`) where present.
- Registration happens in `integrations/mej-adapter.mjs` beside the
  Session/campaign registrations, for BOTH hosting modes
  (`DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID,
  MediaPageSheet, { types: ["pdf", "video"], makeDefault: true,
  canConfigure: true })`), and is repaired by the existing
  `ensureSheetRegistrations` path (extend `missingSheetRegistrations` and
  its unit tests for the two new keys).
- **Two lessons from sub-project C are binding here:**
  1. the sheet overrides `_toggleDisabled` to a no-op — MEJ's shell
     blanket-disables a subsheet whose document isn't owner-editable, which
     would freeze a read-only viewer's own controls (a video's play
     button) for every non-owner;
  2. any type check accepts BOTH the bare and module-prefixed forms,
     because MEJ's `fixType` normalizes a mounted page's in-memory `.type`.
- Pop-out and native-window mounting use the same class, so behavior is
  identical in both hosting modes.
- The knowledge panel (`hooks/knowledge-ui.mjs`) already injects for MEJ
  sheets; it must inject for this one too (verify its `mejPageOf` gate
  admits these pages, and widen it if it gates on the MEJ type flag).

## 2. Hub presence

`logic/hub-index.mjs`'s `buildIndexSource` currently derives
`getMEJType(entry) || "journal"`. It gains a pure refinement: when an entry
carries no MEJ type, derive the row type from its FIRST page's native type
via a lookup table —

| Native page type | Row type | Icon |
|---|---|---|
| `pdf` | `pdf` | `fas fa-file-pdf` |
| `video` | `video` | `fas fa-film` |
| `image` | `image` | `fas fa-image` |
| anything else / no pages | `journal` | `fas fa-book` |

An MEJ type, when present, still wins — this only refines the untyped
bucket. Each new row type gets a type-filter chip alongside the existing
`journal` chip (0.6.0), and a localized label ("Document", "Recording",
"Picture").

Everything else follows from membership being folder-based and needs no
new code: these pages are already campaign members, already covered by the
campaign picker's scoping, already searchable by name, already valid
`@UUID` targets, and already droppable onto timepoints through the
existing link machinery.

## 3. Non-goals

- No PDF text extraction, annotation, or page-position persistence.
- No new MEJ flag types; no conversion of existing pdf/video pages.
- No import-wizard changes (PDFs and videos are not docx-importable).
- No timeline or graph changes.
- No changes to monks-enhanced-journal itself (standing rule).

## 4. Testing

- **Unit** (vitest): the row-type derivation — pdf/video/image/text/no-pages,
  and MEJ type still winning when present; the icon/label mapping;
  `missingSheetRegistrations` extended for the two new sheet keys.
- **E2E** (Playwright, `--trace off`, TT- fixtures, id-tracked cleanup,
  World A restored, campaign scope + timeline selection reset):
  - A `pdf` page and a `video` page created in a campaign each open
    INSIDE the shell — assert the shell element hosts the viewer and that
    no separate Foundry journal window opened.
  - The knowledge panel injects for both (tags/attributes/Mentioned-in
    present).
  - Their Index rows appear with the `pdf`/`video` row types and icons,
    and the new type-filter chips include/exclude them correctly.
  - A player with observer access opens one, sees the viewer, and sees no
    GM-only chrome; the viewer's own controls are NOT disabled (the
    `_toggleDisabled` regression from sub-project C).
  - Existing suites (02-hub-timeline, 14-campaigns, 16-multi-timeline)
    stay green — updated for any moved selectors, never weakened.
