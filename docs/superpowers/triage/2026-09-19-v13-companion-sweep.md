# Companion sweep on Foundry 13.351, dnd5e 5.3.3, stock MEJ 13.06 — 2026-09-19

Spec: `docs/superpowers/specs/2026-09-19-native-shell-shim-and-v13-sweep-design.md`
(Task 8). Companion branch `feat/native-shell-shim`, native mode with shell
hosting — the configuration the shim exists to support.

This is the first time the whole e2e suite has run against a **genuinely stock**
Monk's Enhanced Journal. Every previous full run has been on the fork line with
the extension API; `13-stock-smoke.spec.mjs` was the only stock coverage there
has ever been, and it is a five-test smoke, not 120 tests.

## Stack

| Component | Version | Note |
|---|---|---|
| Foundry VTT | 13.351 | app dir `~/FoundryVTT/FoundryVTT-Node-13.351`, port 30013 |
| System | dnd5e 5.3.3 | |
| World | `world-b` | the sweep's world; `world-a` on this install is the user's own campaign and is touched only by Step 1 below |
| MEJ | **stock 13.06** | `~/FoundryVTT/Data/Data/modules/monks-enhanced-journal`, a real directory, not a worktree — no extension API, never fires `setupMonksEnhancedJournal` |
| Companion | `feat/native-shell-shim` @ `790dd6e` for runs 1–2, `22dd94d` for run 3 | 0.19.3 runtime + the shim |
| Mode / hosting | `native` / `shell` | confirmed live per run (`adapter.currentMode()` / `currentHosting()`) |
| Other active modules | lib-wrapper, campaign-record, omnipresence, monks-active-tiles, levels, … | world-b is a real, module-rich world; omnipresence's login reconcile shows up in probe traces and is unrelated |

Foundry 14 on port 30000 was never touched.

## Environment prep

### Step 1 — the two hidden legacy pages (world-a, not world-b)

`JournalEntry.35nbnYCykPtnCxC5` ("Radiant Citadel") in the **v13 `world-a`**
carried two `JournalEntryPage`s whose types belong to `campaign-record`, a
module no longer installed on this Foundry. Foundry 13 cannot initialise them,
so they were invisible in the UI and logged two
`Failed to initialize JournalEntryPage` errors at every single boot.

Backup, taken with the server stopped (the pre-existing
`world-a-pre-v13-sweep-2026-09-19` predates a later revert and was not relied
on):

```
~/FoundryVTT/backups/world-a-pre-hidden-page-delete-2026-09-19    48M
```

Probe: `tests/e2e/probes/delete-legacy-pages.mjs` (logs in as Gamemaster, never
calls `ensureTestWorld()`, creates nothing).

Before:

| page id | type | name |
|---|---|---|
| `5lWsbyRFL9snEuAa` | `campaign-record.place` | Coral Cave Ruins |
| `K2NpTyaFYRfOasAW` | `campaign-record.media` | Picture |

`pages.size` 35, `_source.pages.length` 37, `invalidDocumentIds` exactly those
two, and both boot errors captured verbatim, e.g.

```
Error: Failed to initialize JournalEntryPage [JournalEntry.35nbnYCykPtnCxC5.JournalEntryPage.5lWsbyRFL9snEuAa]:
JournalEntryPage5e [5lWsbyRFL9snEuAa] validation errors:
  type: "campaign-record.place" is not a valid type for the JournalEntryPage Document class
    at EmbeddedCollection._handleInvalidDocument (…/scripts/foundry.mjs:5786:19)
```

Deletion: plain `entry.deleteEmbeddedDocuments("JournalEntryPage", ids)`
succeeded on 13.351 — the `getInvalid(id).delete()` fallback was not needed.
(The `remaining` array read immediately afterwards still listed both ids: the
embedded collection had not re-initialised yet within the same tick. The
post-reload read is the authoritative one.)

After a full reload:

| | value |
|---|---|
| `pages.size` | 35 |
| `_source.pages.length` | **35** (was 37) |
| `invalidDocumentIds` | `[]` |
| `Failed to initialize JournalEntryPage` at boot | **none** |

No other change was made to `world-a`, and no fixture was created there.

### The sweep's own world

Runs 1–3 are on `world-b`; `npm run e2e:v13`'s global setup switches the server
itself. Three environment facts turned out to matter enough that global setup
now asserts two of them — see fixes 2 and 4.

## Run 1 — full suite, before any fix

```
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/run1.json npm run e2e:v13 -- --reporter=list,json
node tests/e2e/helpers/summarize-run.mjs $OUT/run1.json "v13 run 1"
```

| Spec | passed | failed | skipped |
|---|---|---|---|
| 00-mej-api.spec.mjs | 0 | 2 | 0 |
| 01-session.spec.mjs | 0 | 7 | 0 |
| 02-hub-timeline.spec.mjs | 2 | 3 | 0 |
| 03-search.spec.mjs | 2 | 2 | 0 |
| 04-auto-capture.spec.mjs | 2 | 0 | 0 |
| 05-docx-import.spec.mjs | 1 | 0 | 0 |
| 06-player-collab.spec.mjs | 1 | 7 | 0 |
| 07-knowledge.spec.mjs | 6 | 2 | 0 |
| 08-query-graph.spec.mjs | 5 | 4 | 0 |
| 09-secrets.spec.mjs | 6 | 8 | 0 |
| 10-secrets-hub.spec.mjs | 1 | 2 | 0 |
| 11-auto-link-scope.spec.mjs | 9 | 0 | 0 |
| 12-native-mode.spec.mjs | 5 | 1 | 0 |
| 13-stock-smoke.spec.mjs | 0 | 0 | 13 |
| 14-campaigns.spec.mjs | 1 | 2 | 11 |
| 15-campaign-portal.spec.mjs | 4 | 3 | 0 |
| 16-multi-timeline.spec.mjs | 0 | 1 | 7 |
| 17-media-routing.spec.mjs | 3 | 1 | 1 |
| 18-harness-cleanup.spec.mjs | 3 | 0 | 0 |
| 19-reveal-migration.spec.mjs | 2 | 0 | 0 |
| 20-timeline-journal-open.spec.mjs | 1 | 1 | 5 |
| 21-players-write-sessions.spec.mjs | 1 | 0 | 0 |
| 22-auto-link-sessions.spec.mjs | 3 | 0 | 0 |
| 23-campaign-creation.spec.mjs | 10 | 0 | 0 |
| auth.setup.mjs | 3 | 0 | 0 |
| guide-screenshots.spec.mjs | 0 | 0 | 4 |
| **total (v13 run 1)** | 71 | 46 | 41 |

Failures:
- `00-mej-api.spec.mjs:15` "registers the session type; person/shop/session entries open with their MEJ sheets" — Error: expect(received).toEqual(expected) // deep equality
- `00-mej-api.spec.mjs:103` "fixType foreign-subtype guard: a session page's MEJ type flag survives a GM reload while the companion is disabled" — Error: expect(received).toBe(expected) // Object.is equality
- `01-session.spec.mjs:57` "create via New Entry dialog gets the prefixed subtype + MEJ flag (fix 1437846)" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:88` "sessionNumber, campaignDate, and a secret persist across a GM reload" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:166` "recap editor: header edit button opens it, and the base-class editor context menu doesn't error (smoke)" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:196` "relationship drag: linking a person entry to a session shows up on both sheets" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:231` "player client: gmNotes tab is absent from the DOM, unrevealed secrets are not sent" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:308` "a fresh Session sheet renders no schema-labelled header rows, and keeps rename + add-image in a compact row" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:406` "an image-bearing Session renders MEJ's header with zero schema rows" — Error: expect(locator).toHaveText(expected) failed
- `02-hub-timeline.spec.mjs:155` "timepoint CRUD and drag-reorder" — Error: expect(received).not.toContain(expected) // indexOf
- `02-hub-timeline.spec.mjs:215` "dropping a person entry and an image onto a timepoint" — Error: expect(received).not.toContain(expected) // indexOf
- `02-hub-timeline.spec.mjs:288` "index row click opens the entry in MEJ; player sees no CRUD and no GM-hidden image links" — Error: expect(received).not.toContain(expected) // indexOf
- `03-search.spec.mjs:78` "GM-only content (session gmNotes) is found by GM, not by player" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `03-search.spec.mjs:175` "marking a person attribute playerHidden re-indexes, so a player stops finding it" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:147` "an owning player edits the shared recap; it persists to system.recap and every seat reads it" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:205` "a non-owner player sees the recap read-only: no pencil, disabled editor, drops ignored" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:231` "two owners edit at once: both sentences persist (collaborative editor, not last-writer-wins)" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:264` "relayed image: an owning player without FILES_UPLOAD drops an image, the GM relays it, it lands in the shared recap" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:288` "a viewer's open session refreshes when another owner saves the recap" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:328` "GM notes commit on pencil close" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:366` "recap survives closing the shell with the editor open" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `07-knowledge.spec.mjs:185` "attributes: playerHidden values never leak to a player, in the panel or in search" — Error: expect(locator).toHaveCount(expected) failed
- `07-knowledge.spec.mjs:417` "backlink permission leak: a GM-only mentioning entry never appears in a player's Mentioned-in list" — Error: expect(locator).toHaveCount(expected) failed
- `08-query-graph.spec.mjs:137` "dashboard CRUD + rendering, hidden/shown per showPlayers" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `08-query-graph.spec.mjs:346` "graph hidden-relationship gate: GM sees the edge, player does not" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `08-query-graph.spec.mjs:390` "graph tab is campaign-scoped: member nodes only, All shows the world" — Error: unexpected console errors:
- `08-query-graph.spec.mjs:431` "entity header button lands on the Graph tab, scoped and ego-centered" — Error: unexpected console errors:
- `09-secrets.spec.mjs:124` "GM reveals a block to User 1: A sees block + whisper, User 2 sees neither" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:238` "group reveal follows live membership" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:528` "a recap secret gets a GM audience control on the sheet" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:590` "the Hub tracker offers the audience control on a recap-sourced secret" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:707` "a recap-sourced secret can be revealed and reaches the player" — Error: expect(locator).toHaveCount(expected) failed
- `09-secrets.spec.mjs:773` "a player never gets core's Hide toggle on secrets the companion re-rendered for them; the GM still does" — Error: expect(received).toEqual(expected) // deep equality
- `09-secrets.spec.mjs:970` "duplicate section id on two pages: reveal from page 2 touches only page 2" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:1029` "opening page 1 (a Session page) prunes only page 1's stale reveal records, leaving page 2 untouched" — Error: expect(locator).toContainText(expected) failed
- `10-secrets-hub.spec.mjs:130` "prep board shows attendee names, not just portraits" — Error: unexpected console errors:
- `10-secrets-hub.spec.mjs:167` "tracker lists a duplicate id once per page and acts on the right page" — Error: unexpected console errors:
- `12-native-mode.spec.mjs:215` "api mode still resolves when forceNativeMode is off" — Error: expect(received).toBe(expected) // Object.is equality
- `14-campaigns.spec.mjs:294` "zero-campaign world: the filing and capture controls are disabled, and say why" — Error: unexpected console errors:
- `14-campaigns.spec.mjs:387` "1. create campaign: picker contains it, and scoping persists across a real Hub re-open" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:202` "3. deleting the portal leaves the campaign; restore recreates it (and never touches the ownership baseline)" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:304` "5. portals are absent from Hub index rows in every scope" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:402` "7. player seat: portal opens the scoped read view; no restore control" — Error: expect(locator).toBeVisible() failed
- `16-multi-timeline.spec.mjs:162` "1. second timeline in a campaign: picker switches panes" — Error: unexpected console errors:
- `17-media-routing.spec.mjs:460` "4. media entries get their own Hub index rows and filter chips" — Error: unexpected console errors:
- `20-timeline-journal-open.spec.mjs:112` "2. api mode: sidebar click opens the Hub on that timeline, no journal editor" — Error: expect(received).toBe(expected) // Object.is equality

## Run 2 — isolated rerun of run 1's failures

```
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/run2.json FOUNDRY_TARGET=v13 \
  npx playwright test --trace off --reporter=list,json --last-failed
```

| Spec | passed | failed | skipped |
|---|---|---|---|
| 00-mej-api.spec.mjs | 0 | 2 | 0 |
| 01-session.spec.mjs | 0 | 7 | 0 |
| 02-hub-timeline.spec.mjs | 0 | 3 | 0 |
| 03-search.spec.mjs | 0 | 2 | 0 |
| 06-player-collab.spec.mjs | 0 | 7 | 0 |
| 07-knowledge.spec.mjs | 0 | 2 | 0 |
| 08-query-graph.spec.mjs | 0 | 4 | 0 |
| 09-secrets.spec.mjs | 1 | 7 | 0 |
| 10-secrets-hub.spec.mjs | 0 | 2 | 0 |
| 12-native-mode.spec.mjs | 0 | 1 | 0 |
| 14-campaigns.spec.mjs | 0 | 2 | 0 |
| 15-campaign-portal.spec.mjs | 0 | 3 | 0 |
| 16-multi-timeline.spec.mjs | 0 | 1 | 0 |
| 17-media-routing.spec.mjs | 0 | 1 | 0 |
| 20-timeline-journal-open.spec.mjs | 0 | 1 | 0 |
| auth.setup.mjs | 3 | 0 | 0 |
| **total (v13 run 2 (rerun))** | 4 | 45 | 0 |

Failures:
- `00-mej-api.spec.mjs:15` "registers the session type; person/shop/session entries open with their MEJ sheets" — Error: expect(received).toEqual(expected) // deep equality
- `00-mej-api.spec.mjs:103` "fixType foreign-subtype guard: a session page's MEJ type flag survives a GM reload while the companion is disabled" — Error: expect(received).toBe(expected) // Object.is equality
- `01-session.spec.mjs:57` "create via New Entry dialog gets the prefixed subtype + MEJ flag (fix 1437846)" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:88` "sessionNumber, campaignDate, and a secret persist across a GM reload" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:166` "recap editor: header edit button opens it, and the base-class editor context menu doesn't error (smoke)" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:196` "relationship drag: linking a person entry to a session shows up on both sheets" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:231` "player client: gmNotes tab is absent from the DOM, unrevealed secrets are not sent" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:308` "a fresh Session sheet renders no schema-labelled header rows, and keeps rename + add-image in a compact row" — Error: expect(locator).toHaveText(expected) failed
- `01-session.spec.mjs:406` "an image-bearing Session renders MEJ's header with zero schema rows" — Error: expect(locator).toHaveText(expected) failed
- `02-hub-timeline.spec.mjs:155` "timepoint CRUD and drag-reorder" — Error: expect(received).not.toContain(expected) // indexOf
- `02-hub-timeline.spec.mjs:215` "dropping a person entry and an image onto a timepoint" — Error: expect(received).not.toContain(expected) // indexOf
- `02-hub-timeline.spec.mjs:288` "index row click opens the entry in MEJ; player sees no CRUD and no GM-hidden image links" — Error: expect(received).not.toContain(expected) // indexOf
- `03-search.spec.mjs:78` "GM-only content (session gmNotes) is found by GM, not by player" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `03-search.spec.mjs:175` "marking a person attribute playerHidden re-indexes, so a player stops finding it" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:147` "an owning player edits the shared recap; it persists to system.recap and every seat reads it" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:205` "a non-owner player sees the recap read-only: no pencil, disabled editor, drops ignored" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:231` "two owners edit at once: both sentences persist (collaborative editor, not last-writer-wins)" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:264` "relayed image: an owning player without FILES_UPLOAD drops an image, the GM relays it, it lands in the shared recap" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:288` "a viewer's open session refreshes when another owner saves the recap" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:328` "GM notes commit on pencil close" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `06-player-collab.spec.mjs:366` "recap survives closing the shell with the editor open" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `07-knowledge.spec.mjs:185` "attributes: playerHidden values never leak to a player, in the panel or in search" — Error: expect(locator).toHaveCount(expected) failed
- `07-knowledge.spec.mjs:417` "backlink permission leak: a GM-only mentioning entry never appears in a player's Mentioned-in list" — Error: expect(locator).toHaveCount(expected) failed
- `08-query-graph.spec.mjs:137` "dashboard CRUD + rendering, hidden/shown per showPlayers" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `08-query-graph.spec.mjs:346` "graph hidden-relationship gate: GM sees the edge, player does not" — TimeoutError: locator.click: Timeout 15000ms exceeded.
- `08-query-graph.spec.mjs:390` "graph tab is campaign-scoped: member nodes only, All shows the world" — Error: unexpected console errors:
- `08-query-graph.spec.mjs:431` "entity header button lands on the Graph tab, scoped and ego-centered" — Error: unexpected console errors:
- `09-secrets.spec.mjs:124` "GM reveals a block to User 1: A sees block + whisper, User 2 sees neither" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:238` "group reveal follows live membership" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:528` "a recap secret gets a GM audience control on the sheet" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:707` "a recap-sourced secret can be revealed and reaches the player" — Error: expect(locator).toHaveCount(expected) failed
- `09-secrets.spec.mjs:773` "a player never gets core's Hide toggle on secrets the companion re-rendered for them; the GM still does" — Error: expect(received).toEqual(expected) // deep equality
- `09-secrets.spec.mjs:970` "duplicate section id on two pages: reveal from page 2 touches only page 2" — Error: expect(locator).toContainText(expected) failed
- `09-secrets.spec.mjs:1029` "opening page 1 (a Session page) prunes only page 1's stale reveal records, leaving page 2 untouched" — Error: expect(locator).toContainText(expected) failed
- `10-secrets-hub.spec.mjs:130` "prep board shows attendee names, not just portraits" — Error: unexpected console errors:
- `10-secrets-hub.spec.mjs:167` "tracker lists a duplicate id once per page and acts on the right page" — Error: unexpected console errors:
- `12-native-mode.spec.mjs:215` "api mode still resolves when forceNativeMode is off" — Error: expect(received).toBe(expected) // Object.is equality
- `14-campaigns.spec.mjs:294` "zero-campaign world: the filing and capture controls are disabled, and say why" — Error: unexpected console errors:
- `14-campaigns.spec.mjs:387` "1. create campaign: picker contains it, and scoping persists across a real Hub re-open" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:202` "3. deleting the portal leaves the campaign; restore recreates it (and never touches the ownership baseline)" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:304` "5. portals are absent from Hub index rows in every scope" — Error: unexpected console errors:
- `15-campaign-portal.spec.mjs:402` "7. player seat: portal opens the scoped read view; no restore control" — Error: expect(locator).toBeVisible() failed
- `16-multi-timeline.spec.mjs:162` "1. second timeline in a campaign: picker switches panes" — Error: unexpected console errors:
- `17-media-routing.spec.mjs:460` "4. media entries get their own Hub index rows and filter chips" — Error: unexpected console errors:
- `20-timeline-journal-open.spec.mjs:112` "2. api mode: sidebar click opens the Hub on that timeline, no journal editor" — Error: expect(locator).toHaveCount(expected) failed

**One test flakes.** `09-secrets:590` ("the Hub tracker offers the audience
control on a recap-sourced secret") failed in run 1 and passed on the isolated
rerun. It shares its shape with `09-secrets:528` and is attributed to the same
ready-time wiring window (see class `companion` below) — which is exactly the
kind of cause that produces an intermittent result.

Every other failure reproduced. The attribution below covers all **46** of run
1's failures — 45 reproduced plus the one flake, which is attributed like the
rest because its cause is known.

## Attribution

**Eight root causes, A–H, account for all 46 of run 1's failures** (45 of which
reproduced on the isolated rerun; `09-secrets:590` is the one flake, and it is
row 46). Two further findings, **I and J, are not run-1 causes at all** — they
only became visible once cause A stopped masking the spec they live in, and they
are reported after the table under "Causes that appeared after the fixes". Classes are the brief's: `platform`,
`mej-13.06`, `shim`, `companion`, `harness`.

### Method

- **`shim` vs `companion`** — rerun with the `shellHosting` client setting off,
  and for the largest cluster something stronger: rerun the failing arm with the
  companion module **disabled in world settings entirely**
  (`tests/e2e/probes/player-shell-v13.mjs`, arm C). A failure that survives the
  module being gone is neither.
- **`mej-13.06`** — read the throwing line in
  `~/FoundryVTT/Data/Data/modules/monks-enhanced-journal`, then diff the same
  function against the fork at `integration-14.08` to say whether the fork
  already fixes it.
- **`platform`** — cite the Foundry 13.351 / dnd5e 5.3.3 API difference in
  `http://localhost:30013/scripts/foundry.mjs`.
- Console-only failures (`assertNoConsoleErrors`) carry no stack in the report,
  so `tests/e2e/probes/undefined-get-v13.mjs` re-created them with
  `Hooks.onError`, `window.onerror`, `unhandledrejection` **and**
  `Document.prototype.update` all instrumented.

### Root causes

**A. MEJ's `allow-player` world setting was off (17 tests) — `harness`.**
`MonksEnhancedJournal.openJournalEntry()` opens with
`if (!game.user.isGM && !setting('allow-player')) return false;`
(13.06 `monks-enhanced-journal.js:2311`), and the setting's registered default
**is** `false` (`settings.js:135`). World A has had it on for a long time;
`world-b` had never been told. Every player seat in the suite therefore got an
empty `#MonksEnhancedJournal` — no shell, no subsheet, no `.nav-button.campaign-hub`,
no `.mej-cc-knowledge`, no `.editor-display`.
Evidence: probe arm A (player, hosting on) and arm B (player, hosting off) and
arm C (player, **companion module disabled**) are byte-identical —
`shellRendered: false, subsheet: null, navButtons: []` — against a GM control on
the same fixture that renders 12 nav buttons including `campaign-hub`. Not the
shim, not the companion, not a defect at all.

**B. The Hub placeholder's `update()` (8 tests) — `shim`.**
MEJ's shell submits its subsheet's form on every change:
`EnhancedJournal._onChangeForm` → `_onSubmitForm` →
`EnhancedJournalSheet.onSubmit`, which ends in
`return this.document.update(submitData)` (13.06
`sheets/EnhancedJournalSheet.js:1460`). Under shell hosting that document is the
companion's synthetic `HubShellDocument` — parentless and in no collection — so
the write reaches Foundry's `ClientDatabaseBackend`, whose
`#preUpdateDocumentArray` dereferences the document's collection unconditionally
(13.351 `foundry.mjs:58726`) and rejects:

```
rejection: TypeError: Cannot read properties of undefined (reading 'get')
[No packages detected]
    at #preUpdateDocumentArray (http://localhost:30013/scripts/foundry.mjs:58726:30)
    at async ClientDatabaseBackend._updateDocuments (http://localhost:30013/scripts/foundry.mjs:58692:5)
```

It is an **unhandled rejection**, so the Hub kept working and only the console
said anything — which is why all eight failures are `assertNoConsoleErrors`
failures rather than behavioural ones, and why each lands right after a Hub form
control is touched (the campaign-scope `<select>`, a filter chip). The
`[No packages detected]` tail is libWrapper annotating an error whose stack
contains no package file; it is not a libWrapper problem. Purely a
shell-hosting path: window hosting never puts the placeholder in MEJ's shell.
`setFlag`/`unsetFlag` on that class were already no-ops for exactly this reason
— `update()`, the method they route through, was missed.

**C. Native-mode wiring finishes after `game.ready` (4 tests) — `companion`, with a `harness` fix.**
In native mode *all* of the companion's wiring runs off the ready hook:
`registerCore()`'s ten dynamic imports, then `wireNativeMode()`'s three, then
the `registerSheet` calls (`mej-adapter.mjs` `wireForReady()`). Measured live
(`tests/e2e/probes/page-sheet-v13.mjs`):

```
immediately after ready : {session: [], hub: []}   mode "native", hosting null
three seconds later     : {session: ["mej-campaign-companion.SessionSheet"],
                           hub: ["mej-campaign-companion.CampaignHubPage"]}
```

The type **keys** exist with empty values, so `_getSheetClass()` finds nothing
and falls back to core's `BaseSheet`. Anything opened in that window gets
`BaseSheet`, and MEJ's own v1/v2 fork test then misclassifies it (see D) and
throws. This is a real product-side window, not only a test artifact: a GM who
clicks a Session in the first second of a native-mode client hits it. The
contained fix is harness-side (wait for the real condition); the window itself
is a follow-up.

**D. MEJ 13.06 registers page sheets only under unprefixed type keys (2 tests) — `mej-13.06`, already fixed on the fork.**
`MonksEnhancedJournal.registerSheetClasses()` registers with
`types: [k]` — the bare `place`, `person`, … — but Foundry assigns real
documents of a module-declared subtype the prefixed type
`monks-enhanced-journal.place` (13.06 `monks-enhanced-journal.js:2168-2181`). So
`page._getSheetClass()` finds an empty bucket and returns core's `BaseSheet`,
and `_renderPageViews`' instance-level test `sheet.isV2 || sheet.DEFAULT_OPTIONS`
(`sheets/JournalEntrySheet.js:590`) misclassifies it: `isV2` is an instance
field on Foundry's *journal-page* sheet base, not on `ApplicationV2`
(13.351 `foundry.mjs:77424/77430`), and `DEFAULT_OPTIONS` is static-only. MEJ
therefore takes its deprecated AppV1 branch and calls `sheet.getData()`:

```
monks-enhanced-journal |  TypeError: sheet.getData is not a function
    at JournalEntrySheet._renderAppV1PageView (…/sheets/JournalEntrySheet.js:379:34)
    at JournalEntrySheet._renderPageViews (…/sheets/JournalEntrySheet.js:593:28)
    at JournalEntrySheet.subRender (…/sheets/JournalEntrySheet.js:358:20)
    at EnhancedJournal.renderSubSheet (…/apps/enhanced-journal.js:598:42)
```

Instrumented `_renderAppV1PageView` confirms the sheet object:
`{sheetCtor: "BaseSheet", isV2: null, hasDefaultOptions: false, hasGetData: false}`.
MEJ's own `fixType()` hides this in normal use by rewriting `page.type` back to
the bare key before the sheet resolves; a page created through the raw API — as
this fixture is — is not protected. **The fork already fixes it**: commit
`4df9b66` ("Fix: register page sheet classes under both prefixed and unprefixed
type keys") registers `types: [k, \`monks-enhanced-journal.${k}\`]`, and its
message names this very error string. `4df9b66` is **not** an ancestor of tag
`13.06`. Upstream-issue candidate; text in Follow-ups.

**E. A leftover, empty world timeline journal in `world-b` (3 tests) — `harness`.**
The companion names its world timeline journal "Campaign Timeline" — not
`TT-` — and the world-scoped `timelineJournalId` setting outlives the run that
created it, so an empty leftover survives every sweep. `02-hub-timeline`'s
`ensureWorldTimeline()` deliberately refuses any timeline whose id was already in
the pre-run ledger (that guard exists to protect a real campaign's timeline), so
a leftover fails all three of its timepoint tests before they do any work.
Probe: `tests/e2e/probes/world-state-v13.mjs` found exactly one —
`KjO3Yjxg9omzLSJE` "Campaign Timeline", 0 timepoints, no folder, no campaign,
with `timelineJournalId` pointing at it.

**F. Specs that assume the fork's extension API (10 tests) — `mej-13.06` cause, `harness` fix.**
A stock MEJ has no `externalTypes` registry. Two consequences the suite had
never met:
- MEJ's New Entry dialog builds its "Single Sheet" optgroup from
  `MonksEnhancedJournal.getTypeLabels()` (13.06 `:4934`), which on the fork is
  fed by `externalTypes` (`:181-197`). On stock there is no `Session` option at
  all — the failing locator found zero elements.
- Even with one, MEJ's create path would write a plain `text` page carrying the
  bare MEJ flag (13.06 `:939`) rather than a real
  `mej-campaign-companion.session` subtype; the fork carves external types out
  at `:1054-1073`.

**G. `platform` — Foundry 14-only `HTMLSecretBlockElement#revealable` (1 test).**
13.351's class body defines only `secret`, `revealed`, `toggleRevealed`
(`foundry.mjs:34600`); `revealable` does not exist, so it reads `undefined` for
GM and player alike and carries no information either way. The module already
treats it as optional (`scripts/logic/secret-reveal-toggles.mjs:17`,
`if ("revealable" in block)`); only the assertion did not.

**H. Carried in from the v14 line (1 test).**
`09-secrets:970` "duplicate section id on two pages" fails with the same symptom
on Foundry 14.368 + MEJ 14.01 + the fork line — the 14.01 sweep
(`2026-09-19-mej-14.01-companion-sweep.md`) records it as a `baseline` failure
there, matched to a 2026-09-05 known-environmental entry ("09 dup-id"). Not
introduced by this stack, and no v13-specific evidence separates it further.

### Table

`line` is the spec line in the **run 1** tree (the fix commits moved some of
them; run 3's numbers differ and are noted where they do). `owner` is who acts
next.

| spec | test | line | class | evidence | action | owner |
|---|---|---|---|---|---|---|
| `03-search` | GM-only content found by GM, not player | 78 | `harness` | A — player arm empty with the companion **disabled** | `4f94527` | done |
| `03-search` | playerHidden attribute re-indexes | 175 | `harness` | A | `4f94527` | done |
| `06-player-collab` | owning player edits the shared recap | 147 | `harness` | A | `4f94527` | done |
| `06-player-collab` | non-owner sees the recap read-only | 205 | `harness` | A | `4f94527` | done |
| `06-player-collab` | two owners edit at once | 231 | `harness` | A | `4f94527` | done |
| `06-player-collab` | relayed image lands in the shared recap | 264 | `harness` | A | `4f94527` | done |
| `06-player-collab` | viewer's session refreshes on another owner's save | 288 | `harness` | A | `4f94527` | done |
| `06-player-collab` | GM notes commit on pencil close | 328 | `harness` | A; and once A was fixed this test failed again for an unrelated reason — cause I below, which run 1 could not see | `4f94527`, then none | follow-up 7 |
| `06-player-collab` | recap survives closing the shell with the editor open | 366 | `harness` | A; failed again in run 3 and passed on an isolated rerun of the file — cause J below | `4f94527` | follow-up 8 |
| `07-knowledge` | playerHidden values never leak to a player | 185 | `harness` | A | `4f94527` | done |
| `07-knowledge` | backlink permission leak | 417 | `harness` | A | `4f94527` | done |
| `08-query-graph` | dashboard CRUD, hidden/shown per showPlayers | 137 | `harness` | A (fails at the player seat's `openHub`) | `4f94527` | done |
| `08-query-graph` | graph hidden-relationship gate | 346 | `harness` | A | `4f94527` | done |
| `09-secrets` | GM reveals a block to User 1 | 124 | `harness` | A (fails at `openEntry(p1, …)`) | `4f94527` | done |
| `09-secrets` | group reveal follows live membership | 238 | `harness` | A | `4f94527` | done |
| `09-secrets` | recap-sourced secret revealed reaches the player | 707 | `harness` | A | `4f94527` | done |
| `15-campaign-portal` | player seat: portal opens the scoped read view | 402 | `harness` | A | `4f94527` | done |
| `08-query-graph` | graph tab is campaign-scoped | 390 | `shim` | B — unhandled rejection from `foundry.mjs:58726`, traced to `HubShellDocument.update` via `EnhancedJournalSheet.onSubmit:1460` | `e2fe738` | done |
| `08-query-graph` | entity header button lands on the Graph tab | 431 | `shim` | B | `e2fe738` | done |
| `14-campaigns` | zero-campaign world: controls disabled, say why | 294 | `shim` | B (reproduced by this test's own sequence in the probe) | `e2fe738` | done |
| `14-campaigns` | create campaign; scoping persists | 387 | `shim` | B | `e2fe738` | done |
| `15-campaign-portal` | deleting the portal leaves the campaign | 202 | `shim` | B | `e2fe738` | done |
| `15-campaign-portal` | portals absent from Hub index rows | 304 | `shim` | B | `e2fe738` | done |
| `16-multi-timeline` | second timeline in a campaign | 162 | `shim` | B | `e2fe738` | done |
| `17-media-routing` | media entries get Hub index rows and chips | 460 | `shim` | B | `e2fe738` | done |
| `09-secrets` | recap secret gets a GM audience control | 528 | `companion` | C — Session opened inside the ready-time window, `BaseSheet`, MEJ throws (D) | `02a9858` + follow-up 2 | done / follow-up |
| `09-secrets` | Hub tracker offers the control on a recap secret | 590 | `companion` (flake) | C; passed on the isolated rerun | `02a9858` | done |
| `09-secrets` | opening page 1 prunes only page 1's stale records | 1029 | `companion` | C | `02a9858` | done |
| `10-secrets-hub` | prep board shows attendee names | 130 | `companion` | C | `02a9858` | done |
| `20-timeline-journal-open` | api mode: sidebar click opens the Hub | 112 | `companion` | C — `CONFIG.JournalEntry.sheetClasses.base` had no companion entry yet, so the timeline journal opened `JournalEntrySheet5e`; its 5 serial successors never ran | `02a9858` | done |
| `10-secrets-hub` | tracker lists a duplicate id once per page | 167 | `mej-13.06` | D — two-page MEJ-typed entry; `BaseSheet` → `sheet.getData is not a function`; fork fixes it in `4df9b66`, not an ancestor of `13.06` | none (upstream) | MEJ upstream issue |
| `02-hub-timeline` | timepoint CRUD and drag-reorder | 155 | `harness` | E — `timelineJournalId` pointed at a leftover empty "Campaign Timeline" | `6b1e1e9` | done |
| `02-hub-timeline` | dropping a person entry and an image onto a timepoint | 215 | `harness` | E | `6b1e1e9` | done |
| `02-hub-timeline` | index row click opens the entry in MEJ | 288 | `harness` | E | `6b1e1e9` | done |
| `00-mej-api` | registers the session type; entries open with MEJ sheets | 15 | `mej-13.06` | F — `externalTypes` absent on stock | `49cb24b` (skips) | done |
| `00-mej-api` | fixType foreign-subtype guard survives a reload | 103 | `mej-13.06` | F | `49cb24b` (skips) | done |
| `01-session` | create via New Entry dialog gets the prefixed subtype | 57 | `mej-13.06` | F — no `session` option in the dialog at all | `391fdba` (skips) | done |
| `01-session` | sessionNumber, campaignDate, secret persist across reload | 88 | `harness` | F — the test needs a Session, not the dialog | `391fdba` | done |
| `01-session` | recap editor smoke | 166 | `harness` | F | `391fdba` | done |
| `01-session` | relationship drag: person ↔ session | 196 | `harness` | F | `391fdba` | done |
| `01-session` | player client: gmNotes absent, secrets not sent | 231 | `harness` | F | `391fdba` | done |
| `01-session` | fresh Session sheet renders no schema header rows | 308 | `harness` | F | `391fdba` | done |
| `01-session` | image-bearing Session renders MEJ's header | 406 | `harness` | F | `391fdba` | done |
| `12-native-mode` | api mode still resolves when forceNativeMode is off | 215 | `harness` | F — asserts mode `"api"`, unreachable with no API | `391fdba` (skips) | done |
| `09-secrets` | player never gets core's Hide toggle | 773 | `platform` | G — `revealable` is Foundry 14-only (`foundry.mjs:34600`) | `22dd94d` | done |
| `09-secrets` | duplicate section id on two pages | 970 | `harness` | H — same symptom on the v14 fork line; 14.01 sweep records it as `baseline` | none | sub-project (shared with the v14 line) |

Counts over the 46 rows above (run 1's 46 failures; 45 of them reproduced on
the isolated rerun, `09-secrets:590` being the one flake):

| class | rows | root causes |
|---|---|---|
| `harness` | 28 | A (17), E (3), F (7), H (1) |
| `shim` | 8 | B |
| `companion` | 5 | C |
| `mej-13.06` | 4 | D (1), F (3) |
| `platform` | 1 | G |

Every row carries exactly one class, and the table covers run 1 only, so the
`platform` row counts G alone. Cause I is also `platform`, but it is not a run-1
failure and is deliberately not counted here — see "Causes that appeared after
the fixes" below.

Root cause F splits across two classes on purpose: the three rows whose
*subject* is the extension API or MEJ's dialog are `mej-13.06` (the thing under
test is genuinely absent on stock), while the seven that merely needed a Session
document to exist are `harness` (the test chose an api-only way to make one).

### Causes that appeared after the fixes

Neither of these is in the table above, and neither is counted in it: they are
**not** run-1 attributions. Run 1 could not see them because cause A failed
`06-player-collab` at the player seat before either could be reached.

**I. `HTMLProseMirrorElement#save()` does not exist on Foundry 13 (1 test) — `companion`, fixed 2026-09-20.**
Masked in run 1 by cause A (the whole spec failed at the player seat), visible
only once that was fixed. `SessionSheet.onEditGmNotes` commits the GM-notes
editor by calling `editor?.save()`: unlike the recap editor, gmNotes is not a
`toggled` editor, so the pencil is its only commit point and nothing else ever
saves it. Foundry **14**.368 exposes a public `save()` on
`HTMLProseMirrorElement` (`foundry.mjs:97241` + `:275` of that class body);
Foundry **13**.351 has only a private `#save()` (`foundry.mjs:72613`, `#save()`
at `:269` of the class body), reachable from outside only through the `open`
attribute — and `set open()` returns early for a non-toggled editor. So on v13
the call throws, `.editing` is never removed, and `system.gmNotes` never
receives the text. `06-player-collab:328` failed in run 3 and again on an
isolated rerun of the spec. No contained fix: the honest ones are to make the
gmNotes editor `toggled` like the recap editor, or to give the companion its own
v13 commit path — both design work. Follow-up 7.
Fixed on `feat/native-shell-shim` (spec
`docs/superpowers/specs/2026-09-20-gm-notes-commit-design.md`): the commit
now reads and re-assigns the element's public `value`, which stores the live
content and fires the same `change` core's private save fires. `:328` passes
on Foundry 13 and 14.
The sweep's :328 failure had a second layer the fix exposed: the test focused
the `<prose-mirror>` element itself, which is a no-op on Foundry 13, so no text
was ever typed; the test now focuses the .ProseMirror descendant.

**J. `06-player-collab` is unstable on this stack — `harness`, diagnosed
2026-09-20.**
Its eight tests are the collaborative-ProseMirror ones, and after cause A was
fixed they did not agree with themselves: run 3 failed `:328` and `:366`
(6 passed / 2 failed), while an isolated rerun of the same file minutes later
failed `:147`, `:205`, `:288` and `:328` (4 passed / 4 failed). Only `:328`
fails in both, and it has a cause (I). The rest turned out to be one race:
every one of those failures was a PLAYER seat whose `openSession` never saw a
`SessionSheet` subsheet — MEJ held the entry as its `JournalEntrySheet`
wrapper. `login()`'s wired predicate returned once the session sheet class was
registered, but `wireNativeMode()` installs the shell shim *after* that
registration (a dynamic import away, 0–130 ms on four fresh seats), and an
`openJournalEntry` in that gap fails MEJ's demotion gate (`getDocumentTypes()`
has no `session` yet). Instrumented runs: 5 of 5 failed opens had the shim
absent before and after the call, 4 of 4 passing opens had it present or
arriving mid-call. Fix: the predicate also waits for the wrap's observable
effect in native mode (`tests/e2e/helpers/foundry.mjs` `COMPANION_WIRED`,
unit-tested). Follow-up 8 (closed).

## Fixes

Seven commits, each with its test.

| commit | fix | test |
|---|---|---|
| `e2fe738` | `HubShellDocument.update()` is a local no-op, like `setFlag`/`unsetFlag` | `test/hub-shell-document.test.js` (new, 2 unit tests; red before the change with "doc.update is not a function") |
| `4f94527` | global setup turns MEJ's `allow-player` world setting on (`ensureMejPlayerAccess()`) | `03-search.spec.mjs` on v13: was 2 passed / 2 failed, now 7/7 |
| `02a9858` | `login()`/`gotoGame()`/`reloadGame()` wait for the companion's sheet registrations (`waitCompanionWired()`) | `10-secrets-hub` + `20-timeline-journal-open` on v13: was 3 failed + 5 never-run, now 12 passed / 1 failed |
| `6b1e1e9`, narrowed by `949f07b` | global setup sweeps a stranded timeline journal — `cleanupStrandedTestTimelines()`, TT--named only | `02-hub-timeline.spec.mjs` on v13: was 2 passed / 3 failed, now 8/8; plus a new `18-harness-cleanup` test that an empty "Campaign Timeline" survives the sweep and a TT- one beside it does not |
| `391fdba` | `createSessionEntry()` routes around MEJ's New Entry dialog on a stock build; the dialog-specific test and `12-native-mode:215` skip | `01-session` + `12-native-mode` on v13: was 8 failed, now 14 passed / 2 skipped |
| `49cb24b` | `00-mej-api.spec.mjs` skips with no extension API | `00-mej-api` on v13: was 2 failed, now 2 skipped |
| `22dd94d` | `secret-block` assertions fall back to `button.reveal`'s hidden state where `revealable` does not exist | `09-secrets` on v13: `:773` green; the file went 6/8 → 16 passed / 1 failed |
| `949f07b` | review round: the sweep above narrowed to TT- names; `waitCompanionWired` short-circuits `absent` mode; the API-presence predicate corrected in four specs | v14 full suite 135/1/23; `00`+`01`+`12` on v14 18/18 and on v13 14 passed / 4 skipped; v13 `02`+`18` 12/12 |

No change was made under `monks-enhanced-journal`.

Five probes carried the attribution. `tests/e2e/probes/` is git-ignored
scratch (`.gitignore:14`), so they are not committed; they live in the sweep
worktree and a copy sits beside the raw JSON reports outside the repo. All are
runnable with `FOUNDRY_TARGET=v13`:

| probe | answers |
|---|---|
| `delete-legacy-pages.mjs` | Step 1 — the two invalid pages, before/after/reload |
| `player-shell-v13.mjs` | root cause A — GM control + three player arms (hosting on, hosting off, **companion disabled**) |
| `undefined-get-v13.mjs` | root cause B — `Hooks.onError` / `unhandledrejection` / `Document.prototype.update` instrumented to catch a console-only rejection |
| `page-sheet-v13.mjs` | root causes C and D — registration state at ready vs. three seconds later, and the sheet object MEJ's AppV1 branch actually receives |
| `world-state-v13.mjs` | root cause E, and the timeline redirect sheet's registration on a sidebar click |

## Run 3 — full suite, after the fixes

```
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/run3.json npm run e2e:v13 -- --reporter=list,json
```

| Spec | passed | failed | skipped |
|---|---|---|---|
| 00-mej-api.spec.mjs | 0 | 0 | 2 |
| 01-session.spec.mjs | 6 | 0 | 1 |
| 02-hub-timeline.spec.mjs | 5 | 0 | 0 |
| 03-search.spec.mjs | 4 | 0 | 0 |
| 04-auto-capture.spec.mjs | 2 | 0 | 0 |
| 05-docx-import.spec.mjs | 1 | 0 | 0 |
| 06-player-collab.spec.mjs | 6 | 2 | 0 |
| 07-knowledge.spec.mjs | 8 | 0 | 0 |
| 08-query-graph.spec.mjs | 9 | 0 | 0 |
| 09-secrets.spec.mjs | 13 | 1 | 0 |
| 10-secrets-hub.spec.mjs | 2 | 1 | 0 |
| 11-auto-link-scope.spec.mjs | 9 | 0 | 0 |
| 12-native-mode.spec.mjs | 5 | 0 | 1 |
| 13-stock-smoke.spec.mjs | 0 | 0 | 13 |
| 14-campaigns.spec.mjs | 14 | 0 | 0 |
| 15-campaign-portal.spec.mjs | 7 | 0 | 0 |
| 16-multi-timeline.spec.mjs | 8 | 0 | 0 |
| 17-media-routing.spec.mjs | 5 | 0 | 0 |
| 18-harness-cleanup.spec.mjs | 3 | 0 | 0 |
| 19-reveal-migration.spec.mjs | 2 | 0 | 0 |
| 20-timeline-journal-open.spec.mjs | 7 | 0 | 0 |
| 21-players-write-sessions.spec.mjs | 1 | 0 | 0 |
| 22-auto-link-sessions.spec.mjs | 3 | 0 | 0 |
| 23-campaign-creation.spec.mjs | 10 | 0 | 0 |
| auth.setup.mjs | 3 | 0 | 0 |
| guide-screenshots.spec.mjs | 0 | 0 | 4 |
| **total (v13 run 3 (after fixes))** | 133 | 4 | 21 |

Failures:
- `06-player-collab.spec.mjs:328` "GM notes commit on pencil close" — TimeoutError: page.waitForFunction: Timeout 10000ms exceeded.
- `06-player-collab.spec.mjs:366` "recap survives closing the shell with the editor open" — TimeoutError: page.waitForFunction: Timeout 15000ms exceeded.
- `09-secrets.spec.mjs:982` "duplicate section id on two pages: reveal from page 2 touches only page 2" — Error: expect(locator).toContainText(expected) failed
- `10-secrets-hub.spec.mjs:167` "tracker lists a duplicate id once per page and acts on the right page" — Error: unexpected console errors:

`npm test`: 77 files, 868 tests, all passing. `npm run check:links`: OK.

## Run 4 — the api-mode suite on Foundry 14, after the harness changes

Four of this sweep's seven fixes touch shared harness code that every target
uses — `ensureMejPlayerAccess()`, the global-setup timeline sweep,
`waitCompanionWired()` inside `login`/`gotoGame`/`reloadGame`, and the
API-presence gates. The v14 api-mode suite is the release regression net, so it
had to be re-run before any of this could be called done.

Stack: Foundry 14.368, dnd5e 6.0.3, world-a, MEJ worktree at `9569984`
(`integration-14.08`, the fork line, extension API present), companion served
from this worktree by global setup and re-pinned to the main checkout by
teardown.

```
PLAYWRIGHT_JSON_OUTPUT_NAME=$OUT/api-after-harness.json \
  npx playwright test --trace off --reporter=list,json
```

| Spec | passed | failed | skipped |
|---|---|---|---|
| 00-mej-api.spec.mjs | 0 | 0 | 2 |
| 01-session.spec.mjs | 6 | 0 | 1 |
| 02-hub-timeline.spec.mjs | 5 | 0 | 0 |
| 03-search.spec.mjs | 4 | 0 | 0 |
| 04-auto-capture.spec.mjs | 2 | 0 | 0 |
| 05-docx-import.spec.mjs | 1 | 0 | 0 |
| 06-player-collab.spec.mjs | 8 | 0 | 0 |
| 07-knowledge.spec.mjs | 8 | 0 | 0 |
| 08-query-graph.spec.mjs | 9 | 0 | 0 |
| 09-secrets.spec.mjs | 13 | 1 | 0 |
| 10-secrets-hub.spec.mjs | 3 | 0 | 0 |
| 11-auto-link-scope.spec.mjs | 9 | 0 | 0 |
| 12-native-mode.spec.mjs | 5 | 0 | 1 |
| 13-stock-smoke.spec.mjs | 0 | 0 | 13 |
| 14-campaigns.spec.mjs | 12 | 0 | 2 |
| 15-campaign-portal.spec.mjs | 7 | 0 | 0 |
| 16-multi-timeline.spec.mjs | 8 | 0 | 0 |
| 17-media-routing.spec.mjs | 5 | 0 | 0 |
| 18-harness-cleanup.spec.mjs | 4 | 0 | 0 |
| 19-reveal-migration.spec.mjs | 2 | 0 | 0 |
| 20-timeline-journal-open.spec.mjs | 7 | 0 | 0 |
| 21-players-write-sessions.spec.mjs | 1 | 0 | 0 |
| 22-auto-link-sessions.spec.mjs | 3 | 0 | 0 |
| 23-campaign-creation.spec.mjs | 10 | 0 | 0 |
| auth.setup.mjs | 3 | 0 | 0 |
| guide-screenshots.spec.mjs | 0 | 0 | 4 |
| **total (api-mode after harness fixes)** | 135 | 1 | 23 |

Failures:
- `09-secrets.spec.mjs:982` "duplicate section id on two pages: reveal from page 2 touches only page 2" — Error: expect(received).toEqual(expected) // deep equality

**135 passed, 1 failed, 23 skipped — the Task 5 baseline exactly**, and the one
failure is the known `09-secrets:970` (here `:982`), which reproduced on its
isolated rerun rather than flaking. No new failure was introduced on the v14
line by any harness change.

Read-only audit of world-a before the run, so the record says what the
(now-replaced) unledgered sweep would have met there:

| journal | name TT-? | timepoints | non-TT timepoints | old sweep would delete | new sweep would delete |
|---|---|---|---|---|---|
| `rBipLpGbbqbYfIx4` | no — "Radiant Citadel — Timeline" (folder "Radiant Citadel") | 34 | 34 | no | no |

That is world-a's only timeline journal, and `timelineJournalId` /
`hubTimelineSelection` were both `""`. So the unledgered sweep would not in fact
have deleted anything on this world — the hazard it created was latent (a real
timeline before its first timepoint, or a freshly created campaign's default
one), not realised. It is fixed anyway: `949f07b` narrows the sweep to TT- names
and `18-harness-cleanup` now pins that.

**One regression the run did catch**, and it was mine: three skip gates added in
`391fdba`/`49cb24b` tested
`typeof game.MonksEnhancedJournal?.registerSheetType === "function"`. That name
lives on the object `getApi()` **returns** and hands to the
`setupMonksEnhancedJournal` hook — never on `game.MonksEnhancedJournal` — so it
reads false on the fork too, and `00-mej-api` (2 tests), `01-session:57` and
`12-native-mode:215` skipped on the v14 line instead of running. They are real
api-mode coverage. `949f07b` switches all of them to `getApi`/`externalTypes`;
`00`+`01`+`12` then run 18/18 on v14 and skip exactly the 4 api-only tests on
v13. The same wrong predicate was already in `13-stock-smoke.spec.mjs:234`,
where it asserts `apiPresent === false` — so that assertion had been passing
vacuously, on either build, and is fixed in the same commit.

## Release gates

The sweep above is a discovery instrument. These are the gates the release
actually turns on (spec §6.3), recorded here because the sweep and the gates
were run from the same branch and the verdict below depends on both.

Each gate is `tests/e2e/13-stock-smoke.spec.mjs`, which runs only when
`STOCK_PHASE` is set — a normal suite run skips it, which is why the sweep's own
runs never exercised it.

### 2026-09-19 — the gates as first passed

| date | gate | Foundry build | MEJ build | world | result |
|---|---|---|---|---|---|
| 2026-09-19 | stock gate, native mode | 13.351 | stock 13.06 (upstream release, no extension API) | world-b | **9/9 passed** |
| 2026-09-19 | stock gate, native mode | 14.368 | stock, module worktree at tag `14.01` | world-a | **9/9 passed**, New Session (Task 5) included |
| 2026-09-19 | full api-mode suite (release regression net) | 14.368 | fork line `9569984` (`integration-14.08`) | world-a | **135 passed, 1 failed, 23 skipped** — the failure is the known `09-secrets:970` (see Run 4) |

So the MEJ 14.01 native stock gate passed on 2026-09-19, including New Session.
An earlier draft of the Verdict below said it was "still owed"; that was wrong,
and is corrected there.

### 2026-09-20 — re-run after the final fix wave (these supersede)

The final fix wave added a type to the shim (`additions` gained the campaign
portal type) and a tenth test to the gate, so both stock gates were re-run from
`feat/native-shell-shim`. These runs are the release's record.

| date | gate | Foundry build | MEJ build | world | result |
|---|---|---|---|---|---|
| 2026-09-20 | stock gate, native mode | 13.351 | stock 13.06 | world-b | **10/10 passed** (+3 auth setup; 4 other-phase tests skipped) |
| 2026-09-20 | stock gate cleanup phase | 13.351 | stock 13.06 | world-b | **1/1 passed** — fixtures and shell tabs gone |
| 2026-09-20 | stock gate, native mode | 14.368 | stock, module worktree at tag `14.01` (`9d66fb9`) | world-a | **10/10 passed** |
| 2026-09-20 | stock gate return phase | 14.368 | fork line `9569984` | world-a | **3/3 passed** — `api` mode resolves, the GM ready-sweep re-stamped the MEJ type flag, search finds the roundtripped session, fixture deleted |

### 2026-09-20 — follow-up wave (groups 1 and 2 of the post-review follow-ups)

Harness-only changes (stranded-folder sweep, the wired predicate's shim wait,
console-error locations), so the gates were re-run rather than re-argued.

| date | gate | Foundry build | MEJ build | world | result |
|---|---|---|---|---|---|
| 2026-09-20 | stock gate, native mode (after the folder sweep) | 13.351 | stock 13.06 | world-b | **10/10 passed**; cleanup phase 1/1 |
| 2026-09-20 | stock gate, native mode (after the predicate + console changes) | 13.351 | stock 13.06 | world-b | **10/10 passed**; cleanup phase 1/1 |
| 2026-09-20 | `06-player-collab` ×3, isolated, before the predicate fix | 13.351 | stock 13.06 | world-b | 4/4, 5/3, 6/2 failed — every non-`:328` failure a player seat opening pre-shim (cause J) |
| 2026-09-20 | `06-player-collab` ×3, isolated, after the predicate fix | 13.351 | stock 13.06 | world-b | 7/1, 7/1, 6/2 — `:328` (follow-up 7) every run; `:231` once (see below) |
| 2026-09-20 | api-mode spot check (`00-mej-api`, `12-native-mode`) | 14.368 | fork line `9569984` | world-a | **11/11 passed** — the predicate short-circuits on the extension API |
| 2026-09-20 | stock gate, native mode (ready gate + early registration; 11 tests) | 13.351 | stock 13.06 | world-b | **11/11 passed**; cleanup 1/1 |
| 2026-09-20 | stock gate, native mode (ready gate + early registration; 11 tests) | 14.368 | stock, module worktree at tag `14.01` | world-a | **11/11 passed** |
| 2026-09-20 | stock gate return phase | 14.368 | fork line `9569984` | world-a | **3/3 passed** |
| 2026-09-20 | Foundry 13 full suite after the ready-wiring change | 13.351 | stock 13.06 | world-b | 133 passed, 5 failed, 23 skipped — `10-secrets-hub:167` (mej-13.06) and `09-secrets` (baseline) as attributed; `02-hub-timeline:155/:215/:288` environmental: a stray empty "Campaign Timeline" world timeline left in world-b by an earlier crashed run (group-1 documented nuisance), not a code regression |
| 2026-09-20 | Foundry 14 api-mode full suite after the ready-wiring change | 14.368 | fork line `9569984` | world-a | **139 passed, 1 failed (`09-secrets:970`, baseline), 21 skipped** |

Residual from the post-fix runs: `06-player-collab:231` ("two owners edit at
once") failed once in three — the second owner's `prose-mirror` came back with
no body text at all, not even its own sentence, i.e. the shared collaborative
session was torn down under it (the file's own `commitRecap` comment describes
exactly that teardown when one owner saves). Never seen in the three pre-fix
runs; not the demotion-gate race, which is a different symptom (wrapper, no
`SessionSheet`). Recorded, not chased: one occurrence, no companion code in the
path, and a Foundry 13.351 collaborative-editing behaviour. Class `platform`,
provisional.

Both stock phases ran the same ten tests: clean boot (native mode, no API, no
companion error notification), Hub from the scene-controls button with working
tabs and an inert configure-sheet control, the Hub-open race, New Session
creating and auto-opening the fixture as the shell's `SessionSheet`, Hub search,
the sidebar-opened session (shell subsheet, no `.journal-entry-pages` wrapper,
contrast ≥ 4.5:1), **the sidebar-opened campaign portal (new in this wave:
subsheet `CampaignHubPage`, no page wrapper)**, contrast under both colour
schemes, the persisted Hub tab surviving a reload, and the shell-hosting-off
window fallback.

Observed identically on both builds, recorded as annotations rather than
asserted (they are stock MEJ's surfaces, not ours):

- `getDocumentTypes()` gains exactly `session`, `campaign`, `campaign-hub`;
  `getTypeLabels()` gains none of them, so MEJ's create-page dialog does **not**
  list them as MEJ page types. That dialog's `renderDialogV2` handler
  (13.06 `monks-enhanced-journal.js`:2169) uses `getDocumentTypes()` only to
  *filter out* core types whose key matches an MEJ key after stripping the
  `monks-enhanced-journal.` prefix — our keys are prefixed with our own module
  id, so nothing new is filtered and nothing new is offered. The companion's own
  `mej-campaign-companion.session` entry still appears there as core's
  unlocalized `TYPES.JournalEntryPage.…` row, exactly as the README describes.
- `MonksEnhancedJournal.getIcon()` is a hard-coded switch with a default, so
  `session` and `campaign` both resolve to its fallback `fa-book-open`
  (`person` → `fa-user` for contrast). No new icon or asset request comes from
  the widening; the known `assets/session.png` 404 is driven by the entry-level
  `flags.monks-enhanced-journal.pagetype` paths (`:945`, `:4378`,
  compendium index `:5091`), which the companion never sets.
- Session and Hub text measured 11.23:1 against MEJ's parchment on
  `SECTION.window-content` under both colour schemes, on both builds.

## Verdict

**The companion runs on Foundry 13.351 with a genuinely stock MEJ 13.06, in
native mode with shell hosting.** Run 3: **133 passed, 4 failed, 21 skipped**
across 24 spec files, up from 71 passed / 46 failed. Mode and hosting resolve to
`native` / `shell` on every run.

**One real defect in our own code came out of this sweep, and it is the shim's**:
the Hub's placeholder document had no `update()` override, so every Hub form
change under shell hosting raised an unhandled rejection out of Foundry's
database layer. It was invisible to a user and to every previous run — the Hub
kept working, only the console complained — and it took eight
`assertNoConsoleErrors` failures on an unfamiliar stack to surface it. Fixed in
`e2fe738` with a unit test.

**One MEJ-side defect, and the fork already fixes it**: stock 13.06 registers its
page sheets only under unprefixed type keys, so any MEJ-typed page created
through the API resolves to core's `BaseSheet` and MEJ's own AppV1 bridge throws
`sheet.getData is not a function`. `4df9b66` on the fork is exactly this fix and
is not an ancestor of tag `13.06`. Upstream-issue candidate, text in Follow-ups;
PR #821 stays frozen.

**One product-side window that this sweep found and did not close**: in native
mode the companion's sheet registrations land 1–3 seconds after `game.ready`, and
anything opened inside that window resolves to `BaseSheet` and trips the MEJ
defect above. The harness now waits for the real condition, which makes the suite
honest, but a GM who clicks a Session in the first second still sees it.
Follow-up 2, spec first.

**Everything else was environment or test assumption.** 28 of 46 rows are
`harness`: MEJ's `allow-player` world setting (17 tests), a leftover empty
timeline journal (3), and specs that assumed the fork's extension API (10, of
which 3 are genuinely api-only and now skip). None of them is a defect in
anything, and all of them would have kept failing on every future v13 run.

**Four failures remain in run 3**, none of them blocking and none of them new
companion defects: `10-secrets-hub:167` (the MEJ 13.06 defect, follow-up 1),
`09-secrets:970` (the same failure the v14 line already carries as a baseline,
follow-up 4), `06-player-collab:328` (Foundry 13 has no public
`HTMLProseMirrorElement#save()`, follow-up 7) and `06-player-collab:366` (which
passed on its isolated rerun; the file is unstable on this stack, follow-up 8).

**The v14 line is unaffected.** The four harness changes that every target
shares were re-run as the api-mode suite on Foundry 14.368 / MEJ `9569984`:
135 passed, 1 failed, 23 skipped — the Task 5 baseline, with the known
`09-secrets:970` as the only failure. One regression of my own was caught there
and fixed (`949f07b`): a wrong API-presence predicate had made four api-mode
tests skip on the fork line. See Run 4.

**What this SWEEP does not establish, and what the gates do.** `13-stock-smoke`
only runs with `STOCK_PHASE` set, so no sweep run exercised it: nothing in Runs
1-4 says anything about MEJ 14.01 in native mode, nor about the Hub, the Session
sheet or a campaign portal opened from the sidebar on a *genuinely* stock build.
Those claims belong to the stock gates, and the gates have them — see **Release
gates** above: 10/10 on stock MEJ 13.06 / Foundry 13.351 / world-b and 10/10 on
stock MEJ 14.01 / Foundry 14.368 / world-a on 2026-09-20 (9/9 on 2026-09-19,
before this wave added the campaign-portal test), plus the return phase proving
`api` mode and the flag heal on the fork line. The 14.01 native stock gate is
**passed, not owed**.

What remains genuinely unestablished is narrower: nothing here was run against a
*fork* MEJ on Foundry 13, so no A/B separates "Foundry 13" from "stock MEJ" for
any row attributed to the platform; and the sweep's own instrument (the full
suite on v13) is not a gate and is not expected to be green.

## Follow-ups

1. **MEJ 13.06 registers page sheets only under unprefixed type keys — upstream issue candidate.**

   > On MEJ 13.06, `MonksEnhancedJournal.registerSheetClasses()` registers each
   > page sheet with `types: [k]` — the bare `quest`, `shop`, `place`, … — but
   > Foundry assigns real `JournalEntryPage` documents of a module-declared
   > subtype the module-prefixed type (`monks-enhanced-journal.shop`). So
   > `page._getSheetClass()` looks in `CONFIG.JournalEntryPage.sheetClasses["monks-enhanced-journal.shop"]`,
   > finds it empty, and falls back to core's `BaseSheet`. `BaseSheet` is a real
   > ApplicationV2, but it is not a `JournalEntryPageSheet`, so it carries
   > neither the `isV2` instance field nor an instance-visible `DEFAULT_OPTIONS`
   > — and `JournalEntrySheet._renderPageViews`' test
   > `if (sheet.isV2 || sheet.DEFAULT_OPTIONS)` (`sheets/JournalEntrySheet.js:590`)
   > therefore routes it to the deprecated AppV1 path, which calls
   > `sheet.getData()` and throws `TypeError: sheet.getData is not a function`
   > (`:379`). Pages created through MEJ's own UI are accidentally protected,
   > because `fixType()` rewrites `page.type` back to the bare key before the
   > sheet resolves; a page created through the API or an import is not.
   > Reproduction on Foundry 13.351 + MEJ 13.06: create a JournalEntry with two
   > `monks-enhanced-journal.place` pages via `JournalEntry.create()` and open it
   > with `game.MonksEnhancedJournal.openJournalEntry(entry)` — the shell renders
   > no page bodies and logs the TypeError twice. Two candidate fixes:
   > register under both keys (`types: [k, \`monks-enhanced-journal.${k}\`]`), and
   > test for ApplicationV2 by `instanceof` rather than by duck-typing an
   > instance field.

   Note for us: the fork already carries the first half as `4df9b66`, whose
   message describes this exact failure. It is **not** in tag `13.06`, so anyone
   running the companion on stock 13.06 will meet it. **PR #821 is frozen and
   must not take new commits** — this goes to upstream as a new issue.
   Owner: MEJ backlog / upstream issue against 13.06 (and 14.01, where the same
   code stands).

2. **Native mode wires itself after `game.ready`, and the gap is user-visible — closed 2026-09-20.**
   Measured: sheet registrations land 1–3s after ready on this stack, and
   anything opened before then resolves to `BaseSheet` and trips follow-up 1.
   Addendum 2026-09-20: there is a second, shorter window inside the first —
   the shell shim installs 0–130 ms *after* the sheet registrations (cause J),
   and an open in it gets MEJ's entry wrapper rather than `BaseSheet`. The
   harness now waits for both; a spec for this item should decide whether the
   shim is installed before the registrations or the whole wiring is made
   atomic from the user's point of view. Closed by follow-up 2's spec (the
   gate).
   The harness now waits for the real condition, so the suite is honest about it,
   but a GM who clicks a Session in the first second of a native-mode client
   still gets a broken render and a console TypeError. The cause is structural:
   the sheet modules statically import MEJ's `EnhancedJournalSheet.js`, so they
   cannot be imported before MEJ exists, which is why the whole chain hangs off
   `ready`. Options worth a spec: register the sheet classes from MEJ's own
   `setup`-time presence rather than `ready`; or split the sheet classes so the
   registration does not need the MEJ-importing module body; or hold a
   user-visible "still starting" state. Not attempted here — it is design work,
   not a contained fix. Owner: **sub-project, spec first.**
   Spec `docs/superpowers/specs/2026-09-20-ready-wiring-window-design.md`:
   sheets registered at init, shim installed before `registerCore()`, and a
   setup-time gate holds MEJ opens until the ready wiring resolves. Before:
   ready hook → sheet registration 430–924 ms, → shim +20–35 ms (2026-09-20,
   four seats). After: v13 stock (Foundry 13.351, stock MEJ 13.06) — ready
   hook → session sheet registered −111 ms, → shim visible +209 ms, early
   open held 911 ms; Foundry 14 stock (14.368, MEJ at tag `14.01`) —
   registered −182 ms, shim +161 ms, held 571 ms (both runs 2026-09-20,
   `boot-timing` and `early-open` annotations on
   `tests/e2e/13-stock-smoke.spec.mjs`'s Hub-open race and early-open tests;
   negative means the sheet was registered before the ready hook fired).

3. **The three `mej-13.06` rows that are not issue candidates.**
   `00-mej-api:15`, `00-mej-api:103` and `01-session:57` are classed
   `mej-13.06` because the thing they test is genuinely absent from a stock
   build — but the fix for them is **already proposed upstream**: they are
   exactly what MEJ's extension API (upstream PR #823, `externalTypes` +
   `registerSheetType`) adds. They need no new issue and no new work; they are
   the argument for that PR. Nothing to do beyond noting that these three skips
   would become real assertions the day #823 lands. Owner: none.

4. **`09-secrets:970` — shared with the v14 line.** Same test, same symptom, on
   both stacks; the 14.01 sweep carries it as `baseline`. It needs one
   investigation that serves both lines, not a v13 one. Owner: sub-project.

5. **`assertNoConsoleErrors` still records only message text — closed
   2026-09-20** (entries now carry `msg.location()` and, for an Error
   argument or a page error, the stack; `tests/e2e/helpers/console-format.mjs`). Root cause B was
   invisible for a whole sweep because the harness stores `msg.text()` and
   nothing else: eight tests failed with a one-line TypeError and no stack, no
   source location, and no clue which document was involved. The 14.01 sweep
   raised the same gap for a 404 URL. Worth recording `msg.location()` and, where
   the console argument is an `Error`, its `stack`. Owner: harness backlog.

6. **`world-b` is a module-rich world — closed 2026-09-20** (stated in
   `tests/e2e/README.md` with the active-module list). lib-wrapper, campaign-record,
   omnipresence, monks-active-tiles, levels and others are active, and
   omnipresence runs a macro-sync reconcile on every login. Nothing in this sweep
   was attributed to them, but it is not the clean two-module world the v13 stock
   gate's description implies; worth stating in `tests/e2e/README.md`. Owner:
   harness backlog.

7. **`SessionSheet.onEditGmNotes` has no commit path on Foundry 13 — closed
   2026-09-20** (cause I above; commit through the editor's public `value`).
   It calls `editor?.save()`, which exists only from Foundry 14
   (`HTMLProseMirrorElement#save()`, public at 14.368; private `#save()` at
   13.351). On v13 the call throws, the editor never closes, and the notes are
   never written — `06-player-collab:328`, reproduced on an isolated rerun. The
   optional chaining guards a missing element, not a missing method, so the
   throw is silent to the user beyond the editor not closing. Two candidate
   designs: make the gmNotes editor `toggled` the way the recap editor is (then
   `open = false` reaches core's own save), or give the companion an explicit
   commit that works on both generations. Either needs its own verification
   against a real GM edit, so neither belongs in a sweep. Owner: **sub-project,
   spec first.** Worth confirming first whether this affects v14 users at all
   (it should not) and therefore whether it is v13-support work or a real bug.

8. **`06-player-collab` is unstable on Foundry 13 / dnd5e 5.3.3 — closed
   2026-09-20.** Neither a timeout question nor an editor race: the harness's
   login wait returned before the shell shim was installed, and a player seat
   opening a Session in that 0–130 ms gap got MEJ's entry wrapper (cause J,
   updated above). `COMPANION_WIRED` now waits for the shim's type-map wrap in
   native mode. Three isolated runs after the fix are recorded in the "Release
   gates" section; `:328` (follow-up 7) is the only expected failure, and one
   run also lost `:231` to a collaborative-session teardown (residual there).

9. **In api mode on the fork, `fixType` rewrites an opened Session page's
   in-memory `type` to the bare `"session"` key.** The fork's `fixType`
   (`monks-enhanced-journal.js`:4344-4346) does
   `type = type || object.type; if (types[type]) object.type = type;` — and in
   api mode `types` DOES contain `"session"`, because that is exactly what
   `registerSheetType` put there. So every time MEJ normalizes an opened Session
   page, that page instance's `type` stops being
   `mej-campaign-companion.session`. The persisted `_source.type` is untouched
   (Foundry never writes `type` from this assignment), so nothing is corrupted on
   disk and a reload reads the right subtype back — but for the life of that
   instance `isSessionDoc(page)` (`scripts/logic/mej-type.mjs`, which tests
   `doc.type`) is **false**, and every consumer that goes through it (search,
   auto-link, the Hub index, export, the graph) would miss that page.
   Nothing observable came of it in this wave's runs — the api-mode suite is at
   its baseline and the gates are green — which is precisely why it is worth
   recording before it bites: it is a live, silent divergence between the
   document on disk and the document in memory.
   The fork's existing carve-out at `:4347-4352` guards only the `unsetFlag`
   branch; the fix is to carve foreign (module-prefixed, non-MEJ) subtypes out of
   the `object.type = type` assignment too — which is exactly what the
   companion's shim wrap 2 now does on stock, for every type the companion
   declares (`scripts/integrations/shell-shim.mjs`, wrap "fixType", after the
   2026-09-20 fix wave generalized it from the session type alone to
   `isCompanionPageType`). Owner: **MEJ backlog** (fork side; PR #821 is frozen,
   so not there).
