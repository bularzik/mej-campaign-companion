# Campaign Companion Phase B — Knowledge Layer + Phase A Cleanup — Design

**Date:** 2026-08-16
**Status:** Approved (brainstorming session, all sections user-approved)
**Deliverable:** `mej-campaign-companion` 0.2.0 (single repo; no MEJ-side changes)

## 1. Background and decision summary

Phase A (0.1.0, released 2026-08-16) shipped the campaign layer: Session sheet, timeline, Campaign Hub shell page, inverted-index search, auto-link, auto-capture, docx import/export, and player collaboration. The Phase A spec (`monks-enhanced-journal` branch `worktree-spec-campaign-companion`, `docs/superpowers/specs/2026-08-15-mej-campaign-companion-design.md`) sketched Phase B as the knowledge layer; this spec makes it concrete and folds in the Phase A known-issue backlog.

User decisions (recorded from the brainstorming dialogue):

| Decision | Choice |
|---|---|
| Module boundary | **Extend `mej-campaign-companion`** (ships as 0.2.0). No third module: Phase B reuses the companion's scan pipeline, Hub filter grammar, and test harness, and a separate module would need an API-on-an-API. |
| Phase B scope | **All four features**: backlinks, relationship graph, tags + attributes, query blocks/dashboards |
| Phase A known issues | **All five** fixed this round (see §7) |
| Backlinks UI | **Every MEJ sheet + Hub** (collapsible "Mentioned in" section, Hub mention-count badge) |
| Graph rendering | **Vendor `d3-force`, render SVG ourselves** (matches the vendored-mammoth/docx convention) |
| Query surface | **Hub dashboards + page embeds** via a `@CampaignQuery[...]` text enricher |

## 2. Architecture

**No MEJ-side changes.** Phase B needs zero new MEJ API surface: backlinks and tags read/write only companion flags; the graph reads MEJ's existing `relationships` flags; sheet injection uses libWrapper, which the companion already uses for `shareImage`. The merged `feat/extension-api` branch is untouched, keeping the upstream PR clean.

**Two derived indexes, one scan pipeline.** The search subsystem (`scripts/logic/search-index.mjs`, `scripts/search/live-index.mjs`, `scripts/logic/field-extractors.mjs`) grows a second output: while scanning a document's fields for search terms, it also extracts outbound `@UUID[...]` references, producing a reverse map `targetUuid → [{sourceUuid, count}]`. Backlinks are never stored in flags — they are derived, built lazily with the search index, and patched incrementally by the same document-update hooks. A "mention" is a `@UUID` link; auto-link already converts plain-prose names into `@UUID` links, so prose mentions are caught transitively. No separate plain-text matching.

**Permission model (one rule everywhere):** a backlink row, query result, graph node, or tag is shown only if the viewing user has OBSERVER permission on that entry — the same gate the search index already enforces. Graph edges render only when both endpoint nodes are visible to the viewer. Attributes marked `playerHidden` index under the existing `gm:` field-prefix convention and are filtered at query time exactly like Phase A's GM-only search fields.

## 3. Data model

All new stored data lives in `flags["mej-campaign-companion"]` (journal pages) or world settings — zero writes to MEJ's flag namespace.

- `tags`: `string[]` on any MEJ journal page. Visible read-only to anyone who can observe the entry; GM-editable.
- `attributes`: `[{id, key, value, playerHidden}]` on any MEJ journal page. `value` is a string; `playerHidden` rows are GM-only end to end (widget, index, queries).
- **Saved queries**: a world-scoped setting (GM-writable, all-clients-readable): `[{id, name, query, showPlayers}]`. `showPlayers: true` exposes the dashboard entry to players (results still permission-filtered per viewer).
- **Backlink index**: in-memory per client, derived (see §2). Never persisted.

## 4. Query grammar

One pure module `scripts/logic/query-grammar.mjs`: parse and evaluate token strings like `type:person tag:villain attr:faction=Zhentarim free text` against the index. Supported tokens: `type:<key>` (merged-registry type keys), `tag:<tag>`, `attr:<key>` / `attr:<key>=<value>`, and bare terms (existing full-text search semantics, including the `gm:` filtering). The Hub filter bar, Hub dashboards, and the page enricher all consume this one grammar so they cannot drift apart.

## 5. Feature surfaces

### Backlinks ("Mentioned in")
A collapsible section appended to the bottom of every MEJ sheet, injected via a libWrapper after-wrapper on the shell's `renderSubSheet` plus the standard render hook for popped-out sheets. Each row: mentioning entry's type icon, name, mention count; click opens it as a normal MEJ tab. Hub index rows show a mention-count badge.

### Tags + attributes widget
A chip-style tag input plus an expandable attributes table (key / value / player-hidden toggle per row), injected into the same sheet region as the backlinks section. GM-editable; observers see tags and non-hidden attributes read-only. Both are indexed, so `tag:` and `attr:` tokens work in search, dashboards, and enrichers immediately.

### Relationship graph
A standalone ApplicationV2 opened from a Hub toolbar button or any MEJ sheet's header. Vendored `d3-force` drives layout; the companion renders SVG itself. Two modes: **ego-graph** centered on one entry (default) and **whole-campaign** view. Nodes are typed via the merged registry (icon + color); edges come from MEJ `relationships` flags, with a toggle overlaying backlink edges as dashed lines. Interactions: drag to pin, scroll to zoom, click to open the entry as an MEJ tab. A node cap (~200) shows a "filter to reduce" notice instead of rendering a frozen hairball. Relationships are edited on MEJ sheets as today — the graph is read-only visualization.

### Query blocks / dashboards
A "Dashboards" area in the Hub lists saved queries as live result lists; the GM creates/edits/deletes them, and `showPlayers` exposes individual dashboards to players. A `@CampaignQuery[<grammar string>]` text enricher embeds the same live list inside any journal page. Enricher results are permission-filtered per viewing user and refresh whenever the page re-renders — not push-live mid-view (accepted limitation, documented in the README).

## 6. Error handling

- Index and backlink scan failures log and skip — observer posture, never blocking the underlying save/update (same as Phase A auto-link/auto-capture).
- Enricher failures render an inert placeholder element rather than breaking page rendering.
- The graph app degrades to a "too many nodes — filter to reduce" notice above the cap instead of freezing.
- Saved-query parse errors surface inline in the dashboard editor; a stored query that no longer parses renders as an error row, not a crash.

## 7. Phase A cleanup (all five known issues)

1. **senderId trust-model disclaimer**: add the honest-trust-model note (module sockets carry no authenticated sender; `senderId` is claimed, not verified) to the `scripts/hooks/media-relay.mjs` header comment, matching the inline doc on `handleUploadRequest`.
2. **`handleUploadRequest` validation unit tests**: vitest coverage with global stubs (`game`, `fromUuid`) for the reject paths (bad sender, bad context, bad type) and the success path — currently e2e-only.
3. **Dead ported modules**: delete `scripts/logic/auto-link-baseline.mjs` and any other logic module with no importers, along with their tests. Verified by import-graph check, not filename guessing.
4. **Export-dialog coverage**: unit tests for the export dialog's extractable logic (selection assembly, option plumbing into `doc-export.mjs`).
5. **CI**: GitHub Actions workflow running the vitest suite on push and PR. The Playwright e2e suite stays local-only (needs a live Foundry instance) and is excluded from CI.

## 8. Testing

1. **Unit (vitest):** every new logic module — query grammar (parse + evaluate), backlink extraction/reverse-map maintenance, tag/attribute utilities, graph data assembly (nodes/edges/visibility filtering), plus the §7 additions.
2. **In-world (Playwright):** new e2e specs following the existing harness: backlinks section appears after linking two entries; tag editing round-trip; dashboard creation + `@CampaignQuery` enricher rendering; graph-open smoke test; player-permission leak checks for backlinks and query results.
3. **CI** runs the unit suite only (§7.5).

## 9. Release

Ship as **0.2.0** using the 0.1.0 process: version + pinned `download` URL in `module.json`, annotated tag at the build commit (pushed), GitHub release with `module.zip` + `module.json` assets, both install URLs verified.

## 10. Out of scope

- Attribute *templates* per type (YAGNI until attributes see real use)
- Phase C secrets features (per-block reveal, hidden relationships, storyteller screen)
- Graph editing (relationships stay edited via MEJ sheets)
- Push-live enricher refresh (results update on page re-render only)
- Plain-text (non-`@UUID`) mention detection for backlinks
- Any MEJ-side code or API changes
