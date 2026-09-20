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

Every other failure reproduced: **45 failures to attribute.**

## Attribution

Eight root causes account for all 45 — six of them visible in run 1, and two
more (I and J) that only became visible once the largest cluster was out of the
way. Classes are the brief's: `platform`,
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

**A. MEJ's `allow-player` world setting was off (14 tests) — `harness`.**
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

**I. `HTMLProseMirrorElement#save()` does not exist on Foundry 13 (1 test) — `platform`.**
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
v13 commit path — both design work. Follow-up 6.

**J. `06-player-collab` is unstable on this stack (observation, not a class).**
Its eight tests are the collaborative-ProseMirror ones, and after cause A was
fixed they do not agree with themselves: run 3 failed `:328` and `:366`
(6 passed / 2 failed), while an isolated rerun of the same file minutes later
failed `:147`, `:205`, `:288` and `:328` (4 passed / 4 failed). Only `:328`
fails in both, and it has a cause (I). The other three are timing-sensitive on
Foundry 13 / dnd5e 5.3.3 and no single run's set of them is meaningful.
Follow-up 7.

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
| `06-player-collab` | GM notes commit on pencil close | 328 | `harness`, then `platform` | A in run 1; once that was fixed, I — no public `HTMLProseMirrorElement#save()` on 13.351 | `4f94527`, then none | follow-up 6 |
| `06-player-collab` | recap survives closing the shell with the editor open | 366 | `harness`, then flaky | A in run 1; failed run 3, passed the isolated rerun — J | `4f94527` | follow-up 7 |
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

Root cause F splits across two classes on purpose: the three rows whose
*subject* is the extension API or MEJ's dialog are `mej-13.06` (the thing under
test is genuinely absent on stock), while the seven that merely needed a Session
document to exist are `harness` (the test chose an api-only way to make one).

## Fixes

Seven commits, each with its test.

| commit | fix | test |
|---|---|---|
| `e2fe738` | `HubShellDocument.update()` is a local no-op, like `setFlag`/`unsetFlag` | `test/hub-shell-document.test.js` (new, 2 unit tests; red before the change with "doc.update is not a function") |
| `4f94527` | global setup turns MEJ's `allow-player` world setting on (`ensureMejPlayerAccess()`) | `03-search.spec.mjs` on v13: was 2 passed / 2 failed, now 7/7 |
| `02a9858` | `login()`/`gotoGame()`/`reloadGame()` wait for the companion's sheet registrations (`waitCompanionWired()`) | `10-secrets-hub` + `20-timeline-journal-open` on v13: was 3 failed + 5 never-run, now 12 passed / 1 failed |
| `6b1e1e9` | global setup sweeps an empty leftover timeline journal, reusing `cleanupTimelineJournals(page, [])` | `02-hub-timeline.spec.mjs` on v13: was 2 passed / 3 failed, now 8/8 |
| `391fdba` | `createSessionEntry()` routes around MEJ's New Entry dialog on a stock build; the dialog-specific test and `12-native-mode:215` skip | `01-session` + `12-native-mode` on v13: was 8 failed, now 14 passed / 2 skipped |
| `49cb24b` | `00-mej-api.spec.mjs` skips with no extension API | `00-mej-api` on v13: was 2 failed, now 2 skipped |
| `22dd94d` | `secret-block` assertions fall back to `button.reveal`'s hidden state where `revealable` does not exist | `09-secrets` on v13: `:773` green; the file went 6/8 → 16 passed / 1 failed |

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
`harness`: MEJ's `allow-player` world setting (14 tests), a leftover empty
timeline journal (3), and specs that assumed the fork's extension API (10, of
which 3 are genuinely api-only and now skip). None of them is a defect in
anything, and all of them would have kept failing on every future v13 run.

**Four failures remain in run 3**, none of them blocking and none of them new
companion defects: `10-secrets-hub:167` (the MEJ 13.06 defect, follow-up 1),
`09-secrets:970` (the same failure the v14 line already carries as a baseline,
follow-up 3), `06-player-collab:328` (Foundry 13 has no public
`HTMLProseMirrorElement#save()`, follow-up 6) and `06-player-collab:366` (which
passed on its isolated rerun; the file is unstable on this stack, follow-up 7).

**What this does NOT establish.** The suite runs in native mode on stock MEJ
13.06, which is what the shim was built for — it says nothing about MEJ 14.01 in
native mode, whose stock gate the 14.01 sweep left failing. `13-stock-smoke`
is skipped in a normal run (it needs `STOCK_PHASE`), so this sweep did not
exercise it; that gate is still owed. And nothing here was run against a fork
MEJ on Foundry 13, so no A/B separates "Foundry 13" from "stock MEJ" for any row
attributed to the platform.

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

2. **Native mode wires itself after `game.ready`, and the gap is user-visible.**
   Measured: sheet registrations land 1–3s after ready on this stack, and
   anything opened before then resolves to `BaseSheet` and trips follow-up 1.
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

3. **`09-secrets:970` — shared with the v14 line.** Same test, same symptom, on
   both stacks; the 14.01 sweep carries it as `baseline`. It needs one
   investigation that serves both lines, not a v13 one. Owner: sub-project.

4. **`assertNoConsoleErrors` still records only message text.** Root cause B was
   invisible for a whole sweep because the harness stores `msg.text()` and
   nothing else: eight tests failed with a one-line TypeError and no stack, no
   source location, and no clue which document was involved. The 14.01 sweep
   raised the same gap for a 404 URL. Worth recording `msg.location()` and, where
   the console argument is an `Error`, its `stack`. Owner: harness backlog.

5. **`world-b` is a module-rich world.** lib-wrapper, campaign-record,
   omnipresence, monks-active-tiles, levels and others are active, and
   omnipresence runs a macro-sync reconcile on every login. Nothing in this sweep
   was attributed to them, but it is not the clean two-module world the v13 stock
   gate's description implies; worth stating in `tests/e2e/README.md`. Owner:
   harness backlog.

6. **`SessionSheet.onEditGmNotes` has no commit path on Foundry 13.**
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

7. **`06-player-collab` is unstable on Foundry 13 / dnd5e 5.3.3.** With cause A
   fixed, run 3 failed `:328` + `:366` and an isolated rerun minutes later failed
   `:147`, `:205`, `:288` + `:328` — different sets, same file, all of them
   collaborative-ProseMirror tests. `:328` has a cause (follow-up 6); the rest
   need someone to decide whether the editor's collaborative join is genuinely
   slower on this stack (a timeout question) or whether something is really
   racing. Until then no single run's failure set from this file should be read
   as a signal. Owner: harness backlog / sub-project.
