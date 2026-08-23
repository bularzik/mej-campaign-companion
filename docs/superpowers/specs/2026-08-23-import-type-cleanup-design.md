# Import Type-List Cleanup — Design

**Date:** 2026-08-23
**Status:** Design approved in discussion; spec pending user review
**Scope:** Sub-project A of the 2026-08-23 type-system/UI rationalization
round. Successors (each with its own spec): B Hub chrome + graph scoping,
C campaign-as-entity, D multiple named timelines, E PDF/video shell routing
(floating). This spec covers only the docx import wizard's type column.

## Problem

Three defects in the import wizard's per-row type select, confirmed live
(2026-08-23, world-a, module 0.7.0):

1. **Duplicate "Text and Image" option.** 0.7.0 relabeled the legacy `text`
   pseudo-type to MEJ's "Text and Image" label, but `journalentry` was
   already in `COMPANION_IMPORT_TYPES` — the select now shows two options
   with identical labels and different values (`text` creates the same
   entry shape as `journalentry` since 0.7.0, making the pseudo-type fully
   redundant).
2. **Session sections are never suggested as Session.** `suggestType()`
   (logic/doc-import.mjs) uses `section.isSession` only to *skip the
   keyword table*; detection feeds the timepoint pre-check but never the
   type suggestion, so every session section falls through to the prose
   fallback. Confirmed against the user's real-world test document
   (campaign-record `examples/Radiant Citadel.docx`) and by the existing
   e2e test, which must manually select "session" before importing.
3. **Arbitrary select order and invisible detection.** The type list is in
   `COMPANION_IMPORT_TYPES` declaration order, and nothing in the review
   step shows that session detection ran.

## Decisions

| Question | Decision |
|---|---|
| Keep `text` in the list? | **No — remove the pseudo-type entirely.** `journalentry` ("Text and Image") is its full replacement (0.7.0 made them create identical entries). |
| Default for session-shaped sections | **Suggest `session`** (round-trip markers still win — see precedence below). |
| Fallback for unrecognized prose | **`journalentry`**, NOT `session`. Rationale (user-ratified): sessions carry side effects — `playersWriteSessions` force-OWNER escalation, dashboard/recap membership, timepoints — so mistyping lore as Session misbehaves, while mistyping a session as prose is inert and easily retyped. The detector, not the fallback, is the lever for missed sessions. |
| Select order | Text and Image, Session, Person, Place, Organization, Quest, Encounter, Event, Point of Interest, Shop, Loot, List, then Skip last. |
| Detection visibility | Review step gains a "{n} sections detected as sessions" line (hidden at zero). |
| Session data model / indexing / auto-link | **No changes needed** (user-checked): imported sessions already use `buildSessionPageData()`, are indexed, and participate in auto-link both directions; A only changes suggestion frequency. |
| Widening `detectSessionHeader` patterns | **Out of scope** — detection already works for the test document; revisit only if real headers are shown to miss. |

## Design

### 1. `logic/doc-import.mjs` (pure)

- `suggestType(section, recordTypes)` precedence becomes:
  1. round-trip marker (normalized via `LEGACY_TYPE_ALIASES`), when its
     type is in `recordTypes` — unchanged, still wins over everything;
  2. **NEW:** `section.isSession && recordTypes.includes("session")` →
     `{ type: "session", fromMarker: false }`;
  3. title keyword table (now reachable only for non-session sections, as
     today);
  4. fallback `{ type: "journalentry", fromMarker: false }` (was `"text"`).
- `LEGACY_TYPE_ALIASES` gains `text: "journalentry"` so a legacy
  campaign-record round-trip marker `Campaign Record type: text` maps to
  the real type (same mechanism as the existing `item`/`media` aliases).
- `buildImportPlan(sections, rows, recordTypes)` normalizes each row's type
  through `normalizeType()` before validation and page emission, and drops
  the `row.type !== "text"` validation exemption. Effect: a stale form
  still posting `text` (mid-upgrade client) plans as `journalentry`;
  unknown types still throw.

### 2. `apps/import-wizard.mjs`

- `#typeOptions(selected)`: the hardcoded `text` option is deleted. Options
  are built from an explicit order list
  `["journalentry", "session", "person", "place", "organization", "quest",
  "encounter", "event", "poi", "shop", "loot", "list"]` (every entry is in
  `COMPANION_IMPORT_TYPES`; labels via MEJ `getTypeLabels()` except
  `session`, which keeps the companion's own label), then `skip` last.
- `#createPage`: the `page.type === "text"` branch is deleted —
  `buildImportPlan` can no longer emit it (belt: normalization above;
  suspenders: the generic `createMejEntry(page.type, …)` tail would handle
  a `journalentry` row anyway). The doc comments referencing the pseudo-type
  are updated.
- `_prepareContext`: review step gains
  `context.sessionsDetected = this.state.sections.filter(s => s.isSession).length`.

### 3. Template + i18n

- `templates/import-wizard.hbs`: review step shows
  `{{sessionsDetected}} sections detected as sessions` (an `{{#if}}`-guarded
  line above the rows table).
- `lang/en.json`: new `import.sessionsDetected` ("{count} sections detected
  as sessions — their type and timepoint are pre-set"); `import.typeText`
  is deleted (last consumer gone).
- `constants.mjs`: `COMPANION_IMPORT_TYPES` doc comment updated (no longer
  claims the dropdown "also offers text").

### 4. Compatibility

- No data migration: nothing persisted ever stored the `text` pseudo-type —
  it existed only inside the wizard's form state.
- Round-trip: docs exported by campaign-record or the companion with `text`
  markers import as Text and Image via the alias.
- Zero-behavior-change surface: creation shapes are untouched (0.7.0
  already unified them); only suggestion, list contents/order, and review
  copy change.

## Testing

- **Unit** (`test/doc-import.test.js`): session-shaped sections suggest
  `session`; marker still beats session shape; unknown titles fall back to
  `journalentry`; `text` marker aliases to `journalentry`;
  `buildImportPlan` normalizes a stale `text` row and still rejects unknown
  types.
- **E2E** (`tests/e2e/05-docx-import.spec.mjs`): the manual
  `selectOption("session")` step is REMOVED — the Session Zero row must
  arrive suggested as `session` (assert the select's value) and import as a
  session subtype without intervention; the Introduction
  journalentry-typing assertions stay; assert the type select contains
  exactly one "Text and Image" option; assert the sessions-detected line is
  visible with the expected count.
