# Running Without the MEJ Extension API — Design

**Date:** 2026-08-17
**Status:** Approved (brainstorm decisions 2026-08-17)
**Ships as:** mej-campaign-companion 0.5.0

## Problem

The companion currently requires a Monk's Enhanced Journal build that carries
the extension API (`setupMonksEnhancedJournal`, `registerSheetType`,
`registerShellPage`). That API exists only on this author's fork
(`integration-14.07`+); the upstream PR is unopened. Against a stock MEJ
install the handshake hook never fires, so
`scripts/campaign-companion.mjs`'s entire `setupMonksEnhancedJournal` handler
never runs — and that handler registers **everything**, not just the two
API-dependent surfaces. On stock MEJ the module is inert: no search index, no
auto-link, no retro-link, no encounter capture, no knowledge panel, no query
enricher, no secrets UI, no relationship reveals, no Hub, no Session sheet.

**Goal:** the companion works on either MEJ build, transparently — a world can
move between stock MEJ and API-enabled MEJ with no data migration and no
behavior surprises, degrading only where the missing API makes a surface
genuinely impossible.

Not in scope: running with MEJ absent entirely. MEJ remains a hard dependency
(the companion reads MEJ entity flags, extends `EnhancedJournalSheet`, and its
whole domain model is MEJ entries). "Without the API" ≠ "without MEJ".

## Analysis — what actually depends on the API

Two distinct dependency classes, discovered by auditing every MEJ touchpoint:

**1. Bootstrap coupling (accidental).** Roughly 80% of the module needs
nothing from the API — it needs only Foundry hooks and MEJ's presence. It is
dark on stock MEJ purely because its registration calls sit inside the
handshake handler. Fixing this is a code-motion change with no behavioral
risk: `initSearchHooks`, `registerAutoLink`, `registerRetroLink`,
`registerAutoCapture`, `registerKnowledgePanel`, `registerQueryEnricher`,
`registerSecretsUi`, `registerRelationshipsUi`.

**2. Genuine API dependency (two surfaces).**

- **Session sheet** — `api.registerSheetType` registers `SessionSheet` and
  merges `session` into MEJ's type registry, its New Entry dialog, its type
  labels/icons, and its relationship targets.
- **Campaign Hub** — `api.registerShellPage` plus MEJ-side `shellpage:<id>`
  tab machinery (12+ touchpoints in `apps/enhanced-journal.js`) makes the Hub
  a tab inside MEJ's shell.

**3. The type-registry trap (the load-bearing discovery).** The companion
routes type detection through `game.MonksEnhancedJournal.getMEJType(doc)` at
**16 direct call sites across 11 files** — plus two pure modules
(`logic/hub-index.mjs`, `logic/doc-export-snapshot.mjs`) that receive it as an
injected parameter — covering the search index, auto-link candidate selection,
retro-link candidacy, Hub index, graph, export eligibility,
knowledge/secrets/relationships UI gating, and the import wizard. Stock MEJ *has*
`getMEJType`, so those calls do not throw — but its implementation validates
the flag against `getDocumentTypes()`, which on stock contains no `session`
key. Therefore on stock MEJ **`getMEJType()` returns `false` for every Session
page**, and sessions silently vanish from search, linking, the Hub index,
export, and the graph.

The same registry gap makes stock `fixType()` take its
`else if (game.user.isGM) object.unsetFlag("monks-enhanced-journal", "type")`
branch, so stock MEJ actively *scrubs* the MEJ type flag off Session pages the
first time a GM opens one. Both problems have one root cause and one fix
(below): stop treating the MEJ flag as the truth for Session identity.

**4. What stock MEJ still gives us (verified against stock source).**

- `getMEJType` exists (`monks-enhanced-journal.js:191`) and works correctly
  for all built-in types the companion creates (person, place, quest, …).
- The `activateControls` hook fires (`apps/enhanced-journal.js:751`), so the
  companion's existing toolbar button works in both modes.
- `sheets/EnhancedJournalSheet.js` exists and is importable by URL — the
  base class both companion sheets extend.
- MEJ itself renders subsheets standalone via alt-open —
  `document.sheet.render(true)` (`apps/enhanced-journal.js:1045-1051`) —
  proving `EnhancedJournalSheet` subclasses work outside the shell through
  Foundry's normal render path.
- Foundry module-declared subtypes (`module.json` →
  `documentTypes.JournalEntryPage.session`) are pure core Foundry: the real
  runtime type `mej-campaign-companion.session` is registered by Foundry
  itself, independent of MEJ. Nothing can scrub it.

## Decisions (locked)

| # | Question | Decision |
|---|----------|----------|
| 1 | Compatibility floor | **Either MEJ build, transparently** — stock and API-enabled; MEJ itself still required |
| 2 | Fallback UX | **Standalone windows** — no monkey-patching of stock MEJ internals |
| 3 | Session identity | **Native page type is the source of truth**, with API-mode flag self-heal |
| 4 | Architecture | **Adapter seam + mini-shell host** — one mode-independent core, one file that knows the mode |

## Architecture

### Mode resolution

New `scripts/integrations/mej-adapter.mjs` — the single module that knows
which MEJ is present. It resolves exactly one mode:

| Mode | Condition | Behavior |
|------|-----------|----------|
| `api` | `setupMonksEnhancedJournal` fired | Shell-integrated Session sheet + Hub tab (today's behavior, unchanged) |
| `native` | Hook never fired by `ready`, and `game.modules.get("monks-enhanced-journal")?.active` | Core features + standalone Session sheet and Hub window |
| `absent` | MEJ not active | Module stays inert; existing GM warning, unchanged |

Resolution is race-free by construction: MEJ fires the handshake during its
own `init`, long before `ready`, so a `ready`-time check of "did the handshake
run?" is definitive. The adapter logs the resolved mode once
(`console.log`, module-prefixed). **Native mode produces no GM-facing
warning** — it is a supported configuration, not an error. The existing
warning is retained only for `absent` and for "handshake fired but wiring
threw" (today's `apiSetupThrew` case).

A hidden client-scope setting `forceNativeMode` (default false) makes the
adapter ignore a received API. This exists so e2e can exercise native mode on
the API-enabled fork that backs the test world; it is also a user-visible
escape hatch if shell integration ever misbehaves.

### Bootstrap split

`scripts/campaign-companion.mjs`'s handshake body dissolves into three pieces:

- **`registerCore()`** — the eight dependency-class-1 registrations above.
  Idempotent behind a module-level `coreRegistered` guard, called by whichever
  mode path wins. This single change restores ~80% of the module on stock MEJ
  with zero behavioral difference between modes.
- **`wireApiMode(api)`** — today's `registerSheetType` /
  `registerShellPage` / `DocumentSheetConfig.registerSheet` workaround block,
  moved verbatim.
- **`wireNativeMode()`** — the fallback surfaces (below).

The deferred-dynamic-import discipline documented at
`campaign-companion.mjs:122-142` (the alphabetical script-order race that
would otherwise abort MEJ's own module evaluation) is preserved in both paths:
`api` mode imports inside the handshake as today; `native` mode imports at
`ready`, by which point MEJ's scripts finished long ago. Each wiring step is
individually try/caught so one failure cannot darken the rest — the observer
posture used everywhere else in this module.

### Session identity: native type as truth

New pure helper (`scripts/logic/mej-type.mjs`) plus its adapter binding:

```
isSessionDoc(doc)   // page.type === "mej-campaign-companion.session",
                    // or, for a JournalEntry, its first/only page
mejType(doc)        // isSessionDoc(doc) ? "session"
                    //                   : (game.MonksEnhancedJournal?.getMEJType?.(doc) || false)
```

`mejType` matches `getMEJType`'s existing contract exactly (accepts either a
`JournalEntry` or a `JournalEntryPage`; returns the short type key or
`false`), so it is a drop-in replacement at all 16 call sites. The two pure
modules (`buildIndexSource`, `eligibleEntries`) need no internal change at
all — only their callers switch which function they inject.

Consequences:

- Session pages are first-class in search, auto-link, retro-link, Hub index,
  graph, and export **in both modes**.
- Stock MEJ scrubbing the MEJ type flag becomes harmless: nothing
  companion-side reads it for Session identity any more.
- Creation still stamps `flags["monks-enhanced-journal"].type = "session"` in
  both modes, because API-mode MEJ needs it for shell routing.
- **Self-heal:** in `api` mode only, the active GM runs a `ready`-time sweep
  that re-stamps that flag on Session pages missing it (i.e. pages that took a
  round trip through a stock MEJ install). One `update` per affected page, GM
  only, silent. This is what makes moving between builds transparent.

### Native-mode surfaces

**Session sheet.** `SessionSheet` stays single-source and needs **no code
change at all**. Verified against MEJ source: `EnhancedJournalSheet._onRender`
(`sheets/EnhancedJournalSheet.js:702-703`) already ends with
`await this.activateListeners(this.trueElement)` and
`await this.subRender(context, options)`, and `trueElement`
(`EnhancedJournalSheet.js:158-162`) returns `this.enhancedjournal
? this.enhancedjournal.subsheetElement : this.element` — so with no shell
present it resolves to the window's own element. The base class is already
built for both hosts; MEJ's own alt-open path (`document.sheet.render(true)`,
`apps/enhanced-journal.js:1045-1051`) exercises exactly this. `wireNativeMode`
therefore only registers the sheet through plain core Foundry:

```
foundry.applications.apps.DocumentSheetConfig.registerSheet(
  JournalEntryPage, MODULE_ID, SessionSheet,
  { types: [SESSION_DOCUMENT_TYPE], makeDefault: true,
    label: `${I18N}.sheettype.session` })
```

No MEJ involvement — the subtype is declared in `module.json`. Opening a
Session from the journal directory then works normally.

**Campaign Hub.** New `scripts/apps/hub-window.mjs`, which supplies a stub
document and renders `CampaignHubPage` as its own window with a plain
`render(true)` — no manual driving of the render pipeline. The Hub needs no
real document: even in `api` mode its `document` is MEJ's ephemeral
`BlankJournal` placeholder and all Hub state lives on the module-level
`HUB_STATE` object (`CampaignHubPage.mjs:1-15`). `BlankJournal` is not
exported, so the companion defines an equivalent: a `foundry.abstract.Document`
subclass with the same `defineSchema()` fields (`name`, `type`, `content`,
`options{hidebuttons,position,window}`, `flags`) and the same overrides
(`id`, `uuid`, `documentName`, `isOwner`, `compendium`, `testUserPermission`),
plus `apps = {}` for `_onFirstRender`.

**Verified live** (World A, 2026-08-17, GM client): this exact construction
renders the full Hub standalone — all five tabs present, 15 index rows, 49
`data-action` controls, and clicking the Timeline tab switched the active tab,
proving `activateListeners` bound through the inherited `_onRender`. Two
observations from that probe: `trueElement` correctly resolved to the window
element, and the template's outer `<div class="mej-cc-hub">` is stripped by
Foundry's `root: true` part handling **in both modes** (the shell's subsheet
first child is `.flexcol.journal-subsheet` too) — so the standalone window is
already at style parity with the shell, and no styling work is in scope. Those
`.mej-cc-hub` CSS rules are pre-existing dead selectors in both modes; leave
them alone.

The native Hub also needs the same
`DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID,
CampaignHubPage, { types: [HUB_PAGE_ID], ... })` call `api` mode already
makes — it is what keeps `getSheetThemeForDocument`'s
`CONFIG.JournalEntryPage.sheetClasses[type]` lookup from throwing, and that
requirement is mode-independent (see the long comment at
`campaign-companion.mjs:164-190`).

**Entry points (both modes).** The existing `activateControls` toolbar button
(stock MEJ fires that hook) plus a journal-directory header button, so the Hub
is reachable even when MEJ's shell is closed. Both call the adapter's
`openHub()`, which routes to `MonksEnhancedJournal.openShellPage(HUB_PAGE_ID)`
in `api` mode or renders the host window in `native` mode.

**Session creation.** A "New Session" button in the Hub header, present in
both modes for UI uniformity. It uses the companion's existing creation path,
so `playersWriteSessions` ownership behavior is identical in both modes and
the `preCreateJournalEntry` ownership hook is untouched.

### Accepted degradations in native mode

Documented in README, not engineered around:

- Session does not appear in MEJ's New Entry dialog (the Hub's "New Session"
  button is the creation path).
- Session pages cannot be MEJ **relationship** targets (MEJ's relationship
  picker enumerates its own registry). Companion-side relationship features
  are unaffected.
- The Hub is a standalone window, not a tab in MEJ's shell.
- No MEJ per-type theming or icon for Session pages; no shell subsheet
  part-state preservation — the same limitations API.md already documents for
  shell pages.
- The "open graph" and "prep board" **header buttons** are absent: they are
  injected via `getDocumentSheetHeaderButtons`, which only MEJ's shell fires
  (`campaign-companion.mjs:269`). Both features stay reachable — the graph
  from the Hub's own toolbar (`CampaignHubPage.onOpenGraph`) and the prep
  board from the Session sheet's own `openPrepBoard` action
  (`SessionSheet.mjs:47`) — so no replacement UI is in scope.

## Data flow

```
Foundry init
  └─ settings registered (unchanged) + forceNativeMode
MEJ init ──fires──> setupMonksEnhancedJournal ──> adapter: mode = "api"
                                                   registerCore(); wireApiMode(api)
Foundry ready
  └─ adapter: if no mode yet
       ├─ MEJ active   → mode = "native"; registerCore(); wireNativeMode()
       └─ MEJ inactive → mode = "absent";  GM warning
  └─ api mode only: activeGM flag self-heal sweep
```

## Error handling

Unchanged observer posture: every wiring step and the heal sweep are
individually try/caught, log via `console.error` with the module prefix, and
never block Foundry startup or a user action. A native-mode wiring failure
leaves core features running.

## Testing

**Unit (vitest, pure logic only):**

- `mej-type`: `isSessionDoc` for page/entry/null/foreign-type inputs;
  `mejType` delegation, session short-circuit, and `false` passthrough —
  including the stock-MEJ case where the injected `getMEJType` returns `false`
  for a Session page.
- Mode resolution: given (handshake fired?, MEJ active?, forceNativeMode?) →
  expected mode, all eight combinations.
- Heal planner: given Session pages with/without the MEJ flag, which need
  re-stamping (pure list → list, no Foundry).

**E2e (Playwright, existing harness):**

1. **Forced-native boot** — set `forceNativeMode`, reload: core features live
   (auto-link fires on typing, search index returns hits, knowledge panel
   renders); Hub opens as a standalone window from the toolbar button; a
   Session page opens standalone from the directory with working listeners.
2. **Session first-classness in native mode** — a Session appears in Hub
   index, search results, and auto-link candidates (the regression the
   `getMEJType` trap would otherwise cause).
3. **Flag self-heal** — strip a Session's MEJ type flag, reload in `api` mode,
   assert the sweep restored it and the page routes into the shell.
4. **API mode unchanged** — the existing 39 e2e must stay green.

**Manual, once before release:** boot a real stock upstream MEJ checkout
(symlink swap, per the test-env pattern) and confirm mode resolution, Hub
window, Session sheet, and that a Session survives a stock→fork round trip.
This is the only check the fork-based harness cannot fully substitute for.

## Non-goals

- Running with MEJ absent entirely (MEJ stays a hard dependency).
- Monkey-patching or libWrapper-ing stock MEJ internals (`getDocumentTypes`,
  `fixType`, the shell tab machinery). Explicitly rejected: it would couple
  the companion to MEJ internals that change every release.
- Re-implementing MEJ's shell tab system in native mode.
- Changing the MEJ fork or the (still unopened) upstream API PR. This work
  makes that PR optional, not unnecessary.
- Migrating existing worlds' data. The native page type is already correct on
  every Session ever created; only the MEJ convenience flag is at issue, and
  the heal sweep handles it.
