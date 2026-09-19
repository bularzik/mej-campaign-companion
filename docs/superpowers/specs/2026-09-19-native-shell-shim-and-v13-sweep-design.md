# Native-mode shell hosting and the Foundry 13 sweep — design

Date: 2026-09-19. Status: approved in chat, spec under review.
Repo: mej-campaign-companion. Target release: 0.20.0.
Companion input: `docs/superpowers/triage/2026-09-19-mej-shell-hosting-survey.md`
(line-cited survey of the fork's extension API against stock MEJ 13.06 and 14.01).
Prior art: `docs/superpowers/specs/2026-09-19-mej-14.01-rebase-sweep-design.md`
(sweep procedure and attribution classes), `docs/superpowers/specs/2026-09-02-v13-compat-design.md`
and `…-investigation.md` (the render path stock MEJ takes on Foundry 13).

## 1. Problem

On Foundry 13.351 with stock MEJ 13.06 the companion 0.19.3 runs in native mode
and shows these defects (all reproduced on the local v13 server, port 30013,
world-b, as Gamemaster, 2026-09-19):

1. **Sessions render inside MEJ's JournalEntry wrapper.** A sidebar click routes
   through MEJ's shell, which hosts the entry with its own `JournalEntrySheet`
   subsheet. The page index appears on the left and the SessionSheet is
   transplanted one level down, inside `article.journal-entry-page`. Computed
   text colour there is rgb(34,34,34) on a transparent ground inside a
   `theme-dark` shell: unreadable. The same session on Foundry 14 in api mode
   under the same dark scheme renders rgb(221,221,221) on rgb(28,27,24),
   readable. The wrapper, not the theme, is the cause.
2. **The Hub does not open from the scene-controls button.** `openHub()` in
   native mode throws inside Foundry's `DocumentSheetConfig.getSheetThemeForDocument`
   (`foundry.mjs:35496`, `Object.values(config.sheetClasses[subType])`): the
   Hub's synthetic type has no entry in `CONFIG.JournalEntryPage.sheetClasses`
   on 13.351, although `registerHubSheetClass` is called from the native-mode
   wiring. Only the session and campaign types are present. This passed on
   0.15.0 (v13 stock gate 8/8) and is therefore a regression somewhere in
   0.16–0.19.3 or in the registration path on 13.351.
3. **A docx import ends with an error.** The world holds a 37-page legacy
   journal ("Radiant Citadel", created 2026-07-15 by the campaign-record
   module) with two pages Foundry hides and cannot validate because
   campaign-record is disabled: `campaign-record.place` "Coral Cave Ruins" and
   `campaign-record.media` "Picture". The wizard's final retro-link pass writes
   links into existing journals that mention the new entries; updating that
   journal re-validates it and fails, naming the place page. Timestamps agree:
   the import's entries were created 13:57:41 EDT, the legacy journal was
   modified 13:57:45 EDT. The companion never writes `campaign-record.*`
   types. No migration is wanted (campaign-record data exists only in test
   worlds); the wizard must finish anyway.
4. **Unknown tail.** Nothing in 0.16–0.19.3 was verified on Foundry 13 beyond
   the 8-test stock smoke.

Decisions taken in the brainstorm: shell integration on stock MEJ without the
extension API (not native-parity fixes, not an API backport); one native mode
for stock 13.06 and stock 14.01 alike; no legacy-page migration or guard
feature; full-suite sweep on Foundry 13; approach A (registry wraps).

## 2. Scope

In:
- Shell hosting for native mode on stock MEJ 13.06 (Foundry 13) and stock MEJ
  14.01 (Foundry 14), with a standalone-window fallback.
- The Hub open failure on Foundry 13 (fallback path).
- Readable sessions and Hub under both colour schemes, with a contrast check.
- The import wizard and hook-driven retro-link bursts finishing when a journal
  write fails.
- Porting the e2e harness so the full suite runs on Foundry 13; a v13 sweep
  with per-failure attribution; fixes for companion, shim and harness defects
  the sweep finds.
- Docs and the 0.20.0 release.

Environment only (not code): back up world-b, then delete the two hidden
campaign-record pages before the sweep baseline.

Out: any campaign-record migration; any change to MEJ (defects found in MEJ
become upstream issues or fork backlog items); api mode on Foundry 13; the
sweep's MEJ-attributed and platform-attributed failures.

## 3. Mode model

Unchanged: `resolveMode` (`scripts/logic/mej-mode.mjs`) still yields `api`,
`native` or `absent`. Native mode now hosts the Hub and Sessions in MEJ's shell
through the shim. A new native-mode fact, `hosting: "shell" | "window"`, is
exposed by the adapter (`currentHosting()`) for tests and the troubleshooting
docs. `absent` stays inert. Api mode is untouched.

Timing: stock MEJ fires no handshake. `game.MonksEnhancedJournal` is assigned
inside MEJ's `init`. The shim installs from the existing `wireNativeMode()`
during the companion's `ready` handling, after `registerCore()`, before
`ensureSheetRegistrations()`.

## 4. The shim

### 4.1 Wrap targets

Four wraps. The survey's §5 ranks them; the exact stock locations are in its
§1–§3. Version note: 13.06's `addTab`/`open` are synchronous, 14.01's are
async; every wrapper returns exactly what the wrapped call returns.

| # | Target | Kind | Purpose |
|---|---|---|---|
| 1 | `game.MonksEnhancedJournal.getDocumentTypes` (static) | WRAPPER | Returns MEJ's map plus `session: SessionSheet` and `[HUB_PAGE_ID]: CampaignHubPage`. Opens the shell's demotion gate for single-page session entries (`renderSubSheet`, 13.06 `:430-441`), makes `getMEJType` recognise sessions, and stops `fixType` (`:4139-4141`) unsetting the session flag. |
| 2 | `EnhancedJournal.prototype.findEntity` | WRAPPER | Resolves `shellpage:${HUB_PAGE_ID}` to the Hub placeholder singleton; everything else falls through. Makes a persisted Hub tab re-resolvable after reload (`saveTabs`, `_preFirstRender`). |
| 3 | `EnhancedJournal.prototype.addTab` and `.open` | WRAPPER | For a Session page, skip the `if (entity?.parent)` parent swap (`:910-913`) so the page itself is the tab entity; for the Hub, match an existing tab by exact `entityId` rather than `includes(entity.id)` (`:1274`, `:1287`). |
| 4 | `EnhancedJournal.onConfigureSheet` (static) | MIXED | Return early when the shell's document is the Hub placeholder. Avoids the core `DocumentSheetConfig` crash on 14.01 and a meaningless MEJ sheet-config dialog on 13.06. Same wrapper on both versions. |

Installation: `EnhancedJournal` is exported from
`/modules/monks-enhanced-journal/apps/enhanced-journal.js`; the companion
imports it the same way it already imports `EnhancedJournalSheet.js`.
libWrapper only accepts paths under `globalThis`, so wrap 1 goes through the
existing libWrapper-or-manual helper (`scripts/logic/auto-capture.mjs`
`installShareImageWrap` pattern, generalised into `scripts/logic/mej-wraps.mjs`)
and wraps 2–4 use its manual branch (prototype/static replacement that keeps
the original for uninstall). All four are installed by one function,
`installShellShim()`, that returns `{ installed: string[], hosting }`.

Fallback: if any target is missing or any install throws, every wrap already
installed is uninstalled in reverse order, `hosting` becomes `"window"`, the
console gets one warning naming the failed target, and `openHub()` uses the
standalone window. No UI notification: the companion still works.

Not wrapped (survey §5 item 9 and §1g): `renderSubSheet`, `_getHeaderControls`,
`_renderPageView`, the shell's dead `get getDocumentTypes`, tab chrome,
`getIcon`, `getTypeLabels`.

### 4.2 Hub placeholder document

`HubShellDocument` in `scripts/apps/hub-window.mjs` already reproduces MEJ's
private `BlankJournal` (id, uuid, documentName, isOwner, compendium,
testUserPermission, permission, apps). It moves to
`scripts/apps/hub-shell-document.mjs` (both the window path and the shim use
it) and gains:

- `_getSheetClass()` returning `CampaignHubPage` — the load-bearing member the
  shell's subsheet selector reads (13.06 `apps/enhanced-journal.js:486`).
- `ownership = {}` so the OBSERVER write in `renderSubSheet` (`:466-473`) does
  not throw when `options.force` is set.
- `uuid` = `shellpage:${HUB_PAGE_ID}` and `id` = `HUB_PAGE_ID`, unique strings
  no real document id can contain, so `open`'s `includes(entity.id)` cannot
  match a real tab.
- `type` = `HUB_PAGE_ID` (already), which wrap 1 makes a known type so
  `fixType` sets `object.type` and does not call `unsetFlag` on the stub.

Known cosmetic consequence, accepted: MEJ's `updateRecent` records the Hub in
the user's recently-viewed flag because it only skips the literal `"blank"`
type (`:1292`). The sweep verifies nothing else reads that entry.

### 4.3 Opening the Hub and Sessions

`openHub()` in native mode with shell hosting mirrors the fork's
`openShellPage`: if `game.MonksEnhancedJournal.journal` is absent, create and
render `new EnhancedJournal()`; then `journal.open(hubDocument, newtab, options)`
with the singleton placeholder. In window hosting it calls `openHubWindow()`
as today.

Sessions need no companion-side open path: with wrap 1 the stock sidebar click
(`_onClickEntry` → `openJournalEntry` → `journal.open(entry)`) demotes a
single-page session entry to its page and the selector picks `SessionSheet`
directly. Multi-page entries containing a session page still render through
MEJ's `JournalEntrySheet` (same as api mode today) and keep `renderAwaitable`.

Flag heal: `healSessionFlags()` currently runs in api mode only. It runs in
native mode too, once at ready for the active GM, so sessions whose MEJ type
flag stock MEJ scrubbed on earlier opens are demoted again. Wrap 1 prevents
new scrubs.

New Session from the Hub: the Hub's create path already produces a session
page carrying the MEJ type flag and opens it; in shell hosting it opens through
`journal.open(page)` (wrap 3 keeps the page as the tab entity). The 14.01
native gate failure ("New Session never opens the Session sheet") is expected
to be resolved by this path; if the sweep shows a different cause, that cause
is fixed under this spec.

### 4.4 Correction to an existing comment

`scripts/sheets/awaitable-render.mjs` says later MEJ builds guard
`_renderPageView` with `if (!sheet.element) return;`. No build does (13.06,
14.01, fork all lack it; only fork commit 08ffca5 on the integration line adds
it). The comment is corrected; `renderAwaitable` stays mandatory on both stock
versions.

## 5. Defect fixes outside the shim

### 5.1 Hub open on Foundry 13 (window path)

`CONFIG.JournalEntryPage.sheetClasses[HUB_PAGE_ID]` is absent on 13.351 after
`registerHubSheetClass`. The first plan task diagnoses why (candidates: core
13's `registerSheet` validating `types` against declared document subtypes and
dropping unknown ones; `missingSheetRegistrations` reporting the hub present
because of a stale key; the repair running before `game.ready`). The fix goes
where the evidence points: the registration, the repair, or giving the
placeholder a type whose entry exists. Regression net: the v13 stock-gate test
"Hub opens from the scene-controls button" run with the shim disabled
(window hosting), plus the shell-hosting variant with it enabled.

### 5.2 Readability

Shell hosting removes the wrapper. The stock gate adds a contrast assertion:
for the session body text and the Hub index rows, computed `color` against the
nearest opaque ancestor background must reach WCAG AA contrast (4.5:1), under
`colorScheme.applications` = `"light"` and `"dark"` (client setting, set in
the test browser only). A pure helper `contrastRatio(fg, bg)` in
`scripts/logic/contrast.mjs` backs it. The stylesheet's hard-coded colours
(24 occurrences) are audited against that assertion; only the ones it catches
change, by switching to Foundry theme variables with the same fallbacks the
stylesheet already uses in its `.theme-dark` block.

### 5.3 Import finishes

In `ImportWizard#onCreate`'s retro-link pass and in `hooks/retro-link.mjs`'s
burst handler, each journal write runs in its own try/catch. A failed journal
is logged (`console.error`, module-prefixed, with the cause) and, for the
wizard, named in the import summary's warnings: "Could not update <journal>:
<cause>". The pass continues with the next journal; the import completes and
reports success for the created pages. No retry, no notification beyond the
summary.

## 6. Harness port and the v13 sweep

### 6.1 Harness

- The v13 module install (`~/FoundryVTT/Data/Data/modules/mej-campaign-companion`,
  today a copy of 0.19.3) becomes a symlink to the main checkout, the same
  arrangement as v14. The deploy helper's symlink pin and verification learn
  the v13 data dir from `TARGET`.
- `env-lock` keys its lock on the target's data dir (already parameterised);
  the v13 lock dir is documented.
- `FOUNDRY_TARGET=v13` runs the whole suite, not just the stock smoke: the
  `setup` project and auth-state files are per target; v14-only phases
  (`returnToSetup`, `createWorld`) stay skipped through the existing
  generation check; the console ignore list carries the v13 compute-pressure
  policy noise already listed.
- World-b is the v13 world. It holds a copy of the user's campaign data
  (Radiant Citadel by name, 34 sessions); fixtures keep the `TT-` prefix and
  clean up as on v14.
- dnd5e 5.3.3 differences that break a spec are attributed (platform), not
  patched around in the spec.

### 6.2 Sweep procedure

Same as the 14.01 sweep (`…/2026-09-19-mej-14.01-rebase-sweep-design.md` §4–5):

1. Back up world-b to `~/FoundryVTT/backups/world-b-pre-v13-sweep-<date>`.
   Delete the two hidden campaign-record pages from the legacy journal (by id,
   through the console or a probe script). Record both in the report.
2. Run 1: full suite, `FOUNDRY_TARGET=v13`, native mode with shell hosting.
   `--trace off`, JSON report, summarised with `summarize-run.mjs`.
3. Rerun failures once; a pass on rerun is `flake`.
4. Attribute each remaining failure to exactly one of: `platform` (Foundry
   13.351 or dnd5e 5.3.3), `mej-13.06`, `shim`, `companion`, `harness`. The
   method is inspection first, then a swap where separable (shim disabled →
   window hosting; the same spec on v14 fork api mode as the reference).
5. Fix `shim`, `companion` and `harness` rows in this project, each with its
   own test. `mej-13.06` rows become upstream issues (or fork backlog items if
   they are already fixed on the fork line). `platform` rows are documented.
6. Report: `docs/superpowers/triage/<date>-v13-companion-sweep.md`, same
   table columns as the 14.01 report (spec, test, line, class, evidence,
   action, owner).

### 6.3 Release gates

- Stock gate on MEJ 13.06 (Foundry 13, world-b), native mode, shell hosting.
- Stock gate on MEJ 14.01 (Foundry 14, world-a, module worktree at tag 14.01),
  native mode, shell hosting. Both gates include New Session from the Hub.
- Full api-mode suite on the fork line (world-a) at or above its current pass
  count.

## 7. Testing

Unit (vitest, `test/`):
- `mej-wraps`: install/uninstall over a fake surface; a missing target
  uninstalls the ones already installed and reports `hosting: "window"`;
  wrappers return a promise when the wrapped call does and a plain value when
  it does not.
- `getDocumentTypes` wrapper adds exactly the two types and does not mutate
  MEJ's object.
- `findEntity` wrapper resolves the `shellpage:` id and passes everything else
  through.
- `addTab`/`open` wrappers: a session page is not swapped for its parent; the
  Hub matches only a tab with the exact entityId.
- Retro-link guard: one throwing journal write, the rest land, the summary
  names the failed journal.
- `contrastRatio` on known pairs (black/white 21:1; the two colours observed
  in the defect, which must fail 4.5:1).

E2E (`tests/e2e/13-stock-smoke.spec.mjs`, both stock builds):
- Hub opens from the scene controls as a shell tab (`hosting === "shell"`,
  `journal.rendered`, subsheet is `CampaignHubPage`).
- New Session opens the SessionSheet as the shell subsheet.
- Sidebar-opened session: subsheet is `SessionSheet`, no `.journal-entry-pages`
  ancestor, contrast passes under light and dark schemes.
- Hub tab survives a reload (persisted tab re-resolves).
- Shim disabled through a test-only client setting → `hosting === "window"`,
  Hub opens as a window, session opens without errors.
- Existing boot, search and cleanup tests stay.

The full suite on Foundry 13 is the discovery instrument, not a gate.

## 8. Docs and release

- README: native-mode section and the Foundry 13 row of the mode table
  describe shell hosting, the window fallback and when it triggers
  (troubleshooting lists the console warning). The two dated MEJ 14.01
  known-issue sentences come out and `module.json` regains
  `relationships.requires[MEJ].compatibility.verified: "14.01"`, both only
  when the 14.01 stock gate passes. `tests/e2e/README.md` gains the v13
  full-suite recipe and the world-b cleanup note.
- CHANGELOG 0.20.0, house style: one-line intro; **Added:** shell hosting in
  native mode; **Fixed:** Hub open on Foundry 13, readable sessions, import
  completion; **Changed:** harness runs the full suite on Foundry 13.
- Release ceremony as for 0.19.3 (release commit, merge PR, annotated tag,
  zip with the standard file list, GitHub release, manifest check, World A
  restart, worktree removal). The sweep report ends with the list of upstream
  issues to file.

## 9. Risks and follow-ups

- The shim depends on MEJ internals that have been stable from 13.06 through
  14.01. A future MEJ release that renames a target degrades to window
  hosting with a warning rather than breaking; the stock gate on the newest
  MEJ is the early warning.
- Wrap 1 widens what MEJ "knows": the create-page dialog, compendium
  thumbnails and the type icon lookup will see the two types, and MEJ will
  request `assets/session.png` (the known 404 already ignored by the api-mode
  suite). The sweep checks these surfaces on both stock builds.
- If the sweep attributes the 14.01 New Session failure to something other
  than hosting, it is fixed here; the `verified: "14.01"` claim stays out until
  the gate passes.
- Follow-ups recorded in the sweep report: upstream issues for MEJ 13.06
  defects; harness items surfaced on v13.

## 10. Amendments (plan-writing, 2026-09-19)

- **A1 — wrap 3 withdrawn.** With wrap 1 in place a single-page session entry
  passes the shell's demotion gate, so MEJ's own `addTab` parent swap ends
  where it should (the page becomes the tab entity and `SessionSheet` the
  subsheet), exactly as for MEJ's built-in types. The Hub placeholder's uuid
  `shellpage:campaign-hub` contains no "." and no real document id, so
  `open`'s `includes(entity.id)` matches only the Hub's own tab. The shim
  therefore installs three wraps (`getDocumentTypes`, `findEntity`,
  `onConfigureSheet`); §4.1's row 3 and §7's `addTab`/`open` unit test do not
  apply.
- **A2 — import already completes.** `processBurst` in `hooks/retro-link.mjs`
  already catches each page write. What the user saw is its "Auto-link could
  not write N page(s)" error notification, shown only when no page was
  written; partial failures are silent. §5.3 becomes: the retro-link report
  names each failed journal once with the first line of the cause, is shown
  as a warning after the success message when some pages were written, and
  as an error when none were. No change to the wizard's own flow.
