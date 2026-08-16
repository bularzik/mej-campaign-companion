# Changelog

## 0.2.0

**Added:**
- **Backlinks panel** ("Mentioned in") on every MEJ sheet type, showing which campaign entries link to the current entry; Hub entry index displays mention-count badges.
- **Tags and attributes** — custom annotations on MEJ entries with per-row `playerHidden` flag for sensitive attributes.
- **Relationship graph** — visual d3-force graph of `@UUID` links between entries, ego-mode and whole-campaign toggle, backlink overlay, 200-node connection cap.
- **Hub Dashboards tab** — saved queries with grammar support (`type:`, `tag:`, `attr:`, free-text); `@CampaignQuery[...]` page enricher for inline query results on any MEJ sheet.

**Fixed / Internal:**
- Added comprehensive unit coverage for `handleUploadRequest` validation and docx run segmentation.
- Documented senderId trust model for player-recap socket relay with inline ProseMirror sanitization.
- Removed dead `auto-link-baseline` module.
- Added GitHub Actions CI running the unit test suite on every push.

## 0.1.0

Initial release.

- **Session journal type** — a new MEJ page type with session number, in-world campaign date, GM recap, per-player recaps, attendee tracking, a checklist of secrets with GM reveal/hide, and GM-only notes.
- **Campaign Hub** — a "Campaign" home tab integrated into MEJ's tabbed journal shell (index, timeline, and search panes), also reachable from the scene-controls notes group.
- **Campaign timeline** — a single world timeline of timepoints bound to in-world calendar dates, holding links to any document or a raw image, with manual/creation/campaign-date ordering and fractional-key drag-reorder.
- **Cross-journal search** — an inverted index over MEJ entry fields and Session fields, with GM-only fields filtered per-user at query time, built lazily and kept current via document hooks.
- **Auto-link** (opt-in setting) — newly-typed mentions of existing MEJ entry names become `@UUID` links on page save.
- **Auto-capture** (two independent opt-in settings) — combat end creates/updates an MEJ Encounter entry filed onto the timeline; GM "Show Players" images/video auto-file onto the timeline too.
- **Docx import** — a wizard imports a `.docx` into MEJ entries and Session pages, with per-section type suggestions, inline images, and dated-header timepoint detection.
- **Docx export** — selected MEJ entries and the timeline export to a round-trippable `.docx`, with an opt-in toggle for GM-only content.
- **Player collaboration** (opt-in setting) — players can own and write their own Session recaps directly, or relay recap/image writes through an active GM when they lack upload permission.
- Requires Foundry VTT v14 and a Monk's Enhanced Journal build with the extension API (targeting the release after 14.01); the module detects a missing/pre-API MEJ at startup and disables itself with a clear notification rather than half-loading.
