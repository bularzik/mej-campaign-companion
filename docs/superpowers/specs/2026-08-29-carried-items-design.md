# Carried items — sub-project 1 design (0.13.6)

**Status:** approved in chat 2026-08-29 (scope, ordering, MEJ-workaround
policy, Session-header behaviour); awaiting spec review.
**Baseline:** `main` @ 59c5e0b (0.13.5). Branch `fix/carried-items`.
**Evidence:** `2026-08-29-carried-items-investigation.md` (one section per
item, file:line, root cause, probe results). Every fix below cites it.

## Purpose

Close every item the bugfix sweep (`2026-08-28-bugfix-sweep-design.md`)
carried forward, except the three that share one structural root cause —
reveal records being entry-scoped while sections are page-scoped
(duplicate section ids, `pruneOrphans` data loss, `#secretSectionHtml`
preview fallback). Those are **sub-project 2**, a stored-data migration with
its own spec, run after this ships.

## Decisions taken in chat

- **Order:** this sub-project first, the index migration second.
- **MEJ-side items:** companion-side only. The investigation then showed
  neither is MEJ-side after all (items 12 and 13 below), so no workaround
  is needed — they are ordinary companion fixes.
- **Session header:** render MEJ's detailed header only when the entry has
  an image or a populated field; otherwise suppress it.
- **Release:** 0.13.6. These are product fixes.

## Global constraints

- Companion features never patch MEJ; no edits outside this repo.
- World A is the user's real world: harness cleanup is id/flag-tracked only.
- Test fixes wait on real conditions — no `retries`, no `waitForTimeout`.
- Every product fix ships with a regression test and a **vacuity check**
  (disable the fix by hand-edit, watch the test fail, restore).
- Regression gate: a full 18-spec e2e run diffed against `main`'s baseline,
  not a green targeted suite (Round 4 lesson).
- `mammoth` is **not upgraded** in this round; it parses untrusted input and
  a version bump is its own decision.

## The thirteen items

Grouped by the file area a single implementer would own. Sizes from the
investigation.

### Group L — layout and CSS

**L1. Timeline controls stack vertically** (S; inv. §1).
`.mej-cc-timeline-controls` has no rule. Add one modelled on
`.mej-cc-index-controls`: `display:flex; align-items:center; gap:.5em;
flex:0 0 auto`, select `flex:1 1 auto; min-width:0`. Verified by the guide
harness recapturing `timeline-selector.png` on one row.

**L2. GM's "Player Recaps" list is pushed out of view** (M; inv. §3).
Not a data bug — the flag write, `buildRecapEntries`, and Foundry's flag
merge all check out, and `06-player-collab` proves the `<li>` reaches the
DOM. MEJ's `.editor-parent{flex:1;height:100%;overflow:hidden}` lets the
GM's empty self-recap editor claim the whole section and push
`ol.other-recaps-list` past the clipped `.sheet-body`. Fix: a companion
rule scoped to the Session sheet giving `.player-recap-self` a natural
height (`flex:0 0 auto; height:auto`) so the list follows it. Regression:
e2e — GM opens a session carrying User 1's recap; `.other-recap` is in the
viewport (`boundingBox` inside the sheet body), not merely in the DOM.

**L3. Enriched preview wrapper collapses to `clientHeight 0`** (M; inv. §13).
MEJ's `.editor.editor-display{height:100%;min-height:100%;overflow-y:auto}`
resolves against a chain that is not definite in tab layouts, so the box is
0 px tall yet scrollable; any scroll shifts every child's rect up and the
audience button lands over the tab strip (the `09-secrets:83` intercept).
Fix: on companion-owned sheets only, `.editor-parent, .editor.editor-display
{ height:auto; min-height:0; flex:1 1 auto; }` so the wrapper takes its
content height inside the flex column. Verified live: the
`clickWithHitDiagnostics` capture must show `clientH > 0`, and the `08+09`
pairing that reproduced the intercept runs ×6 clean. Since this touches the
same chain as L2, they are one task.

### Group T — templates and small logic

**T1. Prep-board attendees have no visible names** (S; inv. §2). The name is
only in `data-tooltip`/`alt`. Render a `<span>` with the name. Unit test on
the rendered template if a seam exists, else e2e assertion on the board.

**T2. Search snippets leak `@UUID[…]{…}`** (S; inv. §4). `stripHtml` only
strips tags; enricher syntax is plain text. Add `stripEnrichers(text)` in
`scripts/logic/search-index.mjs` applied before `stripHtml`:
`@X[ref]{Label}` → `Label`, bare `@X[ref]` → last id segment. Improves the
token set too. Unit tests on both forms and on text without enrichers.

**T3. Portal page renders the Knowledge panel** (S; inv. §6). The portal
page carries an MEJ type flag so `mejPageOf()` treats it as content. Return
`null` for `CAMPAIGN_DOCUMENT_TYPE` (and the Hub page id) — shell pages have
no "mentioned in". e2e: open the portal, assert no `.mej-cc-knowledge`.

**T4. Zero-campaign dead controls + "1 sections"** (S; inv. §7).
`promptCampaignChoice()` returns `null` for both "no campaigns" and
"cancelled", so callers stay silent. Fix at the shared site: when the world
has no campaigns, warn with a new `hub.noCampaignsYet` string and return
`null`; additionally disable the three controls with that string as tooltip
when `campaigns.length === 0` so the UI is honest before the click. Plural:
`sectionsDetectedOne`/`sectionsDetectedMany` keys with a boolean in the
review-screen context. e2e for the disabled state in a zero-campaign world
(14-campaigns already isolates that state); unit test for the plural
selection.

### Group S — secrets and sheet context

**S1. Player sees core's Hide toggle on a natively-revealed secret** (S;
inv. §5). `HTMLSecretBlockElement` adds the button unconditionally on
upgrade; the only suppression is `DocumentSheetV2._toggleDisabled(true)`,
which MEJ's shell calls with the **wrong element** (`subsheet.element`, not
the mounted one). Group-only reveals escape because the companion inserts
them via an inert `DOMParser` document. Fix: in the companion's post-mount
hook, when the viewer cannot edit the entry, set `revealable = false` on
every `secret-block` inside the rendered subsheet element (the exact
operation core performs). e2e: player opens an entry with an "Everyone"
secret; `secret-block button` is absent or hidden; GM still sees it.

**S2. MEJ's detailed header shows the raw page schema on Session sheets**
(S; inv. §12). `SessionSheet` never shadows `context.fields`; the partial
iterates Foundry's `DataField`s ("Page Name / Type / File Path / Page
Category / Sort Order" over empty divs) and the image falls back to
`assets/session.png`, which MEJ does not ship. Fix: set `context.fields`
to MEJ's `{id,name,value,…}` shape — empty for Sessions, whose date and
attendees live on the Session tab — and compute `showHeader = !!src ||
fields.some(f => f.value)`; the partial is wrapped in `{{#if showHeader}}`.
Regression: unit test on `_prepareBodyContext` output (`fields` is an
array, `showHeader` false with no image, true with one); e2e that the
header labels are absent on a fresh Session and the sheet body starts at
the tabs.

### Group Q — query grammar

**Q1. C16 — bad-query validation is unreachable** (M; inv. §8).
`parseQuery` is total: only whitespace-only input throws, and the dialog
has already rejected that. Decision: **make the grammar strict**, keep the
branch — the `@CampaignQuery` enricher already assumes throwing is
meaningful. Reject exactly what cannot mean anything: `attr:` with an empty
key (`attr:=:=broken` today yields key `""` and an always-empty dashboard),
`type:`/`tag:`/`attr:` with no value. Everything else stays free text.
Errors carry a reason (`bad-attr`, `bad-type`, `bad-tag`) and `badQuery`
shows it. Unit tests: the four probe inputs (`attr:=:=broken` rejected;
`attr:`, `((`, `"unclosed` free text) plus every existing grammar test
unchanged.

### Group V — vendor provenance

**V1. mammoth version pinned** (S; inv. §9). The bundle is byte-identical
to npm `mammoth@1.12.0`. Extend `vendor/checksums.txt` to
`<sha256>  <file>  <name>@<version>`, widen `check-vendor.mjs`'s manifest
regex to carry the package claim, add an opt-in registry check, and correct
the README's "matches no published version" sentence. 1.12.2 is noted as
available, not applied.

### Group H — harness

**H1. `cleanupTimelineJournal` deletes by name** (M; inv. §10). The module,
not the spec, creates these journals (from a GM Hub render), so the spec
cannot register at creation. Invert it: snapshot the ids of every timeline
journal at `beforeAll`/`beforeEach` (Node-side, survives reloads and
worker restarts), and delete only journals that **appeared** and carry the
companion timeline flag. The content guard (all timepoints `TT-` or none)
stays as a second lock. Every caller (02, 04, 05, 14, 16, 17) migrates.

**H2. Ten bare `game.ready` waits** (S; inv. §11). Add `gotoGame(page)` and
`reloadGame(page)` in `helpers/foundry.mjs`, both ending in
`waitSessionBound`, and replace the nine listed sites plus
`09-secrets.spec.mjs:593`, which has no ready wait at all. Any site with an
additional post-load wait keeps it after the helper call.

## Testing and verification

- Unit (vitest): T2, T4 plural, S2 context, Q1 grammar, V1 manifest parser.
- e2e (live World A, `TT-`/flag-tracked): L2, L3 (paired `08+09` ×6), T1,
  T3, T4 disabled state, S1, S2 header absence.
- Vacuity check on every product fix.
- Regression gate: full 18-spec run ×2 on the branch vs the 0.13.5 baseline
  (93/0/12); unit count must not drop below 679.
- Guide screenshots: `GUIDE_SHOTS=1` rerun; `timeline-selector.png`,
  `session-sheet-gm.png`, `prep-board.png`, `hub-search.png` are expected
  to change and each is checked against its guide caption.

## Release

Bump to 0.13.6; CHANGELOG entries in the existing voice, one per
user-visible fix (L1, L2, T1, T2, T3, T4, S1, S2, Q1); H1/H2/V1 noted as
"no user-facing change". Annotated tag at the merge commit; zip manifest
diffed against 0.13.5; live URL verified — as in every prior round.

## Out of scope

- Sub-project 2: page-keyed secrets index (three carried items).
- `mammoth` upgrade to 1.12.2.
- MEJ-side changes of any kind.
