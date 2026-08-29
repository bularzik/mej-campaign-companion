# Bugfix sweep — design

**Date:** 2026-08-28
**Branch:** `fix/bugfix-sweep`
**Baseline:** `main` @ `731e715` (0.12.0)
**Status:** inventory complete; Round 1 awaiting approval to implement

## Purpose

A whole-module defect sweep of `mej-campaign-companion`: collect every known
open issue carried forward from prior rounds, add what a fresh read of the
source turns up, and decompose the result into implementable rounds.

This document is the authority the per-round plans argue from. Round 3
(secrets-layer semantics) is explicitly **not** covered here beyond scoping —
it changes a persisted data contract and gets its own spec.

## Baseline health

Measured on `main` @ `731e715` before any change:

- `npm test` — **602 passing**, 0 failing.
- `npm audit` — **0 vulnerabilities** (with and without dev dependencies).
- Open GitHub issues — none.
- 52 unit-test files; 19 Playwright e2e spec files.

> **Correction.** This section first recorded 1204 passing. That number was
> wrong, and the reason it was wrong is itself finding **C15** below: `npm test`
> run in a checkout that contains git worktrees collects *their* test files too,
> so the figure was this checkout double-counted with the `media-routing`
> worktree nested inside it. The real per-checkout suite is 602. Round 1 fixes
> the collection bug first, so every later round's verification measures the
> checkout it was started from.

Nothing below is a regression. Every item is either a defect that has always
been present, or a known issue previously parked by an earlier round.

## Method and coverage

Two passes.

**Pass 1 — pattern sweep** across all 82 source files: HTML-injection sinks,
`eval`/`Function`, unescaped Handlebars, socket registration and gating,
`isGM` distribution, upload and `fetch` surfaces, settings scopes, regex
construction, loose equality, `parseInt` radix, swallowed `catch`, floating
promises, unguarded DOM derefs, `await`-in-`forEach`, hook-registration leaks.

**Pass 2 — full line-by-line read** of the highest-risk files (~6,000 lines):

`apps/CampaignHubPage.mjs` (all 1751 lines) · `apps/import-wizard.mjs` ·
`apps/import-upload.mjs` · `apps/hub-graph-pane.mjs` · `sheets/SessionSheet.mjs` ·
`integrations/mej-adapter.mjs` · `search/live-index.mjs` · `campaign-companion.mjs` ·
`hooks/auto-capture.mjs` · `hooks/retro-link.mjs` · `hooks/secrets-ui.mjs` ·
`hooks/knowledge-ui.mjs` · `hooks/media-relay.mjs` · `hooks/player-recap.mjs` ·
`hooks/socket.mjs` · `logic/media-relay.mjs` · `logic/reveal-state.mjs` ·
`data/timepoints.mjs` · `data/campaign-store.mjs`

**Not** read line-by-line: the remaining pure `logic/` modules, which carry
dense unit-test coverage and were covered only by Pass 1. A residual defect
is most likely to be hiding there.

### Audited and found sound

Recorded so these are not re-audited in a later round:

- **Socket dispatcher** (`hooks/socket.mjs`) — single registration, routed by
  action, GM actions gated on the *elected* `activeGM` rather than bare
  `isGM`, per-handler try/catch isolation. The authorization decision is
  extracted as a pure, unit-tested function.
- **Player-recap relay** — GM-side ProseMirror round-trip sanitization before
  any write, writes scoped to a single flag path, sender validated against
  the real user list. Stricter than MEJ's own `saveUserData` precedent.
- **Upload relay** — MIME validated against a renderable-image allowlist,
  caller's extension never trusted (`enforcedImageName`), size cap, chunk-count
  cap, concurrent-buffer cap, stale-buffer eviction, filename uniquified.
- **Regex construction** — both `new RegExp` sites are safe: `search-index.mjs:75`
  escapes its input; `secret-blocks.mjs:14` interpolates only literal attribute
  names. No ReDoS surface.
- **Settings** — no sensitive data in any `world`-scope setting.
- **Search-index permission gating** — `searchAll`/`runQueryAll`/`backlinksForEntry`/
  `mentionBadgeCounts`/`backlinkPairs`/`gmSecretRecords` all gate on `isGM` and
  re-check `testUserPermission` against the live document.
- **Client-side-only confidentiality of GM content** — already documented
  honestly in `README.md:39` and `docs/gm-guide.md:157`. Inherent to Foundry's
  document model, not a defect, and the docs already say so.

## Finding inventory

Severity is impact-on-a-real-table, not exploitability.

### Security

**S1 — Unsafe HTML parser on authored content (Medium).**
`apps/CampaignHubPage.mjs:852` and `hooks/secrets-ui.mjs:145` parse page HTML
with `document.createRange().createContextualFragment()`, which parses in the
live document's context — `<img src=x onerror=…>` can fire. The codebase
already uses the inert `DOMParser` for the same job at `apps/import-upload.mjs:82`
and `apps/import-wizard.mjs:267`, so this is an inconsistency rather than a
missing idea.
*Reachability:* the GM-side site runs when a GM clicks reveal on a block
secret, against body HTML anyone with edit rights on that page authored —
relevant when `playersWriteSessions` is on, or on any shared entry. The
player-side site additionally starts image fetches for secret sections that
viewer is not cleared for, before line 155 removes them.
*Fix:* `DOMParser().parseFromString(html, "text/html")` at both sites.
*Round 1 note:* implemented across **five** sites, not two. A sweep after
fixing the two exposed ones found three more (`knowledge-ui.mjs:89` and
`relationships-ui.mjs:210,217`). Those interpolate only escaped, module-owned
markup and were not themselves exposed, but leaving any live-context parse in
the module invites copying it to a site whose input is not escaped, so the
invariant is now "`createRange().createContextualFragment` appears nowhere in
`scripts/`" — which is checkable, where "the risky ones are fixed" is not.

**S2 — Search index goes stale across a confidentiality-relevant setting (Medium).**
`search/live-index.mjs:82-90` splits a person's attributes into public
(`record.fields`) and GM-only (`record.gmFields`) using
`personAttributeHiddenKeys()` (`:50-62`), which reads MEJ's `sheet-settings`
world setting **at index time**. No hook re-indexes when that setting changes;
`rebuildIndex()` exists but nothing calls it for this. A GM who marks a person
attribute `playerHidden` leaves its value in the **public** token set —
searchable by players — until a world reload.
*Fix:* re-index on the setting change. MEJ owns the setting, so watch it via
its registered `onChange` if reachable, else re-derive the hidden-key set at
search time rather than index time.

**S3 — Upload-result path check permits traversal (Low).**
`hooks/media-relay.mjs:170` guards a claimed reply path with
`startsWith(RELAY_UPLOAD_DIR() + "/")`. The guard's own comment states its
purpose is to stop a forged reply pointing outside the relay directory;
`…/uploads/../../../elsewhere.png` satisfies `startsWith` and walks straight
past it. Requires guessing a `randomID()` request id.
*Fix:* reject any path whose segments include `..` (or normalize before compare).

**S4 — Relay assembler trusts first-chunk metadata only (Low).**
`logic/media-relay.mjs:86-95` records `senderId`/`name`/`type` from the first
chunk of a request id and never re-checks them on subsequent chunks, so a
client that learns an in-flight request id can contribute bytes to it. Only
`total` is cross-checked (`:97-100`).
*Fix:* reject a chunk whose `senderId`/`name`/`type` disagree with the buffer.

**S5 — Vendored bundles are unversioned and outside dependency auditing (Medium).**
`vendor/mammoth.browser.min.js` (636 KB) and `vendor/docx.iife.js` (1.1 MB)
carry no version string, no provenance comment, and no regeneration script,
and appear in no manifest — so `npm audit`'s clean result never examined them.
`vendor/d3-force.esm.js` at least carries a provenance comment. Mammoth is the
parser fed untrusted `.docx` input.
*Fix:* record exact version and source for each, add a provenance header and a
documented regeneration command, and list them somewhere a CVE check can reach.

### Correctness — data integrity

**C1 — `onFileAllShown` can mass-refolder the world (Medium-High).**
`apps/CampaignHubPage.mjs:1161-1174`. The method's own doc comment says
"GM-only, Unfiled-scope-only", but the only guard is `isGM`. It recomputes
rows from `#scopedEntries()`, which in **All** scope returns every campaign's
members plus unfiled entries, and bulk-writes `folder` on all of them via
`JournalEntry.updateDocuments`. Only the template's render gate prevents this;
the file's stated convention everywhere else is that a handler re-checks its
own precondition ("the action is wired regardless of GM status … re-checks
`game.user.isGM` itself as a second guard", `:1230-1235`). Bulk, silent, and
laborious to undo by hand.
*Fix:* return early unless `#scope().unfiled` is true. Apply the same guard to
`onFileIntoCampaign` (`:1150`), which carries the identical doc claim for a
single row.

**C2 — `mergeEncounter` destroys GM edits (Medium).**
`hooks/auto-capture.mjs:183-190`. Documented as an additive merge, and the
actor roster genuinely is merged — but `text.content` is replaced wholesale
with a regenerated summary. A GM who writes up an encounter loses that prose
when the same combat's end fires again (the re-fire path the
`encounterPagesByCombatId` map exists to serve).
*Fix:* merge the description rather than replace it, or leave existing
`text.content` untouched when it differs from what this module last generated.

**C3 — Import dies silently on a malformed inline image (Medium).**
`apps/import-upload.mjs:92` calls `dataUriToFile` **outside** the per-image
try/catch at `:97-102` (which wraps only `uploadImportFile`). `dataUriToFile`
runs `atob(parsed.base64)` at `:21`, which throws on a corrupt base64 body.
That propagates out of `uploadInlineImages`, out of `#onCreate`'s outer try
(`apps/import-wizard.mjs:598-638`) past its `finally`, so `this.close()` and
`#showResult` at `:640-641` never run. The GM sees no error, no result dialog,
and a re-enabled button — with some documents already created.
*Fix:* bring `dataUriToFile` inside the per-image try; treat a throw as a
skipped image with a warning, matching the existing `result.skipped` path.

**C4 — Recap save races the form submit (Medium).**
`sheets/SessionSheet.mjs:489` fires `savePlayerRecap(...)` without awaiting,
then `:492` calls `super.onSubmit`. On the owner path `savePlayerRecap` issues
`document.update()` directly, so two updates to the same document are in
flight concurrently. (The relay path is fire-and-forget by design and is fine.)
*Fix:* await the direct-write path before delegating to `super.onSubmit`.

### Correctness — UX and robustness

**C5 — Dashboard dialog discards everything typed (Medium).**
`apps/CampaignHubPage.mjs:767-782`. The `ok` callback returns `null` on a
blank name or an unparseable query, but `DialogV2.prompt` closes regardless of
the callback's return value. The GM types a name and a long query, gets a
"bad query" toast, and loses both. Parked since Phase B; confirmed still live.
*Fix:* validate before the dialog resolves and keep it open, or re-open
pre-filled with the rejected input.

**C6 — Graph redraws on every unrelated re-render (Medium, performance).**
`apps/CampaignHubPage.mjs:1705-1714` calls `drawGraphPane` whenever the SVG is
present in the DOM, and `drawGraphPane` (`apps/hub-graph-pane.mjs:134-135`)
stops and rebuilds the d3 force simulation. Every debounced keystroke in the
index filter re-renders `main` (`:1664-1668`), so typing a filter restarts the
physics simulation — with the graph tab not necessarily visible.
*Fix:* only draw when the graph tab is the active tab, and skip the rebuild
when the graph data is unchanged.

**C7 — Retro-link walks the whole world per created entry (Medium, scale).**
`hooks/retro-link.mjs:30-61`. `planForEntity` iterates every page of every
journal and computes `viewerIds` per entry, once per newly created MEJ entry,
serialized through `retroChain`. A 50-section docx import performs 50
consecutive full-world walks.
*Fix:* hoist the page/viewer snapshot out of the per-entity pass, or batch a
creation burst into one pass.

**C8 — Encounter naming prefers the wrong scene (Low-Medium).**
`hooks/auto-capture.mjs:204` resolves `game.scenes?.current ?? combat.scene`.
The combat's own scene is authoritative for naming an encounter that happened
there; it should not be the fallback.
*Fix:* prefer `combat.scene`.

**C9 — Graph drag closes over the module-global simulation (Low).**
`apps/hub-graph-pane.mjs:67-92`. `move()` guards `if (!activeSim) return`
while `up()` dereferences `activeSim.alphaTarget(0)` unguarded — an asymmetry
that is itself the smell. Both close over the module-level `activeSim`
(`:18`) rather than the simulation the handler was bound for, so a drag still
in progress across a redraw perturbs the *new* simulation with the *old*
graph's node objects.
*Fix:* capture the simulation in the closure; guard `up()`.

**C10 — Unguarded `closest().dataset` derefs (Low).**
`hooks/knowledge-ui.mjs:170`, `apps/import-wizard.mjs:343` and `:358`,
`apps/CampaignHubPage.mjs:860` and `:1447`. Each dereferences a `closest()`
result with no `?.`. Safe today given where the handlers bind; a
one-character hardening against markup drift.

**C11 — `onEditDashboard` mutates the settings cache in place (Low).**
`apps/CampaignHubPage.mjs:800-806`. `[...array]` is a shallow copy, so
`existing` is the same object the settings cache holds; `Object.assign(existing,
result)` mutates it before `set()` is called. If the write fails, the client
shows the change anyway until reload.

**C12 — `campaign-store` ownership writers lack the guard the file claims (Low).**
`data/campaign-store.mjs` — `createCampaign:28` and `ensureCampaignPortal:54`
both self-check `isGM`, and `apps/CampaignHubPage.mjs:1006-1009` documents
that convention as the reason its actions are safe to leave wired. But
`applyBaselineToMembers:94` and `setEntryHidden:106` — the two ownership-
mutating functions — have no such check. Not exploitable (Foundry rejects
server-side), but it breaks the stated invariant.

**C13 — `trackedPanels` grows and rescans (Low).**
`hooks/knowledge-ui.mjs:41-65`. The `Set` holds wrapper objects strongly (only
their `sheet`/`element` fields are `WeakRef`), pruned solely inside
`refreshTrackedPanels`; and `trackPanel` scans the whole set on every
injection.

**C16 — The dashboard "bad query" validation is unreachable (Low, found during Round 2).**
`#promptDashboard` rejects a blank name-or-query first, then tries
`parseQuery(query)` in a try/catch. But `parseQuery` is permissive: it throws
only `"empty-query"`, for input that is empty or all whitespace — which the
preceding `!typed.query` check has already caught. So the `badQuery` branch,
and the `MEJCampaignCompanion.hub.dashboards.badQuery` string it shows, can
never fire from this dialog. Verified directly against the grammar:
`attr:=:=broken`, `attr:`, `((`, and `"unclosed` all parse successfully.
*Consequence:* a GM can save a dashboard whose query is meaningless — it
simply matches nothing, with no feedback that it was misunderstood.
*Fix (not done):* either tighten the grammar so malformed tokens are real
errors, or drop the dead branch and stop promising validation that does not
happen. Left for a round that can decide which, since it is a grammar
question, not a bug in the dialog. The branch is kept in place meanwhile so a
stricter grammar stays covered.
*Found by:* writing the C5 regression test, which initially asserted against
a "bad" query that turned out to parse fine.

**C15 — `npm test` collects other worktrees' tests (Medium, found during Round 1).**
`vitest.config.mjs:12` excludes `node_modules` and `tests/e2e/**`. A git
worktree is a complete second checkout living at `.claude/worktrees/<name>/`,
so vitest's default include glob collects its `test/` files too — and the
`tests/e2e/**` exclude is checkout-relative, so it does not match
`.claude/worktrees/<name>/tests/e2e/**` and those Playwright specs get
collected as vitest tests and fail. Measured in the main checkout while it
held two worktrees: **196 test files, 38 failing, 1832 tests**, against a real
suite of 602. A run can therefore report a green number measured partly against
a branch you are not on — which is exactly how this document's original "1204
passing" baseline came to be wrong.
*Fix:* add `**/.claude/worktrees/**` to the exclude list. Done first in Round 1,
because every other round's verification depends on the number being real.

**C14 — Empty `data-position` inserts a timepoint at the head (Low).**
`apps/CampaignHubPage.mjs:1401-1402`. `Number("")` is `0`, which is an
integer, and `"" != null` is true — so an empty attribute yields position 0
rather than the intended "append".

### Carried known issues

Parked by earlier rounds, still open. Sources: project memory and
`docs/manual-test-checklist.md`.

| Item | Round |
|---|---|
| "Everyone" stored as `audience.all`, not Foundry's native `revealed` class — core sheets and player-safe exports treat it as unrevealed | 3 |
| Recap-sourced block secrets have no reveal path (`injectPlayerSecrets` re-enriches only `text.content`; the tracker suppresses the control at `CampaignHubPage.mjs:745`) | 3 |
| Popped-out player sheets don't live-refresh on reveal | 2 |
| `relReveals` records orphan when a relationship is deleted | 2 |
| Group-membership changes apply only at next render | 2 |
| Graph windows sharing a fixed DOM id — **verify first**, likely obsolete since 0.9.0 made the graph a Hub pane | 2 |
| User guides and their 23 screenshots still describe the pre-0.9.0 toolbar | 5 |
| In-repo `module.json` `download` field still points at 0.3.0 (release assets are patched per convention; only the repo copy misleads) | 5 |
| `14-campaigns` "world unchanged" assertion flip-flops — a GM Hub render lazily creates a timeline via `ensureTimelineJournal()` | 5 |
| `06-player-collab` flakes on full-suite runs, passes in isolation | 5 |

### Out of scope

- **MEJ-side defects.** The Session sheet header squeeze that hides Player
  Recaps, the Convert-Sheet "text" flag strip, and the TOC full-text toggle
  all live in Monk's Enhanced Journal. Standing project ruling: companion
  features never patch MEJ. Report upstream; do not fix here.
- **Client-side-only confidentiality of GM notes and secrets.** Inherent to
  Foundry's document model and already documented (see *Audited and found
  sound*).
- **Sub-project-2 follow-ups** (import "no campaign" option, adoption-before-
  import UX, bulk-apply "include hidden", timeline-journal-in-subfolder).
  These are enhancements, not defects.

## Round decomposition

Each round is a separate branch, review, and release. Rounds 1, 2, 4, and 5
are bounded work against flows that already exist — no plan document. Round 3
gets the full ceremony.

**Round 1 — Security and data integrity.**
C15 (first — it makes the other verifications trustworthy), then S1, S2, S3,
S4, S5, C1, C2, C3, C4.
Rationale: every item is contained and independently testable, and this round
carries the two findings that cause real harm without anyone noticing — S2
(a player-visible attribute that the GM believes is hidden) and C1 (silent
bulk refoldering).

**Round 2 — UX correctness.**
C5, C8, C9, C10, C11, C12, C14, plus the carried items marked Round 2 above.
The graph-DOM-id item is a verification task first: confirm whether 0.9.0's
pane rewrite already closed it before writing any fix.

**Round 3 — Secrets-layer semantics.** *(own spec required)*
The two coupled carried items: "Everyone" writing the native `revealed` class,
and a reveal path for recap-sourced block secrets. These are one problem seen
twice — the reveal engine's relationship to Foundry's native secret model.
Changing what "Everyone" persists alters a stored data contract and requires a
migration decision for existing worlds, so this round starts at brainstorming,
not at a patch.

**Round 4 — Performance and scale.**
C6, C7, C13. Separated from Round 2 because each needs a before/after
measurement rather than a pass/fail test.

**Round 5 — Documentation and test hygiene.**
The four carried Round 5 items.

## Verification

Per round:

- Every behavioral fix lands with a unit test that fails before it and passes
  after. The pure-logic seam (`scripts/logic/`) is where that test belongs
  whenever the fix can be expressed there.
- Fixes to Foundry-touching code that unit tests cannot reach get e2e
  coverage in the relevant existing spec file rather than a new one, unless
  the round introduces a genuinely new surface.
- **Assert usability, not just presence.** The 0.12.0 round shipped a viewer
  with no CSS that survived four green e2e runs because every assertion was
  presence-only. Where a fix is about what the user can actually do, assert
  dimensions, enablement, or content — not existence.
- Full `npm test` green before the round's PR; the e2e specs covering the
  touched areas green against the live Foundry v14 world.
- `npm audit` clean.

Round 1 additionally needs:

- A regression test proving S2: index a person with a hidden attribute, flip
  the setting, and assert a non-GM search no longer matches it.
- A regression test proving C1 refuses to act outside Unfiled scope.
- A test proving C3 reports a malformed inline image rather than aborting the
  import.

## Round 1 outcome (complete)

Landed on `fix/bugfix-sweep`: C15, S1, S2, S3, S4, S5, C1, C2, C3, C4.

Verification actually run:

- Unit suite **602 → 628** (26 new tests), green.
- `npm audit` clean; `npm run check:links` green; new `npm run check:vendor`
  green, and verified to exit non-zero against a deliberately tampered bundle.
- E2E against the live Foundry v14 world: **33/33** across `01-session`,
  `03-search`, `04-auto-capture`, `07-knowledge`, `09-secrets`, `14-campaigns`.
- All three required regression tests written. S2 and C1 are e2e (neither
  reaches a unit-testable seam); C3's is a unit test on `dataUriToFile`.
- **Vacuity-checked.** Both new e2e tests were re-run with their fix
  deliberately disabled and both failed; restored, both pass. This is the
  check the 0.12.0 round skipped, when presence-only assertions survived four
  green runs against a viewer that had no CSS at all.

Known residue, deliberately not closed here:

- The vendored libraries' **versions remain unidentified** (S5). The integrity
  check and provenance file are in; identifying or re-vendoring them changes
  docx import/export behavior and belongs in its own change with the
  round-trip e2e run against it.
- C3's unit test proves `dataUriToFile` is total; that the resulting warning
  actually surfaces in the wizard's result dialog is not asserted.

## Round 2 outcome (complete)

Landed on `fix/sweep-round2`, cut from `main` @ 0.13.1: C5, C8, C9, C10, C11,
C12, C14, plus three carried items (relReveals orphan pruning, group-membership
live refresh, popped-out sheets refreshing on reveal).

- **Carried item closed by someone else:** "graph windows share a fixed DOM id"
  was already fixed by 0.13.0's graph-portraits work, which added a per-draw
  `clipNonce` for exactly that reason. Verified by reading, not assumed.
- **C16 found and recorded** (above) while writing the C5 regression test.
- C5's regression test was **vacuity-checked**: reverted to the
  discard-and-close behaviour, test failed; restored, it passes.

Round 2 fixes are all Foundry-glue, so they carry e2e rather than unit
coverage; the unit suite is unchanged at 635.

## Round 3 outcome (complete)

Landed on `feature/secrets-native-reveal`, cut from `main` @ 0.13.2. Released
as **0.13.3**. Both carried secrets defects are closed: "Everyone" now writes
Foundry's native `revealed` class, and recap-sourced block secrets have a
reveal path from both the sheet and the Hub tracker.

The final whole-branch review found two Criticals I had introduced, both worth
recording because neither was visible to a green suite:

- **C1** — I under-implemented my own spec §4. The shared "revealed to
  everyone" reader was wired only at the tracker, so the audience dialog
  seeded Everyone from a flag that is never written true any more. Adding one
  player to an everyone-revealed secret stripped the class and silently
  un-revealed it for the whole table. The existing e2e passed throughout: it
  called `applyBlockReveal` directly, one layer below where the bug lived.
- **C2** — `applyBlockReveal` cleared `all` on paths where it never wrote the
  class, destroying a legacy record with nothing replacing it.

### Carried forward from the Round 3 re-review

- **Duplicate section ids across pages of one entry.** Duplicating a journal
  page copies section ids verbatim. The search index keys reveal records by
  entry (last-page-wins) while the tracker resolves the page by containment
  (first match), so with pages A and B both holding `id="secret-dup"` a row
  sourced from B can resolve to A: un-revealing strips A's class and leaves
  B — the row's actual subject — untouched. The honest fix is for the index
  to key by page rather than entry, which is a structural change, not a
  patch. **Round 4 or later.**
- **`#secretSectionHtml` uses a first-MEJ-page find** plus an inline
  `system.recap ?? text.content` rather than `bodyRegion`, so on a multi-page
  entry the tracker whisper falls back to the 140-char index preview instead
  of the real section HTML. Pre-existing; cosmetic.
- **`pruneOrphans` reads one page's body but prunes the entry-level flag**, so
  opening page 1 of a two-page entry deletes reveal records belonging to
  page 2's secrets. Pre-existing and a genuine data-loss path — it should be
  fixed with the index-keying change above, since both stem from reveal
  records being entry-scoped while the sections they name are page-scoped.
- **One observed flake:** "reveal to Everyone round-trips through the real
  control" failed once in a full 14-test run, then passed in an isolated run,
  a paired run, and two further full runs. Not order-dependent as far as those
  runs show. Recorded rather than dismissed; belongs with Round 5's flake work.

## Round 4 outcome (complete)

Landed on `fix/sweep-round4`, cut from `main` @ 0.13.3. Released as **0.13.4**
(PR #20, merge `4b4f6e9`). C6, C7 and C13 all closed. Unit 679; broad e2e
50/50 across 8 specs on two consecutive runs.

**The spec's own C7 fix was unsafe and was not used.** It proposed hoisting
the page/viewer snapshot out of the per-entity pass; `hooks/retro-link.mjs`
already documented why that breaks — passes are serialized precisely so each
re-reads page content after the previous one's writes land, or the second
write clobbers the first's links. The round batched the burst into one plan
instead, which removes the hazard rather than managing it, and collapses a
50-section import's 50 confirm dialogs into one.

**C6 turned out bigger than the spec assumed.** The spec's "skip the rebuild
when the graph data is unchanged" cannot work on its own: measured live, the
`<svg>` element is REPLACED on every `main` re-render, so an element-keyed
cache never hits. The graph is drawn on tab activation instead (tab switches
are CSS-only and do not re-render), which is what makes the signature cache
load-bearing at all.

### Six defects found by the gates, four of them mine, two concealed by green tests

- **Critical: batch candidates were not sorted longest-name-first.**
  `autoLinkAdded` documents that precondition (each match claims its words).
  It was vacuous for the old one-entity-per-call planner and became
  load-bearing under batching. An import creating "Elara" before "Elara
  Moonwhisper" linked the WRONG entity into the page and left the correctly
  named one unlinked. **The new unit test passed it by luck** — it built the
  burst only in the already-sorted order. It now asserts both orders.
- **Important: the 200ms burst window did not survive the real importer**,
  which awaits a server round trip per section; on a slower install every
  section closed its own burst, silently reverting to the old behaviour
  while the changelog promised one dialog.
- Two Minor: the login sweep cleared every pending flag up front (one
  interruption dropped the whole backlog); a deleted entry could still get a
  dead link written, and the mid-dialog re-plan could promote an entity from
  "ambiguous — not written" to written.
- Caught by the broad e2e sweep BEFORE review, both regressions I introduced:
  deferring the burst also deferred a flag-clearing write that MEJ's
  `fixType` normalization rides on (fresh entries read as
  `mej-campaign-companion.session` instead of `session`); and the C13
  refactor dropped a JS `Set` ordering guarantee — re-adding moves an item to
  the end, which kept the nested-element refresh from rendering the
  "Mentioned in" panel twice.

**Method note worth keeping:** the targeted tests for each item passed while
three specs that pass on `main` failed. Diffing a broad sweep against the
base commit is what surfaced them; a green targeted suite proved nothing.

## Round 5 scope (reconciled 2026-08-29)

Re-checked the four carried items against `main` @ 0.13.4 before starting.
Two are already closed and are dropped from the round with the evidence:

| Carried item | Finding |
|---|---|
| In-repo `module.json` `download` points at 0.3.0 | Fixed in 0.12.0 (`731e715`); both `manifest` and `download` point at `releases/latest/download/`. **Obsolete.** |
| `14-campaigns` "world unchanged" flip-flop | The suite now snapshots the `Campaign Timeline` journal count alongside the settings and restores both; 12/12 in both Round 4 full sweeps. **Obsolete.** |

The remaining two become two workstreams, approved at full scope:

**Workstream A — guides to 0.13.x.** The staleness is wider than "the
pre-0.9.0 toolbar": neither guide mentions any post-0.9.0 feature (header bar
and Tools menu, Campaigns pane and picker, Unfiled filing, portal,
multi-timeline, portraits, or 0.13.3's native "revealed" semantics), the Hub
now has six panes (Graph is a pane, not a toolbar icon), and all 23 images
date from 2026-08-20. Method: (1) a read-only live-UI audit as GM and as
player is the source of truth — never the changelog; (2) both guides are
rewritten section by section on the existing heading skeleton, with new
sections for Campaigns and the Portal, keeping existing image filenames
stable; (3) `guide-screenshots.spec.mjs` seeding is extended to create a
campaign so the new panes have content, and every image is recaptured under
`GUIDE_SHOTS=1`. Reviewer gate: each image is checked against the prose that
cites it; `npm run check:links` green.

**Workstream B — flakes: root-cause or quarantine.** `06-player-collab` (not
in any Round 4 sweep, so unverified) plus the three one-offs recorded in
Round 4: `09-secrets` "reveal to Everyone round-trips", `07-knowledge`
"playerHidden", `04-auto-capture`. Bar: run the full 18-spec suite at least
five times, logging every failure with its run position. A reproducing
failure gets systematic debugging, a fix, and a vacuity check. One that
does not reproduce across ≥5 full runs is closed as *unreproduced* with the
run log recorded here. Never a blanket retry.

**Release rule for this round.** Documentation alone does not cut a release;
0.13.5 is cut only if Workstream B lands a product fix.

## Round 5 outcome

Workstream B (flake triage) run on `fix/sweep-round5`, base `main` @ `c93d2a8`
(0.13.4). Five full-suite baseline runs (`run-1.log` … `run-5.log` in
`.superpowers/sdd/2026-08-29-sweep-round5/`), then targeted repro runs per
item. **No `scripts/` change landed — the fixes are all in `tests/e2e/`, so by
this round's own release rule 0.13.5 is NOT cut.**

### Failures by run (105 tests: 93 run, 12 skipped — `13-stock-smoke` needs `STOCK_PHASE`)

| Test | R1 | R2 | R3 | R4 | R5 | Rate |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `15-campaign-portal.spec.mjs:331` — 6. migration backfills a portal for a legacy campaign | ✗ | ✗ | ✗ | ✗ | ✗ | **5/5** |
| `14-campaigns.spec.mjs:68` — adoption: banner pre-adoption … full restoration | ✓ | ✗ | ✓ | ✓ | ✓ | 1/5 |
| `02-hub-timeline.spec.mjs:207` — index row click opens the entry in MEJ … | ✓ | ✓ | ✗ | ✓ | ✓ | 1/5 |
| `09-secrets.spec.mjs:83` — GM reveals a block to User 1 … | ✓ | ✓ | ✓ | ✓ | ✗ | 1/5 |
| `06-player-collab.spec.mjs` (all three) | ✓ | ✓ | ✓ | ✓ | ✓ | 0/5 |
| `09-secrets.spec.mjs:357` — reveal to Everyone round-trips … | ✓ | ✓ | ✓ | ✓ | ✓ | 0/5 |
| `07-knowledge.spec.mjs:185` — attributes: playerHidden … | ✓ | ✓ | ✓ | ✓ | ✓ | 0/5 |
| `04-auto-capture.spec.mjs` (both) | ✓ | ✓ | ✓ | ✓ | ✓ | 0/5 |

Run totals: R1 92 passed / 1 failed, R2 91/2, R3 91/2, R4 92/1, R5 91/2.

### Verdicts

**1. `15-campaign-portal:331` — REPRODUCED 5/5, and it was never a flake.**
Bisect: the same failure on this branch's HEAD *and* on `main` @ `c93d2a8`
(the branch touches no `scripts/`), so it is pre-existing, not introduced
here. Root cause: commit `14d87f2` raised `CURRENT_DATA_VERSION` 2 → 3 (the
native-reveal migration) and the test still polled for the literal `2`, so
`page.waitForFunction` could never be satisfied and timed out at 30s. The
product was fine throughout — the portal backfill it guards ran correctly
every time. **Fixed in the test**: the target version is read from the served
`scripts/constants.mjs` instead of hard-coded. *Vacuity check*: with the
backfill loop stubbed out (`missingPortalPlan(...)` → `[]`), the test fails at
`expect(after.portal).toBeTruthy()` — `Received: null` — so it still gates the
behaviour it claims to.

**2. `14-campaigns:68` — REPRODUCED deterministically, root-caused, fixed.**
Not order-dependent and not a flake: it is world-state dependent. The test
snapshots the number of journals named `Campaign Timeline`, and its final
`cleanupTimelineJournal()` deleted every empty one except the single id named
by `timelineJournalId` — so a *pre-existing* second empty copy (found state)
was deleted and the "left exactly as found" count went 2 → 1. Live proof: a
world probe found exactly that second copy present; the spec then failed on
run 1 alone and passed on runs 2 and 3, because run 1's own cleanup had eaten
the orphan. **Fixed in the test**: the snapshot records the *ids* of every
pre-existing `Campaign Timeline` journal and the cleanup excludes all of them
(`excludeIds`, replacing `excludeId`). *Regression proof*: with an orphan
re-seeded, the fixed spec passes 16/16 **and leaves the orphan in place**
(verified by id afterwards).

**3. `02-hub-timeline:207` — root-caused and fixed at the root; not
reproducible on demand.** Failure was `page.evaluate: TypeError: Cannot set
properties of undefined (setting 'links')` — i.e.
`timeline.timepoints[0]` was undefined on the journal the test had just added
a timepoint to. The test found that journal by NAME
(`game.journal.find((e) => e.name === "Campaign Timeline")`), and a world can
hold more than one journal with that name. Demonstrated live: with an older
orphan present and the setting pointing at a newer journal, name lookup
returned the **empty orphan** (0 timepoints) while the id lookup returned the
real one (1 timepoint) — `diverges: true`, exactly the crash shape. **Fixed in
the test**: a new `worldTimelineJournalId(page)` helper resolves the journal
the way the module does (through `timelineJournalId`, throwing rather than
returning null), used at all four name-lookup sites (`02` ×2, `04` ×2 — `04`
was a latent instance of the identical defect). The same site also gained a
`waitForFunction` for the Add-Timepoint dialog's write actually landing,
replacing reliance on the fixed `settle(400)` before it. 3 alone runs and 3
runs paired with `01-session` after the fix: all green.

**4. `09-secrets:83` — REPRODUCED (1/5 baseline, and twice again live in fix
round 1), root-caused to an MEJ layout state, not fixed here.** The round's own
rule is that one failure in five full runs is a reproduction, so this is not
closed as unreproduced. Six targeted runs (3 alone, 3 paired with `08`) were
green, but a diagnosing wrapper added round the click caught it once more in
the pairing runs, with the state it had been failing in:

```
target=<button class="mej-cc-secret-audience">  box=795,422 116x26
visibility=visible  pointerEvents=auto  connected=true
scroller=<div class="editor editor-display wrapper scrollable">
         scrollTop=62  clientH=0  scrollH=73
topmost=<a> inside <nav class="sheet-tabs tabs">
```

MEJ lays the enriched preview wrapper out at **clientHeight 0** while it holds
~73px of content (measured: preview 715×0 inside a 723×211 sheet container,
and it stays 0 after a forced `setPosition` + `resize` re-flow). That is the
normal state of this sheet and is harmless while `scrollTop` is 0: the element
painted at the button's box is then the wrapper itself, an ancestor, which
Playwright's hit check accepts. But a zero-height container can still scroll,
and a click's own scroll-into-view always tries (a target can never be "in
view" in a 0px viewport) — once it does, every child's box shifts up by
`scrollTop` and the button's rectangle lands over the tab strip above the
content, where it is neither painted nor clickable. No retry recovers, because
the scroll position does not come back; hence 15s of interception by
`nav.sheet-tabs`, `section.place` and `div.sheet-container` in turn.

The fix is MEJ-side (the preview must be laid out with real height) and MEJ is
out of scope for this round, so what landed is `clickWithHitDiagnostics()` —
identical click semantics, Playwright's own retry and scroll, plus this
diagnosis when it times out. **An earlier attempt to gate the click on the
target being topmost, and a second on the wrapper having non-zero height, both
made things worse and were reverted**: the gate scrolled once where Playwright
re-scrolls every retry, and the height condition is false in the *healthy*
state too (it failed a test that had never flaked, and then two runs in a row).
Recorded as a carried MEJ defect below.

**5. The other three tracked items — UNREPRODUCED (0/5).**
`06-player-collab` (all three tests), `07-knowledge` "playerHidden" and
`04-auto-capture` (both tests) passed in all five full runs. `04`'s two
name-based timeline lookups were hardened anyway (see verdict 3), since they
carry the same latent defect that broke `02`.

**6. `09-secrets:357` "reveal to Everyone round-trips" — a real flake (2/6
paired with `08-query-graph`; 0/5 in the baselines), root-caused in core and
mitigated.** It fails as `page.evaluate: Resulting promise was garbage
collected` on the FIRST evaluate after `login()`: the page's execution context
is destroyed while the call is in flight. Foundry core, `client/game.mjs`
`Game.getData`:

```js
if ( !socket.session.userId ) {
  socket.disconnect();
  window.location.href = getRoute("join");
}
return new Promise(resolve => socket.emit("world", resolve));
```

There is no `return` before the redirect, so a document whose socket session
has no bound userId navigates itself to `/join` *and* carries on booting the
world — it can reach `game.ready === true` moments before the navigation
commits. `/join` with a live session bounces straight back to `/game`, which is
the second `/game` navigation (and the second "Vended World data to User" line
in the server log) that every cookie fast-path login produces. Whenever
`game.ready` was observed on that doomed first document, `login()` returned
onto a page about to be replaced.

**Fixed at the harness seam**: `login()` (both paths) and the module
enable/disable reloads now wait for `SESSION_BOUND` —
`game.ready === true && game.socket.session.userId` — which is exactly the flag
core tests before redirecting. Measured after the change: 8/8 fresh logins
returned with both navigations already done (`navsAtLoginReturn=2`,
`navsAfter=2`) and a deliberate 3-second evaluate straight after login survived
8/8.

Binding the session *before* the first `/game` navigation (the first remedy
tried) does not work at this seam and the evidence is recorded so nobody
repeats it: `POST /join` with the saved cookie and the right userId answers
`{"status":"success","redirect":"/game"}` and the next `/game` load still makes
two navigations; the same POST without a userId answers 401
`JOIN.ErrorUserDoesNotExist` and unbinds the session outright.

**Residual — the symptom is reduced, not eliminated.** After the fix it
appeared once in a full-suite run, on the first evaluate after `login()` in a
`09-secrets` test; the 16 pairing runs itemized in the round's own report for
the `09-secrets:83` fix work (verdict 4) contain no GC failure in any bucket.
A second path therefore may still exist, and the best-supported
hypothesis is structural to the harness rather than to `getData`: every
Gamemaster login replays ONE saved session cookie
(`tests/e2e/.auth/gm.json`), so a context that Playwright has closed but whose
socket the server has not yet reaped shares a session with the context that
just logged in. When the server finally processes that close it unbinds the
shared session, and the live client's next `getData` — on any reconnect — takes
the same `/join` redirect, after `login()` has long returned.
`Game.connect`'s `session` handler calling `utils.debouncedReload()` on a
session event with no `sessionId` is a second way into the same navigation.
The obvious remedy (one Foundry session per browser context) collides with
`login()`'s own "user is already connected" guard, since several specs run two
GM clients at once, so it is not a small change. Recorded, not fixed.

**7. NEW product defect, recorded not fixed: duplicate empty `Campaign
Timeline` journals.** `ensureTimelineJournal()` (`scripts/data/timeline-journal.mjs`)
creates the journal and *then* writes `timelineJournalId`; two GM renders in
flight (or a second GM client) both pass the empty-setting check and create
one each, leaving an orphaned empty journal the setting does not point at.
This is the state behind verdicts 2 and 3, it was already documented as a
"confirmed live" race in `14-campaigns.spec.mjs`'s own comments, and it is
visible to a user as a stray empty journal. Out of scope for a flake-triage
task (the failing assertions were all test-side); a fix wants a single-writer
guard, a unit test and its own release.

### Counts

- Unit: **679 passing** (56 files) — unchanged; no `scripts/` edit.
- e2e full suite after the fixes: **93 passed, 0 failed, 12 skipped** (10.1 m),
  against baselines of 92/1, 91/2, 91/2, 92/1, 91/2.
- e2e full suite after fix round 1 (the login change touches every spec): two
  runs, **92/1 then 93/0**. The single failure was the residual described in
  verdict 6 — `09-secrets:167`, `Resulting promise was garbage collected` on
  the first evaluate after `login()` — not a new break.
- Guide harness re-run once (`GUIDE_SHOTS=1`): **7 passed**; no `guideDemo`
  documents left, `tests/e2e/.guide-shots-snapshot.json` absent.

### Carried — product defects recorded by Tasks 1 and 5, not fixed in this round

1. `.mej-cc-timeline-controls` has no CSS rule, so the picker spans the pane
   and Make default / rename / delete each drop onto their own line.
2. Prep-board attendees render with no names.
3. The GM's Player Recaps block reads empty on the Session sheet even when a
   player's recap exists and renders on that player's own sheet.
4. Search snippets show raw enricher markup (`@UUID[…]{…}` bleeds through).
5. A natively-revealed ("Everyone") secret renders core Foundry's own Hide
   toggle on a player's screen; a group-revealed one does not.
6. The campaign portal page also renders the Knowledge panel below the Hub.
7. MEJ's shared detailed-header partial fills ~250 px of every Session sheet
   with a broken image placeholder and five empty generic fields (MEJ-side).
8. With zero campaigns, "File all shown into…", "File into campaign…" and
   "Auto-capture campaign" render, are clickable, and do nothing — the
   `promptCampaignChoice()` zero-campaign short-circuit surfacing as dead UI
   (Task 1). Task 1 also logged a cosmetic string bug: the import review
   screen renders "1 sections detected as sessions" (no singular form).

### Carried — found during fix round 1

9. **MEJ lays the enriched preview wrapper out at `clientHeight` 0** while it
   holds real content, and does not recover from a forced re-flow. Harmless
   until something scrolls that zero-height container, at which point every
   child's bounding box shifts out from under itself — the mechanism behind
   verdict 4. MEJ-side; out of scope for a companion round.
10. **Harness: `cleanupTimelineJournal()` still deletes by NAME on World A.**
   Its content guard is strong (it only removes a `Campaign Timeline` journal
   whose timepoints are all `TT-`-labelled, or empty) and callers now exclude
   the pre-existing ids, but the primary key is still a name in the user's real
   world. An id-tracked rewrite means every caller registering the journals it
   creates; not attempted in this round.
11. **Harness: nine pre-existing spec-side `page.goto('/game')`/`reload()`
   calls still wait on a bare `game.ready`, not `SESSION_BOUND`.** They carry
   the same login-race hazard verdict 6 fixed inside `login()`:
   `01-session.spec.mjs:141`, `02-hub-timeline.spec.mjs:70`,
   `00-mej-api.spec.mjs:139`, `12-native-mode.spec.mjs:13` and `:106`,
   `13-stock-smoke.spec.mjs:62`, `14-campaigns.spec.mjs:336` and `:694`,
   `15-campaign-portal.spec.mjs:354`. Carried, not fixed this round, because
   each follows a `login()` call that now returns only on a session-bound
   document, so the race window these sites' own reloads reopen is narrower
   than the one `login()` closed.
