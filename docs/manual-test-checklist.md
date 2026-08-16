# Manual test checklist

Items here are either not automatable at all, or not currently covered by the automated suites (`npm test` — 359 unit tests; `npm run test:e2e` — 24 Playwright specs against a live Foundry v14 test world). Run through these by hand before cutting a release, or whenever you touch the area they cover.

## Second-display / popout behavior

- Foundry's native "Pop Out!" support: pop the Campaign Hub tab and a Session sheet out to a separate window (or a second monitor) and confirm both render correctly, controls remain clickable, and closing the popout doesn't break the main client's copy of MEJ's shell.
- With a GM's Session sheet popped out, confirm editing the recap / GM notes / secrets still saves correctly back to the document (no state gets stranded in the popout's own ApplicationV2 instance).
- Not covered by e2e: the Playwright harness drives a single browser context per client and doesn't exercise Foundry's popout window path.

## Non-`dnd5e` system degradation

The companion's core (Session sheet, timeline, search, docx import/export, auto-link, auto-capture) makes no `dnd5e`-specific assumptions in its own code — but MEJ itself, and the Actor documents auto-capture reads, can vary by system. Spin up (or switch) a test world to a non-`dnd5e` system (e.g. `pf2e`, or a generic/no-system world) and check:

- Session sheet: attendees can still be dragged on from the Actors directory and render with name/image regardless of system.
- Auto-capture: ending a combat with non-`dnd5e` actors still produces a usable Encounter entry and participant summary (some MEJ Encounter fields that are `dnd5e`-flavored may be sparser — that's expected MEJ-side behavior, not a companion crash).
- Search: Person/Place/etc. field extraction still returns *something* sensible for entries whose underlying MEJ system-data fields differ or are absent, without throwing.
- No console errors anywhere in the above from either module.

## Word / Google Docs visual fidelity of docx export

The exported `.docx` is verified structurally by unit tests (`test/doc-export.test.js`, `test/doc-export-snapshot.test.js`) against the intermediate node model, not against how Word or Google Docs actually renders the resulting file. By hand:

- Open an exported `.docx` in **Microsoft Word** (desktop or Word Online) and in **Google Docs** (upload + open). Confirm: headings render as headings (not just bold text), lists (including nested lists) render as real lists, tables render as tables with visible borders, inline formatting (bold/italic/underline/strike) survives, and any exported images appear inline rather than as broken links or attachments.
- Confirm the `Campaign Record type: <kind>` marker paragraph at the top of each section is present but unobtrusive (small/plain text), not mistaken for a heading.
- Round-trip check: export, then re-import the same `.docx` through the import wizard, and confirm the wizard's per-section type suggestions correctly recognize the type markers (should suggest the *same* type each entry was exported as, not fall back to keyword guessing).

## libWrapper conflict scan (Monk's Common Display)

Auto-capture's shared-media capture installs a `libWrapper` wrap around `ImagePopout.prototype.shareImage` (with a manual-patch fallback if `libWrapper` isn't installed) — see `scripts/hooks/auto-capture.mjs`'s header comment. **Monk's Common Display** is a separate, commonly co-installed module that also hooks into the image-share path to mirror shown images to a second display. With both modules enabled in the same world:

- Show an image to players (via the normal Foundry image-popout "Show Players" action) and confirm: the image still appears correctly on player clients, Monk's Common Display still mirrors it to its second-display target, **and** (with `autoCaptureSharedMedia` on) the image still gets filed onto the campaign timeline's newest timepoint. All three should happen from one action, with no console errors from either module about a broken wrap chain.
- Repeat with `libWrapper` **not installed** (companion falls back to its manual monkeypatch) to confirm the fallback path doesn't silently break Monk's Common Display's own patch.
- If a conflict does surface, check the Foundry console for a `libWrapper` conflict warning identifying the two competing registrations, and note the load-order / `libWrapper.ignore_conflicts` implications rather than silently changing behavior.

## Player search rendering (known open issue — e2e workaround in place)

`tests/e2e/03-search.spec.mjs` works around a **live MEJ-side render-abort bug**: `EnhancedJournal`'s subsheet render path throws (`AppV2` "did not implement this getter") for a document a non-owner client doesn't have at least temp ownership of, aborting the render entirely (not merely a cosmetic glitch — search results paint zero rows, and a second render attempt can leave shell inputs unreachable). The e2e spec steers around it by setting `game.MonksEnhancedJournal.journal.tempOwnership = true` before exercising the Hub as a player — which means **the automated suite has never verified player-facing search rendering without that workaround.**

Manually verify, as a real player client, with the workaround *not* applied (fresh player login, no console `tempOwnership` poke):

- Open the Campaign Hub as a player and run a search. Confirm results actually paint (not just that no error is thrown).
- Try a second search immediately after the first, to check for the "shell inputs become unreachable" symptom described above.
- If the bug still reproduces, this is an MEJ-side issue (not a companion bug) — file/track it against MEJ rather than attempting a companion-side patch; the e2e workaround should stay in place in the meantime, and this checklist item should be re-tested against the next MEJ release that touches `EnhancedJournal`'s subsheet render path.

## Auto-advance / timing

- Auto-capture's combat-end hook: end a combat that has **zero** rounds elapsed (immediately ended after starting) and confirm no Encounter entry is spuriously created (or that an empty-outcome entry is handled sensibly, matching whatever the current unit-tested behavior specifies) rather than throwing.
- Auto-link's save-time tokenizer: confirm it doesn't re-trigger itself in a loop on a page whose own auto-link pass just added a link (i.e. saving the page a second time immediately after an auto-link pass doesn't add duplicate links or re-walk already-linked text).
