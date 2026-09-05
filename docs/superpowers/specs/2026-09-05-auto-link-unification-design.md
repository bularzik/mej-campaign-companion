# Auto-link unification — design (0.18.0)

**Date:** 2026-09-05 · **Branch:** `feat/auto-link-unification` (base `main` @ 7abf5df, 0.17.0)

## Goal

Make auto-linking the reliable first link in the chain *prose → `@UUID` links → "Mentioned in" / graph mention edges*, so that a name typed before or after its entity exists gets linked the same way, session recaps and GM notes are covered, linking stays inside a campaign, and the GM learns what happened through a toast rather than a dialog, a whisper, or silence.

## Background — what exists and why it looked broken

Three capabilities, deliberately layered (kept as-is by this design):

| Capability | Trigger | Scans | Default (0.17.0) |
|---|---|---|---|
| Forward auto-link — `scripts/hooks/auto-link.mjs` | `preUpdateJournalEntryPage` | only words *added* to `changes.text.content` | **off** (`autoLink`) |
| Create-time ("retro") auto-link — `scripts/hooks/retro-link.mjs` | `createJournalEntry` of an MEJ entity (200 ms burst, serialized, login catch-up sweep) | every page's `text.content` in the **world**, audience-contained | **on, Confirm dialog** (`retroLinkMode`) |
| Docx import — `scripts/apps/import-wizard.mjs` | import | whole imported HTML, via `autoLinkAdded("", html, …)` | follows `autoLink` |
| "Mentioned in" — `scripts/logic/backlink-index.mjs` via `scripts/search/live-index.mjs` | derived, live | `@UUID[…]` in indexed fields — never plain prose | always |
| Relationships — MEJ's `flags.monks-enhanced-journal.relationships` (page) | manual, MEJ sheet UI | — | always; graph draws them as solid edges, mentions as optional dashed `backlink` edges (`logic/graph-data.mjs`) |

Root cause of "the create-time scan never fires": `hooks/retro-link.mjs:64-77` collects pages by `p.text?.content` only, so **session pages (body in `system.recap`, `system.gmNotes`) are never scanned** by either hook — while the search index does read them (`logic/field-extractors.mjs` `bodyRegion()`), so a recap only ever appears in "Mentioned in" if linked by hand. And `processBurst` returns silently on zero matches, so a GM whose prose lives in recaps sees nothing, in any mode.

### Rationalization (part 1 of the request)

Keep the one-way chain. Relationships are curated, typed, GM-authored MEJ data ("ally", hidden rows with per-viewer reveals); deriving them from name co-occurrence would assert meaning the GM never did, and the companion never writes MEJ's relationships flag today — that stays true. Mentions stay derived from links only. The inconsistency worth fixing is the first link of the chain: two paths with different defaults, field coverage, scope and feedback. The search tokenizer (prefix, fuzzy) and the auto-link matcher (whole name, exact, case-insensitive) intentionally differ and are not unified.

### Decisions (approved in chat 2026-09-05)

1. Both directions **on by default**: `autoLink` → `true`, `retroLinkMode` → `silent`. Stored values in existing worlds are respected.
2. Session `system.recap` and `system.gmNotes` are linkable regions on both paths.
3. **Campaign-scoped**: entity in campaign A ↔ pages in A or unfiled; unfiled entity ↔ anywhere; A never ↔ B.
4. Feedback is a **toast** (+ console detail). `confirm` mode keeps its dialog because it is a decision. No toast on zero matches.
5. A GM-only **"Link mentions in this campaign"** catch-up action on the Hub, always confirm-gated.

## §1 Scan targets and scope — `scripts/logic/link-targets.mjs` (pure)

```js
/** @returns {{ key: string, content: string, gmOnly: boolean }[]} */
export function linkableRegions(page)
```
- Session page (has `system.recap` defined): `{ key: "system.recap", gmOnly: false }` and, when `system.gmNotes` is a non-empty string, `{ key: "system.gmNotes", gmOnly: true }`.
- Any other page: `{ key: "text.content", gmOnly: false }`.
- Regions whose content is not a non-empty string are omitted. Built on `bodyRegion()` from `field-extractors.mjs` (which is refactored to share the same `system.recap` presence test — one definition of "where the body lives").

```js
/** true when a page and an entity may link to each other. Either side unfiled (null) matches everything. */
export function sameLinkScope(campaignIdA, campaignIdB) { return !campaignIdA || !campaignIdB || campaignIdA === campaignIdB; }
```
Campaign ids come from `campaignOf(doc)?.id` (`logic/campaigns.mjs`; walks folder ancestry so subfolders count). Timeline journals and campaign portals (`isTimelineJournal`, `isCampaignPortal`) are never scanned and never candidates.

Audience containment (`logic/link-audience.mjs`) is unchanged and applies on top of scope. A `gmOnly` region has no non-GM viewers, so its viewer set is `[]` and containment passes for any entity.

**Scope-aware ambiguity.** `buildRetroPlanBatch` (`logic/retro-link.mjs`) currently drops a name when a same-named twin is audience-contained for the page. Rows and twins gain `campaignId`; a twin only makes the name ambiguous for a page when the twin is *also* in scope for that page. Campaign A's "Mira" is therefore unambiguous inside A while campaign B has its own Mira; for an unfiled page both are in scope and the name is dropped as today. The forward path's `dropAmbiguousNames` operates on the already scope-filtered candidate list, which yields the same rule.

## §2 Forward path — `scripts/hooks/auto-link.mjs`

`preUpdateJournalEntryPage` handler:
1. Unchanged early exits: `options[MODULE_ID].retroLink`, `autoLink` off, page `noAutoLink` flag.
2. For each region of `linkableRegions(page)`: `next = foundry.utils.getProperty(changes, region.key)`; skip unless a non-empty string. `baseline = getProperty(page, region.key) ?? ""`. `linked = autoLinkAdded(baseline, next, candidates)`; if changed, `setProperty(changes, region.key, linked)`.
3. `buildCandidates(page, region)`: MEJ entities where `sameLinkScope(campaignIdOf(page), campaignIdOf(entry))`, not the page's own entry, containment against the page's non-GM viewers — or `[]` for a `gmOnly` region. Candidates are computed per region (one pass over `game.journal` each; a page has at most two regions).

Interactions with 0.17.0: `SessionSheet._prepareSubmitData`'s stale-field guard strips fields whose editors are not active before the update reaches this hook, so only the field the user edited is diffed; core closes every collaborator's recap editor on save and `hooks/recap-refresh.mjs` re-renders idle views, so a linked recap propagates with no new code.

Import: `ImportWizard.#linkCandidates` filters by `sameLinkScope(destinationCampaignId, campaignIdOf(entry))` where the destination campaign is that of the chosen import folder (`campaignOfFolder`), null for "unfiled".

## §3 Create-time path and feedback — `scripts/hooks/retro-link.mjs`

Unchanged: `preCreateJournalEntry` pending-flag stamp, active-GM `createJournalEntry` trigger, burst coalescing (`BURST_IDLE_MS`), promise-chain serialization, `suspendRetroBursts`/`resumeRetroBursts` around import, login catch-up sweep, deleted-entity re-plan in confirm mode.

Changes:
- **`planForBurst` walks regions.** For every eligible entry (not timeline/portal) and every region of each of its pages, one row `{ uuid: page.uuid, key, content, viewerIds, campaignId, noAutoLink, entryUuid, name }`; `viewerIds` is `[]` for `gmOnly`. Entities carry `campaignId` too. `buildRetroPlanBatch` pairs entity × row only when `sameLinkScope` holds, then containment, then scope-aware ambiguity (§1). Output rows are per region; a page with two matched regions produces two rows that are merged into one `pageDoc.update({ [keyA]: htmlA, [keyB]: htmlB }, { [MODULE_ID]: { retroLink: true } })`.
- **Feedback** (`silent` mode, new default): replace `whisperSummary` with `notifyRetroResult(entities, applied, rows)`:
  - `applied.length > 0` → `ui.notifications.info` with `retroLink.summary` ("Linked \"{name}\" in {count} place(s).") for one entity or `retroLink.summaryMany` ("Linked {entities} new entries in {count} place(s).") for several; `console.info(\`${MODULE_ID} | auto-link\`, { pages: [...names + per-entity counts], ambiguous: [...] })`.
  - `applied.length === 0` and some row has `ambiguous.length` → `ui.notifications.warn` with `retroLink.ambiguousOnly` ("Skipped auto-linking \"{name}\": another entity in reach shares that name.") — one toast per burst, naming the first ambiguous entity, remaining names in the console.
  - nothing matched, nothing ambiguous → no output.
  - `confirm` mode: dialog as today; after the writes, the same `notifyRetroResult`. `off`: unchanged.
- Import produces two toasts by design: the wizard's own (links *from* imported pages) and the retro burst's (existing pages linked *to* the new entries).

**Known limitation.** A retro write into a region that another client is editing collaboratively is an ordinary external update under a collaborative editor — core reconciles or the editor's save wins. Same exposure `text.content` has under MEJ's editor today; documented in the GM guide, not engineered around.

## §4 Hub catch-up action — "Link mentions in this campaign"

- `templates/hub.hbs` Index toolbar, next to "File all shown": `<button data-action="linkMentions">` with icon `fa-link`, GM-only (the same template guard the toolbar's other GM-only actions use), rendered only while a campaign is selected (not for "All entries" / "Unfiled").
- `CampaignHubPage` action `linkMentions`: collect the campaign's MEJ entities (`campaignEntries(campaign)` filtered by `mejType`, excluding timeline/portal) and call a new export `runRetroPass(entries, { mode: "confirm" })` from `hooks/retro-link.mjs` — the same `planForBurst` + `confirmDialog` + writes + `notifyRetroResult`, queued on `retroChain` so it cannot interleave with a live burst. The mode is forced to `confirm` regardless of `retroLinkMode` (bulk rewrite is a decision) unless `retroLinkMode` is `off`, in which case the button shows a warn toast `retroLink.disabled` and does nothing.
- The dialog reuses `retroLink.titleMany`/`introMany`; entries are listed per page with the entity names as today.

## §5 Settings, language, docs

- `scripts/campaign-companion.mjs`: `autoLink` default `true`; `retroLinkMode` default `"silent"`. No new settings; no `dataVersion` bump (no stored shape changes; `retroLinkPending` and `noAutoLink` keep their meaning).
- `lang/en.json`:
  - `settings.autoLink.hint`: mention recaps/GM notes and campaign scope.
  - `settings.retroLinkMode.hint` / `.silent`: "Silent (notification)"; hint describes toast + console.
  - `retroLink.summary`, `retroLink.summaryMany` reworded as above; add `retroLink.ambiguousOnly`, `retroLink.disabled`, `hub.linkMentions` ("Link mentions"), `hub.linkMentionsTitle` (tooltip).
- `docs/gm-guide.md` "Auto-linking" rewritten: as-you-type, on-create, scope, feedback, opt-outs (`noAutoLink`, settings), the Hub catch-up action, the collaborative-edit limitation. Under the knowledge panel: "How mentions and relationships relate" — the chain, and that relationships are curated, never derived. `docs/player-guide.md`: one sentence that links may appear in a recap after saving. `README.md` settings table; `CHANGELOG.md` 0.18.0; `module.json` version `0.18.0`.
- Screenshot `docs/images/autolink-confirm.png` stays valid (confirm mode still exists).

## §6 Testing

**Unit (vitest).** `test/link-targets.test.js`: regions for session (recap only; recap + gmNotes; gmOnly flags), text page, empty/non-string omitted; `sameLinkScope` truth table (null/null, null/A, A/null, A/A, A/B). `test/retro-link.test.js` additions: rows keyed by region; a session page yields two rows and merges to one write; mixed burst scope pairing (entity in A, entity unfiled, pages in A/B/unfiled); scope-aware ambiguity (A-Mira vs B-Mira for a page in A → linked; for an unfiled page → ambiguous). `test/auto-link-candidates.test.js` unchanged. Field-extractor tests still pass after the `bodyRegion` refactor.

**e2e, v14 World A** — `tests/e2e/11-auto-link-scope.spec.mjs` extended and new `tests/e2e/22-auto-link-sessions.spec.mjs`; TT- prefixed, id-tracked cleanup, every dialog answered explicitly, `--trace off`, no `retries`/`waitForTimeout`/`test.skip`:
1. Forward on a recap: owner edits a TT- session recap mentioning an existing TT- person, commits via the header edit button → recap contains `@UUID[JournalEntry.<id>]{…}`; the person's knowledge panel lists the session under Mentioned in.
2. Create-time, silent default: TT- session recap + TT- text page mention a name; create the entity → both regions linked, one `#notifications li.notification.info` matching /Linked .* in 2 place/, no `dialog.application`, no new whisper in chat.
3. Scope: a same-name mention in a second TT- campaign stays plain; an unfiled TT- page is linked.
4. Zero matches → no notification; ambiguous-only (two TT- entities of one name created in one burst) → one `.warning` toast.
5. Confirm mode (set in-test, restored in `finally`): dialog appears; Skip leaves prose plain.
6. Hub "Link mentions": TT- campaign with pre-existing plain mentions → dialog lists them; Link Checked → linked + info toast.
7. `05-docx-import`: wizard toast still reports its count; a second info toast from the retro burst appears when the fixture's names occur in a pre-seeded TT- page.

**v13 stock gate** (Foundry 13.351 + MEJ 13.06, harness :30013): `13-stock-smoke` unchanged; test 2 in native mode (`system.recap` update through core without MEJ's page wrapper).

**World A safety**: run the harness as-is only; delete only ids the test created; answer the ownership-offer dialog No; never touch folder `1oqDUyUhquJvsMOj` or timeline `4HNvqCF669sobD9G`. Two stray timeline journals (`mXUDSNLnhlXeikKq`, `JtgJkgV9DkLD49DN`) still break `02-hub-timeline`'s guard until deleted by hand — pre-existing, unrelated.

## Out of scope

- Deriving relationships from mentions or vice versa; writing MEJ's relationships flag.
- Unifying the search tokenizer with the auto-link matcher.
- Per-edge visibility control for mention edges in the graph.
- A world-wide (all campaigns) catch-up action; per-campaign covers the need.
- Any change to MEJ itself.

## Deviations

- Ruling (Task 1): `linkableRegions` returns every region of the page even when its content is `""` (a session page always yields `system.recap` and `system.gmNotes`), instead of omitting empty regions — the forward hook needs a region whose *current* content is empty so a first save diffs against baseline `""`. The retro planner keeps its existing empty-content skip, so scanning behaviour is as specified. Cost if wrong: none observable; only the helper's contract differs.
