# Changelog

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
