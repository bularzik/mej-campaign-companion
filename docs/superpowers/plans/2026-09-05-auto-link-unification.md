# Auto-link Unification (0.18.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto-linking cover session recaps/GM notes on both paths, scope it to the entity's campaign, turn both paths on by default with toast feedback, and add a Hub catch-up action — so "Mentioned in" and the graph's mention edges finally reflect prose.

**Architecture:** One new pure module (`logic/link-targets.mjs`) answers "which fields of a page are linkable" and "are these two campaign ids in scope of each other". The pure retro planner gains region keys and campaign scope. Both existing hooks (`hooks/auto-link.mjs` forward, `hooks/retro-link.mjs` create-time) consume the module; the create-time hook swaps its whisper for a toast and exports `runRetroPass` for the Hub button. Nothing stored changes shape; no `dataVersion` bump.

**Tech Stack:** Foundry VTT 13/14 (ApplicationV2, DialogV2, `ui.notifications`), MEJ fork `integration-14.07` on v14 / stock MEJ 13.06 on v13, vitest (pure `scripts/logic/*`), Playwright e2e (`tests/e2e/*.spec.mjs`, harness in `tests/e2e/helpers/foundry.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-05-auto-link-unification-design.md`

## Global Constraints

- Companion features NEVER patch MEJ — every change is inside `mej-campaign-companion`.
- Worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/auto-link`, branch `feat/auto-link-unification`, base `main` @ 7abf5df. All commands below run from that directory.
- Pure modules under `scripts/logic/` import no Foundry globals (vitest loads them directly). `scripts/constants.mjs` is allowed.
- Settings keys stay `autoLink` (Boolean, new default `true`) and `retroLinkMode` (String `off|confirm|silent`, new default `"silent"`). No new settings. No `dataVersion` bump.
- Toast rule: a message that needs no decision is `ui.notifications`; the `confirm` dialog stays because it is a decision. Zero matches → no output.
- Scope rule (verbatim): `sameLinkScope(a, b) = !a || !b || a === b`. Timeline journals and campaign portals are never scanned and never candidates.
- Links are always `@UUID[JournalEntry.<id>]{label}` targeting the entry uuid (unchanged).
- e2e: TT-prefixed names, id-tracked cleanup (never name-based deletes of things the test did not create), every dialog answered explicitly, `--trace off`, no `retries` / `waitForTimeout` / `test.skip`. World A (`~/FoundryVTT-14`, port 30000) is the user's real world: never touch folder `1oqDUyUhquJvsMOj` or timeline journal `4HNvqCF669sobD9G`, delete only documents whose ids the test created, answer the ownership-offer dialog **No**. Respect the e2e lock `<FOUNDRY_DATA>/.claude-e2e-lock` (wait; never `npm run e2e:unlock`).
- Never bare `git stash` / `git stash pop`. One commit per task, trailer:
  `Co-Authored-By: Claude Code <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01EQooH5pmgEgqo9p4AwVKAp`.
- Logs for e2e runs go to `/Users/danbularzik/.claude/jobs/4378f1d9/tmp/` (`autolink-task<N>-*.log`).

---

### Task 1: `logic/link-targets.mjs` — regions and scope (pure)

**Files:**
- Create: `scripts/logic/link-targets.mjs`
- Test: `test/link-targets.test.js`
- Modify: `docs/superpowers/specs/2026-09-05-auto-link-unification-design.md` (Deviations section)

**Interfaces:**
- Consumes: `bodyRegion(page)` from `scripts/logic/field-extractors.mjs` → `{ key: "system.recap"|"text.content", content: string }`.
- Produces: `linkableRegions(page) → { key: string, content: string, gmOnly: boolean }[]` and `sameLinkScope(a, b) → boolean`. Every later task imports these two names exactly.

- [ ] **Step 1: Record the deviation in the spec**

Replace the last line of the spec (`None yet — recorded here …`) with:

```markdown
- Ruling (Task 1): `linkableRegions` returns every region of the page even when its content is `""` (a session page always yields `system.recap` and `system.gmNotes`), instead of omitting empty regions — the forward hook needs a region whose *current* content is empty so a first save diffs against baseline `""`. The retro planner keeps its existing empty-content skip, so scanning behaviour is as specified. Cost if wrong: none observable; only the helper's contract differs.
```

- [ ] **Step 2: Write the failing tests**

`test/link-targets.test.js`:

```js
import { describe, it, expect } from "vitest";
import { linkableRegions, sameLinkScope } from "../scripts/logic/link-targets.mjs";

describe("linkableRegions", () => {
  it("yields text.content for an ordinary page", () => {
    expect(linkableRegions({ text: { content: "<p>Body.</p>" } })).toEqual([
      { key: "text.content", content: "<p>Body.</p>", gmOnly: false }
    ]);
  });

  it("yields recap then gmNotes for a session page, gmNotes marked gmOnly", () => {
    expect(linkableRegions({ system: { recap: "<p>R.</p>", gmNotes: "<p>N.</p>" } })).toEqual([
      { key: "system.recap", content: "<p>R.</p>", gmOnly: false },
      { key: "system.gmNotes", content: "<p>N.</p>", gmOnly: true }
    ]);
  });

  it("returns empty-string content rather than dropping a region", () => {
    expect(linkableRegions({ system: { recap: "" } })).toEqual([
      { key: "system.recap", content: "", gmOnly: false },
      { key: "system.gmNotes", content: "", gmOnly: true }
    ]);
    expect(linkableRegions({ text: {} })).toEqual([
      { key: "text.content", content: "", gmOnly: false }
    ]);
  });

  it("coerces a non-string gmNotes to empty", () => {
    const [, notes] = linkableRegions({ system: { recap: "x", gmNotes: null } });
    expect(notes).toEqual({ key: "system.gmNotes", content: "", gmOnly: true });
  });

  it("tolerates a null page", () => {
    expect(linkableRegions(null)).toEqual([{ key: "text.content", content: "", gmOnly: false }]);
  });
});

describe("sameLinkScope", () => {
  it.each([
    [null, null, true],
    [null, "A", true],
    ["A", null, true],
    ["A", "A", true],
    ["A", "B", false],
    [undefined, "A", true],
    ["", "A", true]
  ])("(%s, %s) -> %s", (a, b, want) => {
    expect(sameLinkScope(a, b)).toBe(want);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/link-targets.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/link-targets.mjs`.

- [ ] **Step 4: Implement**

`scripts/logic/link-targets.mjs`:

```js
// scripts/logic/link-targets.mjs
// Where a page's linkable prose lives, and whether two documents are in
// linking reach of each other (spec 2026-09-05 §1). Pure: both auto-link
// hooks and the import wizard consume this so the "text.content only"
// assumption that skipped every session page cannot come back.
import { bodyRegion } from "./field-extractors.mjs";

/**
 * Every region of the page that auto-link may read or write, in order.
 * Content is always a string ("" when the field is empty or missing) so a
 * first save can diff against an empty baseline; scanners that want only
 * non-empty regions filter on `content` themselves.
 * @returns {{ key: string, content: string, gmOnly: boolean }[]}
 */
export function linkableRegions(page) {
  const body = bodyRegion(page);
  const regions = [{ key: body.key, content: body.content, gmOnly: false }];
  if (body.key === "system.recap") {
    const notes = page?.system?.gmNotes;
    regions.push({ key: "system.gmNotes", content: typeof notes === "string" ? notes : "", gmOnly: true });
  }
  return regions;
}

/**
 * Campaign scope for linking: an entity in campaign A links with pages in A
 * or unfiled; an unfiled entity links anywhere; A never links with B.
 * Ids are campaign Folder ids or null/"" for unfiled.
 */
export function sameLinkScope(campaignIdA, campaignIdB) {
  return !campaignIdA || !campaignIdB || campaignIdA === campaignIdB;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/link-targets.test.js`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/logic/link-targets.mjs test/link-targets.test.js docs/superpowers/specs/2026-09-05-auto-link-unification-design.md
git commit -m "feat: link-targets — linkable regions per page and campaign link scope"
```

---

### Task 2: Region-keyed, campaign-scoped retro planner (pure)

**Files:**
- Modify: `scripts/logic/retro-link.mjs` (`buildRetroPlanBatch`, lines 56-115)
- Test: `test/retro-link.test.js`

**Interfaces:**
- Consumes: `sameLinkScope` from Task 1.
- Produces: `buildRetroPlanBatch({ entities, pages, otherSameNamed, minLength })` where
  - `entities[]` gain optional `campaignId: string|null`,
  - `pages[]` gain optional `campaignId: string|null` and `key: string` (default `"text.content"`),
  - `otherSameNamed[uuid][]` entries gain optional `campaignId`,
  - each output row gains `key` (copied from the page row). All other fields unchanged; callers passing the old shape get the old behaviour (undefined ids match everything).

- [ ] **Step 1: Write the failing tests**

Append to `test/retro-link.test.js` inside `describe("buildRetroPlanBatch")`:

```js
  it("copies the page's region key onto the row, defaulting to text.content", () => {
    const { rows } = planOne(ENTITY, [
      page("p1", "<p>Gandalf</p>"),
      page("p2", "<p>Gandalf</p>", { key: "system.recap" })
    ]);
    expect(rows.map((r) => [r.pageUuid, r.key])).toEqual([["p1", "text.content"], ["p2", "system.recap"]]);
  });

  it("emits one row per region of the same page (recap and gmNotes share a pageUuid)", () => {
    const { rows } = planOne(ENTITY, [
      page("s1", "<p>Gandalf in recap</p>", { key: "system.recap" }),
      page("s1", "<p>Gandalf in notes</p>", { key: "system.gmNotes", viewerIds: [] })
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.pageUuid === "s1")).toBe(true);
    expect(rows.map((r) => r.key)).toEqual(["system.recap", "system.gmNotes"]);
  });

  it("links only pages in the entity's campaign scope", () => {
    const inA = { ...ENTITY, campaignId: "A" };
    const { rows } = planOne(inA, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pb", "<p>Gandalf</p>", { campaignId: "B" }),
      page("pu", "<p>Gandalf</p>", { campaignId: null })
    ]);
    expect(rows.map((r) => r.pageUuid)).toEqual(["pa", "pu"]);
  });

  it("an unfiled entity links into every campaign", () => {
    const unfiled = { ...ENTITY, campaignId: null };
    const { rows } = planOne(unfiled, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pb", "<p>Gandalf</p>", { campaignId: "B" })
    ]);
    expect(rows.map((r) => r.pageUuid)).toEqual(["pa", "pb"]);
  });

  it("a same-named twin outside the page's scope does not make the name ambiguous", () => {
    const inA = { ...ENTITY, campaignId: "A" };
    const twinInB = { viewerIds: [], campaignId: "B" };
    const { rows } = planOne(inA, [
      page("pa", "<p>Gandalf</p>", { campaignId: "A" }),
      page("pu", "<p>Gandalf</p>", { campaignId: null })
    ], [twinInB]);
    const byPage = Object.fromEntries(rows.map((r) => [r.pageUuid, r]));
    expect(byPage.pa.matches).toHaveLength(1);
    expect(byPage.pa.ambiguous).toEqual([]);
    // The unfiled page is in reach of both Gandalfs: ambiguous there, as before.
    expect(byPage.pu.matches).toEqual([]);
    expect(byPage.pu.ambiguous).toHaveLength(1);
    expect(byPage.pu.newHtml).toBeNull();
  });

  it("a mixed burst pairs each entity with pages in its own scope", () => {
    const a = { uuid: "JournalEntry.a", name: "Aragorn", viewerIds: [], campaignId: "A" };
    const u = { uuid: "JournalEntry.u", name: "Boromir", viewerIds: [], campaignId: null };
    const { rows } = buildRetroPlanBatch({
      entities: [a, u],
      pages: [page("pb", "<p>Aragorn and Boromir</p>", { campaignId: "B" })]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].matches.map((m) => m.entityUuid)).toEqual(["JournalEntry.u"]);
    expect(rows[0].newHtml).not.toContain("JournalEntry.a");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/retro-link.test.js`
Expected: the six new tests FAIL (`key` undefined; campaign-B pages linked; twin ambiguity applied in A).

- [ ] **Step 3: Implement**

In `scripts/logic/retro-link.mjs`: add the import and change the loop body.

```js
import { autoLinkAdded } from "./auto-link.mjs";
import { audienceContains } from "./link-audience.mjs";
import { sameLinkScope } from "./link-targets.mjs";
```

Update the JSDoc `@param` lines for `entities` (`campaignId?:string|null`), `pages` (`key?:string, campaignId?:string|null`), `otherSameNamed` (`{viewerIds:string[], campaignId?:string|null}[]`) and `@returns` (row gains `key:string`). Then replace, inside the `for (const page of pages ?? [])` loop:

```js
    const forPage = named.filter((e) =>
      page.entryUuid !== e.uuid
      && sameLinkScope(page.campaignId, e.campaignId)
      && audienceContains(page.viewerIds, e.viewerIds));
    if (!forPage.length) continue;

    // A twin only makes the name ambiguous where BOTH entities are in reach
    // of the page: campaign A's "Mira" is unambiguous inside A while B keeps
    // its own Mira, and only an unfiled page sees both (spec §1).
    const twinned = (e) =>
      (otherSameNamed[e.uuid] ?? []).some((o) =>
        sameLinkScope(page.campaignId, o.campaignId) && audienceContains(page.viewerIds, o.viewerIds));
```

and in the `rows.push({...})` add `key: page.key ?? "text.content",` after `pageUuid`.

- [ ] **Step 4: Run the whole unit suite**

Run: `npx vitest run`
Expected: PASS (all prior tests still green; the planner is backward compatible).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/retro-link.mjs test/retro-link.test.js
git commit -m "feat: retro planner rows carry region keys and honour campaign link scope"
```

---

### Task 3: Forward hook covers recaps/GM notes and campaign scope; import scope; `autoLink` default on

**Files:**
- Modify: `scripts/hooks/auto-link.mjs` (whole file)
- Modify: `scripts/apps/import-wizard.mjs` (`#linkCandidates` ~line 326; its two call sites ~580 and ~588)
- Modify: `scripts/campaign-companion.mjs` (`autoLink` registration, ~line 37-44)
- Modify: `lang/en.json` (`settings.autoLink.hint`, line 10)

**Interfaces:**
- Consumes: `linkableRegions`, `sameLinkScope` (Task 1); `campaignIdOf` from `scripts/logic/campaigns.mjs` (accepts a JournalEntry or a JournalEntryPage).
- Produces: nothing new for later tasks. Behaviour: a `preUpdateJournalEntryPage` whose `changes` contain `text.content`, `system.recap` or `system.gmNotes` gets newly-added names linked in that field, candidates limited to `sameLinkScope(page campaign, entity campaign)`.

- [ ] **Step 1: Rewrite `scripts/hooks/auto-link.mjs`**

Replace the file's `buildCandidates` and `registerAutoLink` (keep the header comment, add a sentence: "Regions come from logic/link-targets.mjs so session recaps and GM notes are covered; candidates are limited to the page's campaign scope.") with:

```js
import { autoLinkAdded } from "../logic/auto-link.mjs";
import { selectCandidates, dropAmbiguousNames } from "../logic/auto-link-candidates.mjs";
import { viewerIds, audienceContains } from "../logic/link-audience.mjs";
import { linkableRegions, sameLinkScope } from "../logic/link-targets.mjs";
import { campaignIdOf, isTimelineJournal, isCampaignPortal } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { MODULE_ID, AUTO_LINK_SETTING, NO_AUTO_LINK_FLAG } from "../constants.mjs";
import { mejType } from "../integrations/mej-adapter.mjs";

/**
 * Linkable candidates for one region of a page: every other MEJ-typed
 * JournalEntry in the page's campaign scope whose viewer set contains the
 * region's viewers. A gmOnly region (session GM notes) has no non-GM
 * viewers, so containment passes for every entity in scope.
 */
function buildCandidates(page, region) {
  const users = game.users.contents;
  const pageViewers = region.gmOnly ? [] : viewerIds(page.parent, users, isVisibleToUser);
  const pageCampaignId = campaignIdOf(page);
  const pages = game.journal
    .filter((entry) => mejType(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
    .map((entry) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      indexable: true,
      visible: audienceContains(pageViewers, viewerIds(entry, users, isVisibleToUser))
    }));
  return dropAmbiguousNames(selectCandidates({ pages, selfId: page.parent?.id })).kept;
}

export function registerAutoLink() {
  Hooks.on("preUpdateJournalEntryPage", (page, changes, options) => {
    try {
      // Retroactive-pass writes are already fully linked (hooks/retro-link.mjs
      // stamps this option) - re-running the diff here would be wasted work.
      if (options?.[MODULE_ID]?.retroLink) return;
      if (!game.settings.get(MODULE_ID, AUTO_LINK_SETTING)) return;
      if (page.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG)) return;

      for (const region of linkableRegions(page)) {
        const next = foundry.utils.getProperty(changes, region.key);
        if (typeof next !== "string" || !next) continue;
        const candidates = buildCandidates(page, region);
        if (!candidates.length) continue;
        // Baseline = the field as of the last save that ran this hook (see
        // the baseline note above): only words added since then are linked.
        const linked = autoLinkAdded(region.content, next, candidates);
        if (linked !== next) foundry.utils.setProperty(changes, region.key, linked);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | auto-link failed`, err);
    }
  });
}
```

Keep the existing "Baseline note" comment block above `registerAutoLink`.

- [ ] **Step 2: Scope the import wizard's candidates**

In `scripts/apps/import-wizard.mjs` add to the imports: `import { sameLinkScope } from "../logic/link-targets.mjs";` and extend the existing `campaigns.mjs` import with `campaignIdOf`. Change the signature and filter:

```js
  #linkCandidates(audience, warnings, campaignId = null) {
    const users = game.users.contents;
    const audienceViewers = audienceViewerIdsForImport(audience, users);
    const all = game.journal
      .filter((e) => mejType(e) && sameLinkScope(campaignId, campaignIdOf(e)))
      .map((e) => ({ name: e.name, uuid: e.uuid, viewerIds: viewerIds(e, users, isVisibleToUser) }));
```

At the two call sites in `#onCreate` pass the destination campaign: `this.#linkCandidates(linkAudience, plan.warnings, campaign?.id ?? null)` and `this.#linkCandidates("players", scratch, campaign?.id ?? null)` (`campaign` is the Folder resolved via `campaignOfFolder(chosen)` earlier in the same method).

- [ ] **Step 3: Default and hint**

`scripts/campaign-companion.mjs`, `AUTO_LINK_SETTING` registration: `default: true`.

`lang/en.json` line 10, `settings.autoLink.hint`:

```json
"hint": "Newly-typed mentions of other Enhanced Journal entry names — in page text, session recaps and GM notes — become links when the page is saved. Linking stays within the entry's campaign (plus unfiled entries). Existing links, code blocks, and pages flagged to opt out are left untouched."
```

- [ ] **Step 4: Syntax check and unit suite**

Run: `node --check scripts/hooks/auto-link.mjs && node --check scripts/apps/import-wizard.mjs && npx vitest run`
Expected: no syntax errors; vitest PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/auto-link.mjs scripts/apps/import-wizard.mjs scripts/campaign-companion.mjs lang/en.json
git commit -m "feat: forward auto-link covers session recaps/GM notes, campaign-scoped; on by default"
```

---

### Task 4: Create-time hook — regions, merged writes, toast feedback, `runRetroPass`, default silent

**Files:**
- Modify: `scripts/hooks/retro-link.mjs` (`planForBurst` ~40-79, `whisperSummary` ~138-154, `processBurst` ~263-334, new export)
- Modify: `scripts/campaign-companion.mjs` (`retroLinkMode` default, ~line 46-57)
- Modify: `lang/en.json` (`settings.retroLinkMode.*` lines 27-33, `retroLink.*` lines 374-384)

**Interfaces:**
- Consumes: `linkableRegions`, `sameLinkScope` (Task 1); `buildRetroPlanBatch` rows with `key` (Task 2); `campaignIdOf`, `isTimelineJournal`, `isCampaignPortal` from `logic/campaigns.mjs`.
- Produces: `export function runRetroPass(entries, { mode } = {}) → Promise<void>` — plans and writes for an arbitrary list of existing JournalEntry documents, forcing `mode` (`"confirm"|"silent"`) when given, queued on the same chain as live bursts. Used by Task 5.

- [ ] **Step 1: Imports**

Add to the imports of `scripts/hooks/retro-link.mjs`:

```js
import { linkableRegions } from "../logic/link-targets.mjs";
import { campaignIdOf, isTimelineJournal, isCampaignPortal } from "../logic/campaigns.mjs";
```

- [ ] **Step 2: `planForBurst` walks regions**

Replace the body of `planForBurst(entries)` from `const entities = …` through `return buildRetroPlanBatch(...)` with:

```js
  const users = game.users.contents;
  const entities = entries.map((entry) => ({
    uuid: entry.uuid, name: entry.name, campaignId: campaignIdOf(entry),
    viewerIds: viewerIds(entry, users, isVisibleToUser)
  }));

  // Same-named twins, resolved for every entity in the burst in one pass over
  // the journal rather than one pass each. An entity in the burst can be
  // another's twin, so the burst is included in the search. Twins carry
  // their campaign so the planner can ignore one that is out of a page's
  // reach (spec §1).
  const byName = new Map();
  for (const e of game.journal.contents) {
    if (!mejType(e)) continue;
    const norm = e.name.trim().toLowerCase();
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(e);
  }
  const otherSameNamed = {};
  for (const entity of entities) {
    const norm = entity.name.trim().toLowerCase();
    otherSameNamed[entity.uuid] = (byName.get(norm) ?? [])
      .filter((e) => e.uuid !== entity.uuid)
      .map((e) => ({ viewerIds: viewerIds(e, users, isVisibleToUser), campaignId: campaignIdOf(e) }));
  }

  // One planner row per linkable REGION (text.content, or a session's recap
  // and GM notes), so session pages are scanned at last. GM notes have no
  // non-GM viewers, so their audience is empty and containment passes.
  const gmNotesLabel = game.i18n.localize(`${I18N}.retroLink.gmNotes`);
  const pages = [];
  for (const e of game.journal.contents) {
    if (isTimelineJournal(e) || isCampaignPortal(e)) continue;
    const entryViewers = viewerIds(e, users, isVisibleToUser);
    const campaignId = campaignIdOf(e);
    for (const p of e.pages.contents) {
      const noAutoLink = !!p.getFlag(MODULE_ID, NO_AUTO_LINK_FLAG);
      const baseName = e.name === p.name ? e.name : `${e.name}: ${p.name}`;
      for (const region of linkableRegions(p)) {
        if (!region.content) continue;
        pages.push({
          uuid: p.uuid,
          key: region.key,
          name: region.gmOnly ? `${baseName} — ${gmNotesLabel}` : baseName,
          content: region.content,
          viewerIds: region.gmOnly ? [] : entryViewers,
          campaignId,
          noAutoLink,
          entryUuid: e.uuid
        });
      }
    }
  }
  return buildRetroPlanBatch({ entities, pages, otherSameNamed });
```

- [ ] **Step 3: Replace the whisper with a toast**

Delete `whisperSummary` entirely and add in its place:

```js
/**
 * Report a finished pass (spec §3): an info toast with the counts when
 * anything was written; a warn toast when nothing was written only because
 * every match was ambiguous; nothing at all when nothing matched. The
 * per-page detail goes to the console under the module prefix.
 */
function notifyRetroResult(entities, applied, rows) {
  const single = entities.length === 1;
  const ambiguousRows = rows.filter((r) => r.ambiguous.length);
  const detail = {
    linked: applied.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.matches.map((m) => `${m.entityName} (${m.count})`) })),
    ambiguous: ambiguousRows.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.ambiguous.map((m) => m.entityName) }))
  };
  if (applied.length) {
    const message = single
      ? game.i18n.format(`${I18N}.retroLink.summary`, { name: entities[0].name, count: applied.length })
      : game.i18n.format(`${I18N}.retroLink.summaryMany`, { entities: entities.length, count: applied.length });
    ui.notifications.info(message);
    console.info(`${MODULE_ID} | auto-link`, detail);
    return;
  }
  if (ambiguousRows.length) {
    const name = ambiguousRows[0].ambiguous[0].entityName;
    ui.notifications.warn(game.i18n.format(`${I18N}.retroLink.ambiguousOnly`, { name }));
    console.info(`${MODULE_ID} | auto-link`, detail);
  }
}
```

- [ ] **Step 4: `processBurst` — mode override, merged per-page writes, toast in both modes**

Change the signature to `async function processBurst(queued, { modeOverride = null } = {})` and the first line inside `try` to `const mode = modeOverride ?? game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING);`. Replace the block from `// One write per page, carrying every entity …` through `if (mode === "silent") await whisperSummary(live, applied, rows);` with:

```js
    // One write per page carrying every region and every entity that matched
    // it - a session whose recap and GM notes both matched is one update.
    const byPage = new Map();
    for (const row of chosen) {
      const w = byPage.get(row.pageUuid) ?? { update: {}, rows: [] };
      w.update[row.key] = row.newHtml;
      w.rows.push(row);
      byPage.set(row.pageUuid, w);
    }
    const applied = [];
    for (const [pageUuid, w] of byPage) {
      try {
        const pageDoc = await fromUuid(pageUuid);
        if (!pageDoc) continue;
        await pageDoc.update(w.update, { [MODULE_ID]: { retroLink: true } });
        applied.push(...w.rows);
      } catch (err) {
        console.error(`${MODULE_ID} | retro-link write failed for ${pageUuid}`, err);
      }
    }
    notifyRetroResult(live, applied, rows);
```

`confirmDialog` needs no change: it indexes `writable` rows, which are now per region, and `matchLabel` already prints `row.pageName` (which carries the "— GM notes" suffix for that region).

- [ ] **Step 5: Export `runRetroPass`**

Add after `flushBurst`:

```js
/**
 * Plan and write a pass for EXISTING entries on demand (the Hub's "Link
 * mentions in this campaign", spec §4). Queued on the same chain as live
 * bursts so it can never interleave with one. `mode` overrides the world
 * setting for this pass only; callers decide policy (the Hub forces confirm).
 */
export function runRetroPass(entries, { mode = null } = {}) {
  const queued = entries.map((entry) => ({ entry, needsClear: false }));
  retroChain = retroChain
    .then(() => processBurst(queued, { modeOverride: mode }))
    .catch((err) => console.error(`${MODULE_ID} | retro-link pass failed`, err));
  return retroChain;
}
```

- [ ] **Step 6: Default and language**

`scripts/campaign-companion.mjs`, `RETRO_LINK_MODE_SETTING` registration: `default: "silent"`.

`lang/en.json` — replace the `retroLinkMode` block:

```json
      "retroLinkMode": {
        "name": "Retroactive Auto-Link",
        "hint": "When a new Enhanced Journal entry is created, link existing plain-text mentions of its name in its campaign (and unfiled entries), including session recaps and GM notes. Silent writes immediately and shows a notification; Confirm shows the GM a review dialog first.",
        "off": "Off",
        "confirm": "Confirm (review dialog)",
        "silent": "Silent (notification)"
      }
```

and the `retroLink` block:

```json
    "retroLink": {
      "title": "Auto-Link New Entry",
      "intro": "\"{name}\" is mentioned in the pages below. Link the checked pages?",
      "apply": "Link Checked",
      "skip": "Skip",
      "ambiguous": "Skipped as ambiguous (another entity shares this name):",
      "ambiguousOnly": "Skipped auto-linking \"{name}\": another entity in reach shares that name.",
      "disabled": "Retroactive Auto-Link is set to Off — turn it on in the module settings first.",
      "gmNotes": "GM notes",
      "summary": "Linked \"{name}\" in {count} place(s).",
      "titleMany": "Auto-Link Entries",
      "introMany": "{count} entries are mentioned in the pages below. Link the checked pages?",
      "summaryMany": "Linked {entities} entries in {count} place(s)."
    },
```

- [ ] **Step 7: Check**

Run: `node --check scripts/hooks/retro-link.mjs && node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))" && npx vitest run && grep -rn "whisperSummary" scripts | wc -l`
Expected: no errors; vitest PASS; `0` references to `whisperSummary`.

- [ ] **Step 8: Commit**

```bash
git add scripts/hooks/retro-link.mjs scripts/campaign-companion.mjs lang/en.json
git commit -m "feat: create-time auto-link scans recaps/GM notes, campaign-scoped, reports by toast; runRetroPass"
```

---

### Task 5: Hub "Link mentions in this campaign"

**Files:**
- Modify: `templates/hub.hbs` (Index toolbar, inside the existing `{{#if isGM}}` block near line 56-63)
- Modify: `scripts/apps/CampaignHubPage.mjs` (actions map ~line 107-142; index context ~line 554; new static handler next to `onFileAllShown` ~line 1271)
- Modify: `lang/en.json` (`hub.*`)

**Interfaces:**
- Consumes: `runRetroPass(entries, { mode })` (Task 4); `campaignEntries(campaign)` from `scripts/data/campaign-store.mjs`; `mejType` from `scripts/integrations/mej-adapter.mjs`; `RETRO_LINK_MODE_SETTING` from constants; the class's private `#scope()` → `{ campaign: Folder|null, unfiled: boolean }`.
- Produces: action `linkMentions`, context flag `index.isCampaignScope`.

- [ ] **Step 1: Template**

In `templates/hub.hbs`, directly after the `{{#if index.isUnfiledScope}} … {{/if}}` block that wraps the `fileAllShown` button (still inside `{{#if isGM}}`), add:

```handlebars
                            {{#if index.isCampaignScope}}
                            <button type="button" class="mej-cc-link-mentions" data-action="linkMentions"
                                    data-tooltip="{{localize 'MEJCampaignCompanion.hub.linkMentionsTitle'}}">
                                <i class="fa-solid fa-link"></i> {{localize "MEJCampaignCompanion.hub.linkMentions"}}
                            </button>
                            {{/if}}
```

- [ ] **Step 2: Context flag**

In `CampaignHubPage.mjs` where the index context sets `isUnfiledScope: unfiled` (~line 554), add `isCampaignScope: !!campaign,` (the `campaign` variable from `const { campaign, unfiled } = this.#scope();` a few lines above).

- [ ] **Step 3: Action**

Add `linkMentions: CampaignHubPage.onLinkMentions` to `DEFAULT_OPTIONS.actions` next to `fileAllShown`. Add imports if not already present: `import { runRetroPass } from "../hooks/retro-link.mjs";`, `campaignEntries` from `"../data/campaign-store.mjs"`, `RETRO_LINK_MODE_SETTING` from `"../constants.mjs"` (`mejType` and `MODULE_ID`/`I18N` are already imported). Add the handler after `onFileAllShown`:

```js
  /**
   * Catch-up pass for a campaign whose prose predates working auto-linking
   * (spec §4): every MEJ entity in the campaign is planned against the
   * campaign's own pages. Always confirm-gated - a bulk rewrite of many
   * pages is a decision - unless the setting is Off, which wins.
   */
  static async onLinkMentions() {
    if (!game.user.isGM) return;
    const { campaign } = this.#scope();
    if (!campaign) return;
    if (game.settings.get(MODULE_ID, RETRO_LINK_MODE_SETTING) === "off") {
      ui.notifications.warn(game.i18n.localize(`${I18N}.retroLink.disabled`));
      return;
    }
    const entries = campaignEntries(campaign).filter((e) => mejType(e));
    if (!entries.length) {
      ui.notifications.info(game.i18n.localize(`${I18N}.hub.linkMentionsNone`));
      return;
    }
    await runRetroPass(entries, { mode: "confirm" });
  }
```

- [ ] **Step 4: Language**

In `lang/en.json` under `hub`, next to `"fileAllShown"`:

```json
      "linkMentions": "Link mentions",
      "linkMentionsTitle": "Find plain-text mentions of this campaign's entries in its pages and offer to link them",
      "linkMentionsNone": "This campaign has no Enhanced Journal entries to link.",
```

- [ ] **Step 5: Check**

Run: `node --check scripts/apps/CampaignHubPage.mjs && node -e "JSON.parse(require('fs').readFileSync('lang/en.json','utf8'))" && npx vitest run && npm run check:links`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add templates/hub.hbs scripts/apps/CampaignHubPage.mjs lang/en.json
git commit -m "feat: Hub 'Link mentions' catch-up pass for a campaign (confirm-gated)"
```

---

### Task 6: Docs, README, CHANGELOG, version

**Files:**
- Modify: `docs/gm-guide.md` (Auto-linking section lines ~192-200; settings summary ~313-314; add a paragraph after the "Backlinks" paragraph ~line 152)
- Modify: `docs/player-guide.md` (one sentence in the session/recap section — `grep -n -i "recap" docs/player-guide.md` to place it)
- Modify: `README.md` (lines 48-49 feature bullets; settings table rows for `autoLink` line 121 and `retroLinkMode` line 122)
- Modify: `CHANGELOG.md` (new top entry), `module.json` (`"version": "0.18.0"`)

- [ ] **Step 1: GM guide — Auto-linking section**

Replace the whole `## Auto-linking` section (up to but not including `## Auto-capture`) with:

```markdown
## Auto-linking

Auto-linking turns plain-text mentions of Enhanced Journal entry names into `@UUID` links, so the knowledge panel's **Mentioned in** list and the graph's mention edges reflect what your prose actually says. It works in both directions, and both are on by default:

- **As you type** (the **Auto-Link Entry Names** setting): when a page is saved, names you *added* since the last save are linked — in ordinary page text, and in a session's Recap and GM Notes. Text that was already there is never rewritten, and nothing inside an existing link or a code block is touched.
- **When an entry is created** (the **Retroactive Auto-Link** setting): the active GM's client finds existing plain-text mentions of the new entry's name and links them. In **Silent** mode (the default) it writes immediately and shows a notification — "Linked *Old Toby Rackett* in 3 place(s)" — with the page-by-page detail in the browser console (F12). **Confirm** mode shows a review dialog with a checkbox per matching page first, like the one below. **Off** disables it. Entries created while no GM was online are processed when a GM next connects.

![The Auto-Link New Entry dialog, offering to link the one page that mentions "Old Toby Rackett"](images/autolink-confirm.png)

**Scope.** Linking stays inside a campaign: an entry filed in a campaign links with that campaign's pages and with unfiled pages; an unfiled entry links anywhere; two campaigns never link into each other. A name shared by two entries that are both in reach of a page is skipped rather than guessed — you get a notification naming the entry when that is the only reason nothing was linked. On top of that, a mention only becomes a link when everyone who can already read the page can also see the entry being linked to (the GM is exempt).

**Catching up an existing campaign.** Prose written before auto-linking was on stays unlinked until you ask. Scope the Hub to the campaign and click **Link mentions** in the Index toolbar: it plans every entry in the campaign against the campaign's pages and shows the review dialog — check what you want linked and click **Link Checked**.

**Opting out.** Set either setting to Off, or flag an individual page with the module's `noAutoLink` flag to keep auto-linking away from it entirely.

One limitation to know about: if the create-time pass rewrites a recap while another player has that recap's editor open, their next save can overwrite the links — the same thing that happens with any outside edit during a collaborative session. Reopening the editor picks the links up.
```

- [ ] **Step 2: GM guide — mentions and relationships**

After the `![The Mentioned in backlinks section…](images/knowledge-backlinks.png)` line, add:

```markdown
**How mentions and relationships relate.** They are two different things, on purpose. Mentions are *derived*: prose → auto-link → `@UUID` link → this list and the graph's dashed mention edges. Relationships are *curated*: the rows you add on an entry's Relationships tab, with their own labels and per-row hiding, drawn as the graph's solid edges. The module never turns a mention into a relationship or a relationship into a link — a name appearing in a paragraph says nothing about how two entries are related, and only you can.
```

- [ ] **Step 3: GM guide — settings summary**

Update the two lines near line 313-314 that describe `Auto-Link Entry Names` and `Retroactive Auto-Link` so they read "(on by default)" and "(default: Silent — notification)" respectively; keep the rest of each line.

- [ ] **Step 4: Player guide**

In the section that describes editing the session recap, add one sentence: "If you mention another entry by name, it may become a link when you save — that's auto-linking, and it only touches text you just added."

- [ ] **Step 5: README**

Line 48-49 bullets:

```markdown
- **Auto-linking** — both directions on by default: names typed into page text, session recaps and GM notes become links on save; creating an entry links existing mentions of it (Silent = notification, Confirm = review dialog). Campaign-scoped; ambiguous names are skipped and reported. The Hub's **Link mentions** button catches up a campaign's older prose.
- **Docx import** — auto-links imported text at creation (gated on the Auto-Link setting). The import wizard's Audience select ("GM only" default / "All players (Observer)") sets created-entry ownership and bounds link targets; ambiguous names are skipped and listed in the summary.
```

Settings table rows:

```markdown
| `autoLink` | Yes | On | Link newly-typed MEJ entry names in page text, session recaps and GM notes on save (campaign-scoped). |
| `retroLinkMode` | Yes | Silent | Retroactive Auto-Link: creating an MEJ entity links existing plain-text mentions of its name from the active GM's client. Choices: Off, Confirm (review dialog with per-page checkboxes), Silent (write immediately + notification). |
```

- [ ] **Step 6: CHANGELOG and version**

Top of `CHANGELOG.md`:

```markdown
## 0.18.0 (2026-09-05)

Auto-linking that actually reaches your prose.

- **Session recaps and GM notes are auto-linked** on both paths. Both hooks only ever scanned `text.content`, so session pages — where most of a campaign's prose lives — were silently skipped, and a creation that matched nothing gave no feedback at all.
- **Both directions on by default.** `autoLink` defaults to on; `retroLinkMode` defaults to Silent. Worlds that stored a value keep it.
- **Campaign-scoped.** An entry links with its own campaign's pages and unfiled pages; unfiled entries link anywhere; campaigns never link into each other. A same-named twin in another campaign no longer makes a name ambiguous inside yours.
- **Results are a notification, not a whisper** (Silent) and follow the confirm dialog too; nothing matched → nothing shown; ambiguous-only → a warning naming the entry. Detail in the console.
- **Hub "Link mentions"** (Index toolbar, campaign scope, GM): catch-up pass for a whole campaign, always through the review dialog.
- Mentions and relationships stay separate layers (documented in the GM guide): mentions are derived from links, relationships are curated.
```

`module.json`: `"version": "0.18.0"`.

- [ ] **Step 7: Check and commit**

Run: `npm run check:links && npx vitest run`
Expected: clean.

```bash
git add docs/gm-guide.md docs/player-guide.md README.md CHANGELOG.md module.json
git commit -m "docs: auto-linking rewrite, mentions vs relationships, 0.18.0"
```

---

### Task 7: e2e — update `11-auto-link-scope` for the new defaults, toast and scope

**Files:**
- Modify: `tests/e2e/11-auto-link-scope.spec.mjs`

**Interfaces:**
- Consumes: helpers `login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle` from `tests/e2e/helpers/foundry.mjs`; the file's own `createMejPlace`, `setSettings`, `pageContent`, `cleanup`, `RUN`, `N`.

- [ ] **Step 1: Cleanup resets to the NEW defaults**

In `cleanup(gmPage)` change the two `game.settings.set` lines to `autoLink` → `true` and `retroLinkMode` → `"silent"`. (This cleanup has been writing the old defaults into the world; from now on it restores the shipped defaults.) Add a `folders` sweep for the campaign folders created below: `const fids = game.folders.filter((f) => f.type === "JournalEntry" && f.name?.includes(String(run))).map((f) => f.id); if (fids.length) await Folder.implementation.deleteDocuments(fids);` — placed after the journal delete.

- [ ] **Step 2: Silent test asserts the toast, not a whisper**

Rename the test to `"retroactive silent: links written and an info notification shown"`. Replace the `whisper` lookup and its expect with:

```js
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 1 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    const whispered = await page.evaluate((needle) =>
      game.messages.some((m) => m.whisper?.length && m.content?.includes(needle)), N.villain);
    expect(whispered).toBe(false);
```

Move the `createMejPlace(page, N.villain, …)` call so that the toast locator is awaited *right after* it (before `settle`), since toasts dismiss after a few seconds.

- [ ] **Step 3: New names and helpers**

Add to `N`: `scopeA: \`TTScopeCampA${RUN}\``, `scopeB: \`TTScopeCampB${RUN}\``, `scopePageA: \`TTScopePageA${RUN}\``, `scopePageB: \`TTScopePageB${RUN}\``, `scopePageU: \`TTScopePageU${RUN}\``, `scopeHero: \`TTScopeHero${RUN}\``, `quietHero: \`TTQuietHero${RUN}\``, `ambPage: \`TTAmbPage${RUN}\``, `ambTwin: \`TTAmbTwin${RUN}\``.

Add helpers after `createMejPlace`:

```js
async function createCampaignFolder(page, name) {
  return page.evaluate(async (n) => {
    const f = await Folder.create({
      name: n, type: "JournalEntry",
      flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
    });
    return f.id;
  }, name);
}

/** Like createMejPlace but filed into a folder. */
async function createMejPlaceIn(page, name, html, ownershipDefault, folderId) {
  return page.evaluate(async ({ n, html, own, folderId }) => {
    const entry = await JournalEntry.create({
      name: n, folder: folderId,
      ownership: { default: own },
      pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: html } }]
    });
    return { id: entry.id, uuid: entry.uuid };
  }, { n: name, html, own: ownershipDefault, folderId });
}
```

- [ ] **Step 4: Scope test**

```js
  test("retroactive scope: campaign A entity links A and unfiled pages, never campaign B", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folderA = await createCampaignFolder(page, N.scopeA);
    const folderB = await createCampaignFolder(page, N.scopeB);
    const pageA = await createMejPlaceIn(page, N.scopePageA, `<p>${N.scopeHero} in A.</p>`, 0, folderA);
    const pageB = await createMejPlaceIn(page, N.scopePageB, `<p>${N.scopeHero} in B.</p>`, 0, folderB);
    const pageU = await createMejPlace(page, N.scopePageU, `<p>${N.scopeHero} unfiled.</p>`, 0);
    await setSettings(page, { retroLinkMode: "silent" });
    const hero = await createMejPlaceIn(page, N.scopeHero, "<p>A hero.</p>", 0, folderA);
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 2 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await settle(page, 500);

    expect(await pageContent(page, pageA.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    expect(await pageContent(page, pageU.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    expect(await pageContent(page, pageB.id)).not.toContain("@UUID[");
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 5: Zero-match and ambiguous-only tests**

```js
  test("retroactive silent: no matches shows nothing; ambiguous-only shows a warning", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "silent" });
    const before = await page.locator("#notifications li.notification").count();
    await createMejPlace(page, N.quietHero, "<p>Nobody mentions me.</p>", 0);
    await settle(page, 1500);
    expect(await page.locator("#notifications li.notification", { hasText: /Linked|Skipped/ }).count()).toBe(0);
    expect(await page.locator("#notifications li.notification").count()).toBe(before);

    // Two same-named entities created in one burst are each other's twin:
    // the mention is ambiguous everywhere, so nothing is written and the
    // GM is told why.
    await setSettings(page, { retroLinkMode: "off" });
    const amb = await createMejPlace(page, N.ambPage, `<p>${N.ambTwin} walks in.</p>`, 0);
    await setSettings(page, { retroLinkMode: "silent" });
    await page.evaluate(async (n) => {
      await Promise.all([0, 1].map(() => JournalEntry.create({
        name: n, ownership: { default: 0 },
        pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: "<p>twin</p>" } }]
      })));
    }, N.ambTwin);
    await expect(page.locator("#notifications li.notification.warning", { hasText: N.ambTwin }))
      .toHaveCount(1, { timeout: 10_000 });
    expect(await pageContent(page, amb.id)).not.toContain("@UUID[");
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 6: Run**

Run (after checking the lock file is absent): `npx playwright test tests/e2e/11-auto-link-scope.spec.mjs --trace off 2>&1 | tee /Users/danbularzik/.claude/jobs/4378f1d9/tmp/autolink-task7-e2e.log`
Expected: all tests in the file pass (the confirm-mode test still passes because it sets `confirm` explicitly).

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/11-auto-link-scope.spec.mjs
git commit -m "test(e2e): auto-link scope, toast feedback, zero/ambiguous cases; cleanup restores new defaults"
```

---

### Task 8: e2e — `22-auto-link-sessions.spec.mjs` (recaps, Mentioned in, Hub catch-up) and import regression

**Files:**
- Create: `tests/e2e/22-auto-link-sessions.spec.mjs`
- Modify: `tests/e2e/05-docx-import.spec.mjs` (the test that asserts the `Imported \d+ entries` toast, ~line 205)

**Interfaces:**
- Consumes: helpers as in Task 7; `createSession` pattern from `tests/e2e/06-player-collab.spec.mjs:13-27` (session page `type: "mej-campaign-companion.session"`, `system: { recap, gmNotes }`); the knowledge-panel open-and-assert steps from `tests/e2e/07-knowledge.spec.mjs` test "backlinks appear after linking" (copy its sheet-open and `Mentioned in` locator code verbatim into the helper below).

- [ ] **Step 1: Write the spec file**

```js
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now();
const N = {
  camp: `TTLinkCamp${RUN}`,
  person: `TTLinkPerson${RUN}`,
  session: `TTLinkSession${RUN}`,
  textPage: `TTLinkText${RUN}`,
  late: `TTLinkLate${RUN}`,
  hubPerson: `TTHubPerson${RUN}`,
  hubSession: `TTHubSession${RUN}`
};
const MOD = "mej-campaign-companion";
const created = { folders: [], journals: [] };

async function setSettings(page, { autoLink, retroLinkMode }) {
  await page.evaluate(async ({ autoLink, retroLinkMode, MOD }) => {
    if (autoLink !== undefined) await game.settings.set(MOD, "autoLink", autoLink);
    if (retroLinkMode !== undefined) await game.settings.set(MOD, "retroLinkMode", retroLinkMode);
  }, { autoLink, retroLinkMode, MOD });
}

async function createCampaignFolder(page, name) {
  const id = await page.evaluate(async (n) => (await Folder.create({
    name: n, type: "JournalEntry",
    flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
  })).id, name);
  created.folders.push(id);
  return id;
}

async function createPerson(page, name, html, folderId) {
  const r = await page.evaluate(async ({ n, html, folderId }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: 2 },
      pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: html } }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, html, folderId });
  created.journals.push(r.id);
  return r;
}

async function createSession(page, name, recap, gmNotes, folderId) {
  const r = await page.evaluate(async ({ n, recap, gmNotes, folderId }) => {
    const e = await JournalEntry.create({
      name: n, folder: folderId, ownership: { default: 2 },
      pages: [{
        name: n, type: "mej-campaign-companion.session",
        flags: { "monks-enhanced-journal": { type: "session" } },
        system: { recap, gmNotes }
      }]
    });
    return { id: e.id, uuid: e.uuid };
  }, { n: name, recap, gmNotes, folderId });
  created.journals.push(r.id);
  return r;
}

const recapOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.recap ?? "", id);
const notesOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.gmNotes ?? "", id);
const textOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.text?.content ?? "", id);

/** Open an entry in the MEJ shell and return its knowledge panel (same steps as 07-knowledge's openEntry). */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  const panel = shell.locator(".mej-cc-knowledge");
  await expect(panel).toHaveCount(1);
  return { shell, panel };
}

/**
 * Open the Hub scoped to one campaign: bootstrap the shell on a non-timeline
 * entry (a timeline journal refuses the shell), set the scope through the
 * exported setHubScope, then click the Hub nav button (08-query-graph's
 * openHub, plus the scope step).
 */
async function openHubScoped(page, campaignFolderId, bootstrapEntryId) {
  await page.evaluate(async ({ id, folder }) => {
    const { setHubScope } = await import("/modules/mej-campaign-companion/scripts/apps/CampaignHubPage.mjs");
    setHubScope(folder);
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, { id: bootstrapEntryId, folder: campaignFolderId });
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function cleanup(gmPage) {
  await gmPage.evaluate(async ({ journals, folders, MOD }) => {
    const jids = journals.filter((id) => game.journal.get(id));
    if (jids.length) await JournalEntry.implementation.deleteDocuments(jids);
    const fids = folders.filter((id) => game.folders.get(id));
    if (fids.length) await Folder.implementation.deleteDocuments(fids);
    await game.settings.set(MOD, "autoLink", true);
    await game.settings.set(MOD, "retroLinkMode", "silent");
  }, { ...created, MOD });
  created.folders.length = 0;
  created.journals.length = 0;
}

test.describe("22 auto-link sessions", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("forward: a name typed into a session recap is linked and appears in Mentioned in", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: true, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const person = await createPerson(page, N.person, "<p>A person.</p>", folder);
    const session = await createSession(page, N.session, "<p>Opening.</p>", "", folder);

    await page.evaluate(async ({ id, html }) => {
      await game.journal.get(id).pages.contents[0].update({ "system.recap": html });
    }, { id: session.id, html: `<p>Opening. Then ${N.person} arrived.</p>` });
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${person.id}]{${N.person}}`);

    const { panel } = await openEntry(page, person.id);
    const backlinks = panel.locator(".mej-cc-knowledge-backlinks");
    const row = backlinks.locator(".mej-cc-backlink-row", { hasText: N.session });
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expect(row.locator(".mej-cc-backlink-count")).toHaveText("×1");
    assertNoConsoleErrors(errors);
  });

  test("create-time (silent default): recap, GM notes and a text page are linked in one pass with one toast", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const session = await createSession(page, N.session, `<p>${N.late} in recap.</p>`, `<p>${N.late} in notes.</p>`, folder);
    const text = await createPerson(page, N.textPage, `<p>${N.late} in text.</p>`, folder);
    await setSettings(page, { retroLinkMode: "silent" });
    const late = await createPerson(page, N.late, "<p>Late arrival.</p>", folder);

    // 3 places: recap, GM notes, text page.
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 3 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("dialog.application")).toHaveCount(0);
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    expect(await notesOf(page, session.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    expect(await textOf(page, text.id)).toContain(`@UUID[JournalEntry.${late.id}]`);
    assertNoConsoleErrors(errors);
  });

  test("Hub 'Link mentions': confirm dialog lists the campaign's matches; Link Checked links and toasts", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.camp);
    const hero = await createPerson(page, N.hubPerson, "<p>Hero.</p>", folder);
    const session = await createSession(page, N.hubSession, `<p>${N.hubPerson} saved the day.</p>`, "", folder);
    await setSettings(page, { retroLinkMode: "silent" });

    const shell = await openHubScoped(page, folder, hero.id);
    const button = shell.locator("button[data-action='linkMentions']");
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();

    const dialog = page.locator("dialog.application.mej-cc-retro-link-dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(N.hubSession);
    await dialog.locator("button[data-action='apply']").click();
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 1 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    assertNoConsoleErrors(errors);
  });
});
```

The Hub's Index tab is the default tab, so the `linkMentions` button is visible as soon as the Hub opens; if the Hub remembers another tab on this client, click `shell.locator('nav.sheet-tabs a[data-tab="index"]')` first.

- [ ] **Step 2: Import regression**

In `tests/e2e/05-docx-import.spec.mjs`, right after the existing `await expect(page.locator("#notifications li.notification.info", { hasText: /Imported \d+ entries/ })).toHaveCount(1, …)`, add:

```js
    // The create-time pass that follows an import must not surface a dialog
    // in the default Silent mode (it may or may not toast, depending on
    // whether the fixture's names occur in pre-existing pages).
    await expect(page.locator("dialog.application.mej-cc-retro-link-dialog")).toHaveCount(0);
```

- [ ] **Step 3: Run**

Run: `npx playwright test tests/e2e/22-auto-link-sessions.spec.mjs tests/e2e/05-docx-import.spec.mjs tests/e2e/07-knowledge.spec.mjs --trace off 2>&1 | tee /Users/danbularzik/.claude/jobs/4378f1d9/tmp/autolink-task8-e2e.log`
Expected: 22 3/3; 05 and 07 as on main (05's "sections detected…" is a known environmental failure that occurs before Create — if it fails, quote the line and confirm it is that failure).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/22-auto-link-sessions.spec.mjs tests/e2e/05-docx-import.spec.mjs
git commit -m "test(e2e): session recap auto-link (forward, create-time, Hub catch-up) and import regression"
```

---

### Task 9: Full-suite classification (v14) and v13 stock gate

**Files:** none (verification only; findings go to the ledger and the PR body).

- [ ] **Step 1: v14 full suite on World A**

Run: `npx playwright test --trace off 2>&1 | tee /Users/danbularzik/.claude/jobs/4378f1d9/tmp/autolink-task9-full.log`
Classify every failure against the known-environmental list (01×4 New-Entry-dialog, 02 index-row + stray-timeline guard, 05 sections-detected, 08×4, 09 dup-id, 14 create-campaign). Any failure outside that list, or any test whose assertion changed because pages now carry unexpected `@UUID` links with the new default-on forward path, is a branch defect: fix it (prefer making the test set `autoLink: false` explicitly when it asserts exact page text) and commit as `test(e2e): …`.

- [ ] **Step 2: v13 stock gate**

Foundry 13.351 + stock MEJ 13.06 on the harness port 30013 (see `tests/e2e/13-stock-smoke.spec.mjs` header for the env variables): run `13-stock-smoke` and `22-auto-link-sessions` test 2 in native mode. Log to `/Users/danbularzik/.claude/jobs/4378f1d9/tmp/autolink-task9-v13.log`. Expected: stock smoke 8/8; test 2 passes (the `system.recap` update goes through core's page update without MEJ's wrapper).

- [ ] **Step 3: Record**

Append the two run summaries (counts + classified failures with log line numbers) to the SDD ledger; no commit.
