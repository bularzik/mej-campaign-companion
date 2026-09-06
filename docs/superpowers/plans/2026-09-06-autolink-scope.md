# Auto-link Scope Fixes (0.19.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Campaign portals/timelines are never auto-link sources or candidates; entries created inside a campaign inherit its ownership baseline; a retro pass blocked only by audience tells the GM why.

**Architecture:** One pure predicate `isLinkableEntity` in `logic/campaigns.mjs` replaces three inline filters (typing, retro, import). A new pure planner `logic/campaign-ownership.mjs` + hook `hooks/campaign-ownership.mjs` stamps the campaign baseline on `preCreateJournalEntry` when the creation data has no explicit ownership. `buildRetroPlanBatch` grows a `hidden` bucket (entities in scope that fail audience containment but would match), surfaced by `notifyRetroResult` and the confirm dialog.

**Tech Stack:** Foundry VTT 14 (World A :30000, API mode) / 13 (world-b :30013, native mode), vitest, Playwright e2e harness (`tests/e2e/`), MEJ fork `integration-14.07`.

**Spec:** `docs/superpowers/specs/2026-09-06-autolink-scope-design.md` (commit 517c8ed)

## Global Constraints

- Companion features never patch MEJ: nothing under `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` is modified.
- Worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/autolink-fixes`, branch `fix/autolink-scope`, base main @ f5bfd43. Run every command from the worktree root.
- Release version `0.19.1`; no new zip paths.
- `isLinkableEntity(entry, mejTypeOf)` is the ONLY portal/timeline exclusion used by the typing, retro and import paths (spec §1).
- `inheritedOwnership` never overrides creation data that carries an `ownership` key (object, even `{}`); `ownership: null` counts as absent (spec §2). GM seat only.
- The import wizard's `"gm"` audience passes `{ default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }` explicitly (spec §2).
- i18n keys exactly: `retroLink.hidden`, `retroLink.hiddenOnly` with the copy in spec §3.
- World A (`~/FoundryVTT-14`, :30000) is the user's REAL world: id-tracked or RUN-token cleanup only, never delete anything the test did not create. Respect `<FOUNDRY_DATA>/.claude-e2e-lock` (wait; never `npm run e2e:unlock`).
- Shipped tests: no `retries`, no `waitForTimeout`, no `test.skip`. Always `--trace off`. One spec per shell command (10-minute limit). Foreground commands only.
- Never `git stash` / `git stash pop`. A/B against main = run the spec from the main checkout (`/Users/danbularzik/Claude/Projects/mej-campaign-companion`), never by stashing.
- Commit after every task; conventional commit messages.

---

### Task 1: `isLinkableEntity` and the three call sites

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (append after `isCampaignPortal`, ~line 202)
- Modify: `scripts/hooks/auto-link.mjs:16,31-33`
- Modify: `scripts/hooks/retro-link.mjs:17,26-30,41-59`
- Modify: `scripts/apps/import-wizard.mjs:19,330-332`
- Test: `test/campaigns.test.js`

**Interfaces:**
- Produces: `isLinkableEntity(entry, mejTypeOf: (entry) => string|false|null|undefined): boolean` — exported from `scripts/logic/campaigns.mjs`.

- [ ] **Step 1: Write the failing unit test**

Append inside the outer `describe("campaigns module", …)` block of `test/campaigns.test.js` (add `isLinkableEntity` to the destructured import at the top of that block):

```js
  describe("isLinkableEntity", () => {
    const typed = (extra = {}) => ({
      id: "e1", documentName: "JournalEntry", folder: null,
      flags: { "monks-enhanced-journal": { type: "person" } },
      pages: { contents: [{ documentName: "JournalEntryPage", type: "text", flags: {} }] },
      ...extra
    });
    const mejTypeOf = (e) => e.flags?.["monks-enhanced-journal"]?.type ?? null;

    it("accepts an MEJ-typed entry", () => {
      expect(isLinkableEntity(typed(), mejTypeOf)).toBe(true);
    });
    it("rejects a campaign portal (page carries the portal marker)", () => {
      const portal = typed({
        flags: { "monks-enhanced-journal": { type: "campaign" } },
        pages: { contents: [{ documentName: "JournalEntryPage", type: `${MODULE_ID}.campaign`, flags: { [MODULE_ID]: { campaignPortal: true } } }] }
      });
      expect(isLinkableEntity(portal, mejTypeOf)).toBe(false);
    });
    it("rejects a timeline journal", () => {
      const timeline = typed({ flags: { "monks-enhanced-journal": { type: "journalentry" }, [MODULE_ID]: { timeline: { timepoints: [] } } } });
      expect(isLinkableEntity(timeline, mejTypeOf)).toBe(false);
    });
    it("rejects an untyped entry and null", () => {
      expect(isLinkableEntity(typed({ flags: {} }), mejTypeOf)).toBe(false);
      expect(isLinkableEntity(null, mejTypeOf)).toBe(false);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/campaigns.test.js`
Expected: FAIL — `isLinkableEntity is not a function`.

- [ ] **Step 3: Implement the predicate**

Append to `scripts/logic/campaigns.mjs` after `isCampaignPortal`:

```js
/**
 * An entry auto-link may link TO or scan FOR (spec 2026-09-06 §1): MEJ-typed,
 * and neither a campaign portal nor a timeline journal. The portal carries
 * MEJ type "campaign" and the timeline a companion flag, so without this
 * both read as ordinary entities and creating a campaign linked its own
 * name into every page in scope. `mejTypeOf` is injected because this
 * module stays free of Foundry imports.
 */
export function isLinkableEntity(entry, mejTypeOf) {
  if (!entry) return false;
  return !!mejTypeOf(entry) && !isTimelineJournal(entry) && !isCampaignPortal(entry);
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run test/campaigns.test.js`
Expected: PASS.

- [ ] **Step 5: Wire the typing path**

In `scripts/hooks/auto-link.mjs`, change the import on line 16 to
`import { campaignIdOf, isLinkableEntity } from "../logic/campaigns.mjs";`
and the filter in `buildCandidates` to:

```js
  const pages = game.journal
    .filter((entry) => isLinkableEntity(entry, mejType)
      && sameLinkScope(pageCampaignId, campaignIdOf(entry)))
```

- [ ] **Step 6: Wire the retro path**

In `scripts/hooks/retro-link.mjs`:

Line 17 import becomes
`import { campaignIdOf, isTimelineJournal, isCampaignPortal, isLinkableEntity } from "../logic/campaigns.mjs";`

Replace `isMejCandidate`:

```js
/**
 * MEJ's own New Entry dialog creates the entry FIRST (with
 * flags["monks-enhanced-journal"].pagetype) and its _onCreate patch adds the
 * typed page afterward — so at preCreate time getMEJType(entry) can still be
 * false for a dialog-created entry. Check both the constructed document and
 * the raw entry-level MEJ flags. A campaign portal (MEJ type "campaign",
 * created with its marked page inline) and a timeline journal are never
 * candidates (spec 2026-09-06 §1) — the pending document already carries
 * its pages and flags, so both predicates work on it here.
 */
function isMejCandidate(entry) {
  if (isTimelineJournal(entry) || isCampaignPortal(entry)) return false;
  if (mejType(entry)) return true;
  const mejFlags = entry.flags?.["monks-enhanced-journal"];
  return !!(mejFlags?.pagetype || mejFlags?.type);
}
```

In `planForBurst`, filter the entities (covers entries a login sweep finds still stamped by 0.19.0) and use the predicate for the twin index:

```js
function planForBurst(entries) {
  const users = game.users.contents;
  const entities = entries
    .filter((entry) => isLinkableEntity(entry, mejType))
    .map((entry) => ({
      uuid: entry.uuid, name: entry.name, campaignId: campaignIdOf(entry),
      viewerIds: viewerIds(entry, users, isVisibleToUser)
    }));
  if (!entities.length) return { rows: [] };
```

and in the `byName` loop:

```js
  for (const e of game.journal.contents) {
    if (!isLinkableEntity(e, mejType)) continue;
```

In `processBurst`, `notifyRetroResult(live, …)` must not name a filtered-out entity: after `let { rows } = planForBurst(live);` add
`live = live.filter((e) => isLinkableEntity(e, mejType));` **before** the `if (!rows.length) return;` line, and keep everything else unchanged.

- [ ] **Step 7: Wire the import path**

In `scripts/apps/import-wizard.mjs` line 19 add `isLinkableEntity` to the campaigns import, and in `#linkCandidates`:

```js
    const all = game.journal
      .filter((e) => isLinkableEntity(e, mejType) && sameLinkScope(campaignId, campaignIdOf(e)))
```

- [ ] **Step 8: Run the whole unit suite**

Run: `npx vitest run`
Expected: all green (813 + 4 new).

- [ ] **Step 9: Commit**

```bash
git add scripts/logic/campaigns.mjs scripts/hooks/auto-link.mjs scripts/hooks/retro-link.mjs scripts/apps/import-wizard.mjs test/campaigns.test.js
git commit -m "fix(auto-link): campaign portals and timelines are never link sources or candidates"
```

---

### Task 2: Campaign members inherit the ownership baseline

**Files:**
- Create: `scripts/logic/campaign-ownership.mjs`
- Create: `scripts/hooks/campaign-ownership.mjs`
- Create: `test/campaign-ownership.test.js`
- Modify: `scripts/integrations/mej-adapter.mjs:16-18,82-85`
- Modify: `scripts/apps/import-wizard.mjs:557-560`

**Interfaces:**
- Produces: `inheritedOwnership(data, baseline, { isGM }): { default: number } | null` (pure); `registerCampaignOwnership(): void` (hook).
- Consumes: `campaignOfFolder(folder)` from `logic/campaigns.mjs`; `baselineOwnership(campaign)` from `data/campaign-store.mjs`.

- [ ] **Step 1: Write the failing unit test**

Create `test/campaign-ownership.test.js`:

```js
import { describe, it, expect } from "vitest";
import { inheritedOwnership } from "../scripts/logic/campaign-ownership.mjs";

const OBSERVER = 2;

describe("inheritedOwnership", () => {
  it("stamps the campaign baseline when the creation data has no ownership", () => {
    expect(inheritedOwnership({ name: "Eldin", folder: "f1" }, OBSERVER, { isGM: true })).toEqual({ default: OBSERVER });
  });
  it("treats ownership: null as absent", () => {
    expect(inheritedOwnership({ ownership: null }, OBSERVER, { isGM: true })).toEqual({ default: OBSERVER });
  });
  it("never overrides explicit ownership, even an empty record", () => {
    expect(inheritedOwnership({ ownership: { default: 0 } }, OBSERVER, { isGM: true })).toBe(null);
    expect(inheritedOwnership({ ownership: {} }, OBSERVER, { isGM: true })).toBe(null);
  });
  it("does nothing outside a campaign", () => {
    expect(inheritedOwnership({}, null, { isGM: true })).toBe(null);
    expect(inheritedOwnership({}, undefined, { isGM: true })).toBe(null);
  });
  it("does nothing for a non-GM creator", () => {
    expect(inheritedOwnership({}, OBSERVER, { isGM: false })).toBe(null);
  });
  it("stamps a NONE baseline too (GM-only campaigns stay GM-only)", () => {
    expect(inheritedOwnership({}, 0, { isGM: true })).toEqual({ default: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/campaign-ownership.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/campaign-ownership.mjs`.

- [ ] **Step 3: Implement the planner**

Create `scripts/logic/campaign-ownership.mjs`:

```js
// scripts/logic/campaign-ownership.mjs
// Pure planner for spec 2026-09-06 §2: an entry created inside a campaign
// folder starts at the campaign's ownership baseline. No Foundry imports.

/**
 * Ownership record a new entry filed in a campaign should be created with,
 * or null to leave the creation data alone.
 *
 * Explicit wins: any `ownership` key in the creation data (the Hub's session
 * path, createMejEntry with an ownership argument, the portal and timeline
 * creators, MEJ's "Extract" which copies the source entry's ownership, a
 * macro) is never overridden. `ownership: null` counts as absent — that is
 * what `...(ownership ? { ownership } : {})` callers produce.
 *
 * @param {object} data           raw creation data (preCreateJournalEntry's 2nd arg)
 * @param {number|null|undefined} baseline  campaign baseline level, or null/undefined when
 *                                the target folder is not in a campaign
 * @param {{isGM:boolean}} opts   GM seat only, like the playersWriteSessions hook
 * @returns {{default:number}|null}
 */
export function inheritedOwnership(data, baseline, { isGM }) {
  if (!isGM) return null;
  if (baseline === null || baseline === undefined) return null;
  if (data?.ownership !== undefined && data?.ownership !== null) return null;
  return { default: baseline };
}
```

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run test/campaign-ownership.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the hook**

Create `scripts/hooks/campaign-ownership.mjs`:

```js
// scripts/hooks/campaign-ownership.mjs
// Entries created inside a campaign folder inherit the campaign's ownership
// baseline (spec 2026-09-06 §2). Before this, only the companion's own
// creation paths (Hub session, import, auto-capture) applied the baseline;
// a Person made through MEJ's New Entry dialog stayed at Foundry's default
// (players: NONE), so audience containment refused to link it into the
// player-visible recaps that mention it. Container rule, not a type rule:
// any JournalEntry filed in a campaign or one of its subfolders. GM seat
// only, and the playersWriteSessions hook (campaign-companion.mjs) still
// wins for sessions because OWNER is >= every baseline.
import { MODULE_ID } from "../constants.mjs";
import { campaignOfFolder } from "../logic/campaigns.mjs";
import { baselineOwnership } from "../data/campaign-store.mjs";
import { inheritedOwnership } from "../logic/campaign-ownership.mjs";

export function registerCampaignOwnership() {
  Hooks.on("preCreateJournalEntry", (entry, data) => {
    try {
      // Foundry creation data accepts a Folder document in place of an id;
      // the pending document already resolves that either way, so prefer it
      // and fall back to a manual lookup only if it can't (same pattern as
      // hooks/campaign-guard.mjs).
      const folder = entry.folder ?? game.folders.get(data?.folder?.id ?? data?.folder) ?? null;
      const campaign = campaignOfFolder(folder);
      const ownership = inheritedOwnership(data, campaign ? baselineOwnership(campaign) : null, { isGM: game.user.isGM });
      if (ownership) entry.updateSource({ ownership });
    } catch (err) {
      console.error(`${MODULE_ID} | campaign ownership inherit failed`, err);
    }
  });
}
```

- [ ] **Step 6: Register it in `registerCore()`**

In `scripts/integrations/mej-adapter.mjs`, add after line 18:
`import { registerCampaignOwnership } from "../hooks/campaign-ownership.mjs";`
and in `registerCore()` after the `retro-link` step:
```js
  await step("campaign ownership", () => registerCampaignOwnership());
```

- [ ] **Step 7: Make the import wizard's "GM only" audience explicit**

In `scripts/apps/import-wizard.mjs` replace the `ownership` computation (lines 557-560) with:

```js
    // Every audience is explicit now: entries created in a campaign inherit
    // its baseline when the creation data carries no ownership (spec
    // 2026-09-06 §2), so a "GM only" import must say NONE rather than lean
    // on Foundry's default. ("default" with no campaign cannot occur - the
    // wizard always resolves or creates one above.)
    const ownership =
      audience === "players" ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      : audience === "gm" ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }
      : campaign ? { default: baselineOwnership(campaign) }
      : null;
```

- [ ] **Step 8: Audit the e2e suite for entries created inside campaign folders without explicit ownership**

Run: `grep -n "folder:" tests/e2e/*.spec.mjs | grep -v "ownership" `
For every hit that is a `JournalEntry.create` (not `Folder.create` or a `Folder` lookup) inside a campaign folder and whose test asserts GM-only behaviour, add `ownership: { default: 0 }` to the creation data. Record each file changed (or "none needed") in the task report. Expected from the spec's pre-audit: `11-auto-link-scope`, `22-auto-link-sessions`, `14-campaigns`, `15-campaign-portal`, `23-campaign-creation` already pass ownership explicitly; `guide-screenshots` seeds may not, but assert nothing about ownership.

- [ ] **Step 9: Run the unit suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add scripts/logic/campaign-ownership.mjs scripts/hooks/campaign-ownership.mjs test/campaign-ownership.test.js scripts/integrations/mej-adapter.mjs scripts/apps/import-wizard.mjs tests/e2e
git commit -m "feat(campaigns): entries created inside a campaign inherit its ownership baseline"
```

---

### Task 3: `hidden` bucket and the hidden-mention warning

**Files:**
- Modify: `scripts/logic/retro-link.mjs:58-124`
- Modify: `scripts/hooks/retro-link.mjs:110-118,121-133,168-196`
- Modify: `lang/en.json:392-406`
- Test: `test/retro-link.test.js`

**Interfaces:**
- Produces: `buildRetroPlanBatch` rows gain `hidden: {entityUuid, entityName, count}[]` (always present, possibly empty).

- [ ] **Step 1: Write the failing unit tests**

Append to `test/retro-link.test.js` inside `describe("buildRetroPlanBatch", …)`:

```js
  it("reports an in-scope entity the page's readers cannot see under `hidden`, unwritten", () => {
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Eldin says hello. Eldin again.</p>", { viewerIds: ["u1"] });
    const { rows } = planOne(gmOnly, [playerPage]);
    expect(rows).toHaveLength(1);
    expect(rows[0].newHtml).toBe(null);
    expect(rows[0].matches).toEqual([]);
    expect(rows[0].hidden).toEqual([{ entityUuid: "JournalEntry.eldin", entityName: "Eldin", count: 2 }]);
  });

  it("does not report a hidden entity that would not have matched anyway", () => {
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Nobody here.</p>", { viewerIds: ["u1"] });
    expect(planOne(gmOnly, [playerPage]).rows).toEqual([]);
  });

  it("keeps writable matches and hidden matches on the same row", () => {
    const visible = { uuid: "JournalEntry.beren", name: "Beren", viewerIds: ["u1"] };
    const gmOnly = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [] };
    const playerPage = page("p1", "<p>Beren met Eldin.</p>", { viewerIds: ["u1"] });
    const { rows } = buildRetroPlanBatch({ entities: [visible, gmOnly], pages: [playerPage], otherSameNamed: {} });
    expect(rows).toHaveLength(1);
    expect(rows[0].matches.map((m) => m.entityUuid)).toEqual(["JournalEntry.beren"]);
    expect(rows[0].hidden.map((m) => m.entityUuid)).toEqual(["JournalEntry.eldin"]);
    expect(rows[0].newHtml).toContain("@UUID[JournalEntry.beren]");
    expect(rows[0].newHtml).not.toContain("@UUID[JournalEntry.eldin]");
  });

  it("an entity out of campaign scope is neither written nor reported hidden", () => {
    const inB = { uuid: "JournalEntry.eldin", name: "Eldin", viewerIds: [], campaignId: "B" };
    const pageA = page("p1", "<p>Eldin.</p>", { viewerIds: ["u1"], campaignId: "A" });
    expect(planOne(inB, [pageA]).rows).toEqual([]);
  });
```

Also update any existing assertion in this file that does `toEqual` on a whole row object so it includes `hidden: []` (search for `ambiguous: []` in expected objects).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/retro-link.test.js`
Expected: FAIL — `rows[0].hidden` undefined / rows empty.

- [ ] **Step 3: Implement the bucket**

In `scripts/logic/retro-link.mjs`, replace the body of the `for (const page of pages ?? [])` loop from `const forPage = …` down to the `rows.push` with:

```js
    // Own-page and campaign-scope checks decide who is IN REACH of the
    // page at all; audience containment then splits those into linkable
    // and hidden (spec 2026-09-06 §3) - a hidden entity is reported, never
    // written, so the GM learns why a mention stayed plain.
    const inReach = named.filter((e) =>
      page.entryUuid !== e.uuid && sameLinkScope(page.campaignId, e.campaignId));
    const forPage = inReach.filter((e) => audienceContains(page.viewerIds, e.viewerIds));
    const hiddenCandidates = inReach.filter((e) => !audienceContains(page.viewerIds, e.viewerIds));
    if (!forPage.length && !hiddenCandidates.length) continue;

    // A twin only makes the name ambiguous where BOTH entities are in reach
    // of the page: campaign A's "Mira" is unambiguous inside A while B keeps
    // its own Mira, and only an unfiled page sees both (spec §1).
    const twinned = (e) =>
      (otherSameNamed[e.uuid] ?? []).some((o) =>
        sameLinkScope(page.campaignId, o.campaignId) && audienceContains(page.viewerIds, o.viewerIds));
    const writable = forPage.filter((e) => !twinned(e));

    const linked = writable.length
      ? autoLinkAdded("", page.content, writable.map((e) => ({ name: e.name, uuid: e.uuid })))
      : page.content;
    const gained = (html, uuid) => countEntityLinks(html, uuid) - countEntityLinks(page.content, uuid);
    // Would this entity, planned alone against the ORIGINAL content, have
    // matched at all? Used for the two report-only buckets below.
    const soloCount = (e) => gained(autoLinkAdded("", page.content, [{ name: e.name, uuid: e.uuid }]), e.uuid);

    const matches = writable
      .map((e) => ({ entityUuid: e.uuid, entityName: e.name, count: gained(linked, e.uuid) }))
      .filter((m) => m.count > 0);

    // An ambiguous entity is reported but never written, so it is planned on
    // its own purely to find out whether it would have matched - a twin that
    // matches nothing here is not worth telling the GM about.
    const ambiguous = forPage.filter(twinned)
      .map((e) => ({ entityUuid: e.uuid, entityName: e.name, count: soloCount(e) }))
      .filter((m) => m.count > 0);

    // Same for an entity the page's readers cannot see.
    const hidden = hiddenCandidates
      .map((e) => ({ entityUuid: e.uuid, entityName: e.name, count: soloCount(e) }))
      .filter((m) => m.count > 0);

    if (!matches.length && !ambiguous.length && !hidden.length) continue;
    rows.push({
      pageUuid: page.uuid,
      pageName: page.name,
      key: page.key ?? "text.content",
      newHtml: matches.length ? linked : null,
      matches,
      ambiguous,
      hidden
    });
```

Update the JSDoc `@returns` on `buildRetroPlanBatch` to add `hidden:{entityUuid:string, entityName:string, count:number}[]` next to `ambiguous`.

- [ ] **Step 4: Run the unit test**

Run: `npx vitest run test/retro-link.test.js`
Expected: PASS.

- [ ] **Step 5: Add the i18n keys**

In `lang/en.json`, inside the `"retroLink"` object, add after `"ambiguousOnly"`:

```json
      "hidden": "Mentioned in pages their readers cannot see this entry from (reveal the entry to link it):",
      "hiddenOnly": "\"{name}\" is mentioned in {count} page(s) whose readers cannot see it. Reveal \"{name}\" (or apply the campaign baseline) to link it.",
```

- [ ] **Step 6: Surface it in the hook**

In `scripts/hooks/retro-link.mjs`:

Generalise `ambiguousList` into a two-bucket helper and use it for both lists:

```js
function reportList(rows, single, bucket, headingKey) {
  const esc = foundry.utils.escapeHTML;
  const items = rows.filter((r) => r[bucket].length).map((r) => {
    const who = single ? "" : ` — ${r[bucket].map((m) => esc(m.entityName)).join(", ")}`;
    return `<li>${esc(r.pageName)}${who}</li>`;
  });
  if (!items.length) return "";
  return `<p>${game.i18n.localize(`${I18N}.retroLink.${headingKey}`)}</p><ul>${items.join("")}</ul>`;
}
```

and in `confirmDialog` replace `ambiguousList(rows, single)` with
`reportList(rows, single, "ambiguous", "ambiguous") + reportList(rows, single, "hidden", "hidden")`.
Delete the old `ambiguousList` function.

In `notifyRetroResult`, add `hidden` to `detail` and a final branch:

```js
  const hiddenRows = rows.filter((r) => r.hidden.length);
  const detail = {
    linked: applied.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.matches.map((m) => `${m.entityName} (${m.count})`) })),
    ambiguous: ambiguousRows.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.ambiguous.map((m) => m.entityName) })),
    hidden: hiddenRows.map((r) => ({ page: r.pageName, field: r.key,
      entities: r.hidden.map((m) => m.entityName) }))
  };
```

…and after the existing `if (!writable && ambiguousRows.length) { … }` block:

```js
  // Nothing written, nothing failed, no twin in the way: the only reason
  // is that the page's readers cannot see the entity (spec 2026-09-06 §3).
  if (!writable && hiddenRows.length) {
    const name = hiddenRows[0].hidden[0].entityName;
    const count = hiddenRows.filter((r) => r.hidden.some((m) => m.entityName === name)).length;
    ui.notifications.warn(game.i18n.format(`${I18N}.retroLink.hiddenOnly`, { name, count }));
    console.info(`${MODULE_ID} | auto-link`, detail);
  }
```

Update the function's doc comment: add "a warn toast naming the entity when nothing was written only because the page's readers cannot see it" after the ambiguous-only sentence.

- [ ] **Step 7: Run the unit suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add scripts/logic/retro-link.mjs scripts/hooks/retro-link.mjs lang/en.json test/retro-link.test.js
git commit -m "feat(auto-link): report mentions the page's readers cannot see, instead of silence"
```

---

### Task 4: E2E coverage and live verification

**Files:**
- Modify: `tests/e2e/11-auto-link-scope.spec.mjs` (names block ~line 12-33; append three tests before the closing `});` of the describe)
- Modify: `tests/e2e/05-docx-import.spec.mjs` (after the `folderShape` assertions, ~line 226)

**Interfaces:**
- Consumes: Task 1-3 behaviour; spec 11's helpers `createMejPlace`, `createCampaignFolder`, `createMejPlaceIn`, `setSettings`, `pageContent`, `settle`, and its RUN-token `cleanup`.

- [ ] **Step 1: Add the run-unique names**

In the `N` object of `tests/e2e/11-auto-link-scope.spec.mjs` add:

```js
  portalPage: `TTPortalPage${RUN}`,
  portalCamp: `TTPortalCamp${RUN}`,
  inheritCamp: `TTInheritCamp${RUN}`,
  inheritSession: `TTInheritSession${RUN}`,
  inheritHero: `TTInheritHero${RUN}`,
  hiddenCamp: `TTHiddenCamp${RUN}`,
  hiddenSession: `TTHiddenSession${RUN}`,
  hiddenHero: `TTHiddenHero${RUN}`
```

Add one helper next to `createMejPlaceIn`:

```js
/** A player-visible companion session in a folder; recap/gmNotes are the two linkable regions. */
async function createSessionIn(page, name, recap, gmNotes, folderId) {
  return page.evaluate(async ({ n, recap, gmNotes, folderId }) => {
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
}
const recapOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.recap ?? "", id);
const notesOf = (page, id) => page.evaluate((id) => game.journal.get(id)?.pages.contents[0]?.system?.gmNotes ?? "", id);
```

- [ ] **Step 2: Write the three tests**

Append inside `test.describe("11 auto-link scoping", …)`:

```js
  test("creating a campaign never links its own name (portal is not an entity)", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const mention = await createMejPlace(page, N.portalPage, `<p>Met at the gates of ${N.portalCamp}.</p>`, 0);
    await setSettings(page, { retroLinkMode: "silent" });
    // The real creation path: folder + portal + timeline in one call, the
    // portal carrying MEJ type "campaign" - which 0.19.0 stamped as a
    // retro-link candidate.
    await page.evaluate(async (n) => {
      const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      await createCampaign(n);
    }, N.portalCamp);
    await settle(page, 1500);
    expect(await pageContent(page, mention.id)).not.toContain("@UUID[");
    expect(await page.locator("#notifications li.notification", { hasText: /Linked/ }).count()).toBe(0);
    assertNoConsoleErrors(errors);
  });

  test("an entry created in a campaign inherits the baseline and links into its recaps", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.inheritCamp); // baseline observer
    const session = await createSessionIn(page, N.inheritSession,
      `<p>${N.inheritHero} says hello.</p>`, `<p>${N.inheritHero} is a dragon.</p>`, folder);
    await setSettings(page, { retroLinkMode: "silent" });
    // No ownership in the creation data - exactly what MEJ's New Entry
    // dialog sends. Before 0.19.1 this stayed GM-only and the recap was
    // silently skipped.
    const hero = await page.evaluate(async ({ n, folderId }) => {
      const e = await JournalEntry.create({
        name: n, folder: folderId,
        pages: [{ name: n, type: "text", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: "<p>A hero.</p>" } }]
      });
      return { id: e.id, ownershipDefault: e.ownership.default };
    }, { n: N.inheritHero, folderId: folder });
    expect(hero.ownershipDefault).toBe(2);
    // Recap and GM notes are two linkable regions of one page = two rows.
    await expect(page.locator("#notifications li.notification.info", { hasText: /Linked .* in 2 place/ }))
      .toHaveCount(1, { timeout: 10_000 });
    await settle(page, 500);
    expect(await recapOf(page, session.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    expect(await notesOf(page, session.id)).toContain(`@UUID[JournalEntry.${hero.id}]`);
    assertNoConsoleErrors(errors);
  });

  test("a GM-only entry mentioned in a player-visible recap is reported, not linked", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    await setSettings(page, { autoLink: false, retroLinkMode: "off" });
    const folder = await createCampaignFolder(page, N.hiddenCamp);
    const session = await createSessionIn(page, N.hiddenSession,
      `<p>${N.hiddenHero} says hello.</p>`, `<p>Nothing here.</p>`, folder);
    await setSettings(page, { retroLinkMode: "silent" });
    const hero = await createMejPlaceIn(page, N.hiddenHero, "<p>Secret.</p>", 0, folder);
    await expect(page.locator("#notifications li.notification.warning", { hasText: N.hiddenHero }))
      .toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#notifications li.notification.warning", { hasText: /1 page\(s\) whose readers cannot see it/ }))
      .toHaveCount(1);
    expect(await recapOf(page, session.id)).not.toContain(`@UUID[JournalEntry.${hero.id}]`);
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 3: Add the import assertion**

In `tests/e2e/05-docx-import.spec.mjs`, after `expect(folderShape.directEntries).toBeGreaterThan(10);` add:

```js
    // Spec 2026-09-06 §1: the campaign the import creates is never a link
    // candidate for its own sections - "Radiant Citadel" in the prose stays
    // plain rather than pointing at the portal.
    const portalLinks = await page.evaluate((ids) => {
      const folder = game.folders.get(ids[0]);
      const portal = folder.contents.find((e) => e.pages.contents.some((p) => p.getFlag("mej-campaign-companion", "campaignPortal")));
      const needle = `@UUID[${portal.uuid}]`;
      return folder.contents.flatMap((e) => e.pages.contents)
        .filter((p) => (p.text?.content ?? "").includes(needle) || (p.system?.recap ?? "").includes(needle))
        .map((p) => p.name);
    }, createdCampaignFolderIds);
    expect(portalLinks).toEqual([]);
```

- [ ] **Step 4: Run spec 11 on v14**

Check the lock first: `ls /Users/danbularzik/FoundryVTT-14/Data/.claude-e2e-lock 2>/dev/null` — if present, wait and re-check; never unlock.

Run: `npx playwright test tests/e2e/11-auto-link-scope.spec.mjs --trace off`
Expected: 9/9 (6 existing + 3 new).

- [ ] **Step 5: Run spec 05 on v14**

Run: `npx playwright test tests/e2e/05-docx-import.spec.mjs --trace off`
Expected: PASS including the new portal-link assertion. (Environmental note from 0.19.0: the guide seed test can fail under load; spec 05 itself was green.)

- [ ] **Step 6: Run spec 22 on v14**

Run: `npx playwright test tests/e2e/22-auto-link-sessions.spec.mjs --trace off`
Expected: PASS — sessions/persons there already carry explicit ownership 2.

- [ ] **Step 7: Run specs 14, 15, 23 on v14 (campaign creation paths touch `preCreateJournalEntry`)**

One command each:
`npx playwright test tests/e2e/14-campaigns.spec.mjs --trace off`
`npx playwright test tests/e2e/15-campaign-portal.spec.mjs --trace off`
`npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off`
Expected: PASS, except the environmental failures already documented for 0.19.0 (`15` t5 campaign-scope selectOption timeout). Any NEW failure is A/B'd by running the same spec from `/Users/danbularzik/Claude/Projects/mej-campaign-companion` (main checkout; the harness pins the module symlink) — never by stashing.

- [ ] **Step 8: v13 stock smoke**

Run: `FOUNDRY_TARGET=v13 STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off`
Expected: 8/8.

- [ ] **Step 9: Confirm World A is clean**

Run from the worktree: `node -e "import('/Users/danbularzik/.claude/jobs/4378f1d9/tmp/list-tt.mjs')"` (lists `TT…` journals/folders; only the three pre-existing Aug-29 `TT…1788014838958` journals may remain). If a `TT…${RUN}` document of this run survived, delete it by id and note it in the report.

- [ ] **Step 10: Commit**

```bash
git add tests/e2e/11-auto-link-scope.spec.mjs tests/e2e/05-docx-import.spec.mjs
git commit -m "test(e2e): portal never linked, campaign baseline inherited, hidden-mention warning"
```

---

### Task 5: Docs, version, changelog

**Files:**
- Modify: `module.json:5`
- Modify: `CHANGELOG.md:1-3`
- Modify: `docs/gm-guide.md` (Campaigns section ~line 96; Auto-linking Scope paragraph ~line 208)

- [ ] **Step 1: Bump the version**

`module.json`: `"version": "0.19.1"` (also the `download` URL if it embeds the version — check with `grep -n "0.19.0" module.json` and replace every occurrence).

- [ ] **Step 2: CHANGELOG entry**

Insert after `# Changelog` and a blank line:

```markdown
## 0.19.1 (2026-09-06)

Auto-link scope fixes.

- **Fixed:** creating a campaign — from the sidebar, the Hub, an import or a stray upgrade — linked the campaign's own name into every page in scope, and a Word import linked its sections to the campaign it was creating. The portal entry and timeline journal are no longer link sources or candidates on any path.
- **Changed:** an entry created inside a campaign (MEJ's New Entry dialog, a macro, anything that doesn't set ownership itself) now starts at the campaign's **Player access** baseline instead of GM-only. Hide a specific entry with the Hub's eye toggle as before. The import wizard's **GM only** audience is unchanged — it now says so explicitly.
- **Added:** when a new entry is mentioned only in pages whose readers can't see it, the create-time pass says so — "*Eldin* is mentioned in 1 page(s) whose readers cannot see it…" — instead of staying silent; the review dialog lists those pages too.
```

- [ ] **Step 3: GM guide**

In `docs/gm-guide.md` **Campaigns** section, after the "**Creating one.**" paragraph, add:

```markdown
**What members start with.** Anything you create inside a campaign folder — through MEJ's New Entry dialog, the Hub, or a macro — starts at the campaign's **Player access** level, so a new NPC is immediately linkable from the recaps players can read. To keep one entry to yourself, hide it with the eye toggle in the Hub's Index (or set its ownership by hand); entries created with an explicit ownership keep it.
```

In the **Auto-linking** section, replace the last sentence of the **Scope.** paragraph ("On top of that, a mention only becomes a link when everyone who can already read the page can also see the entry being linked to (the GM is exempt).") with:

```markdown
On top of that, a mention only becomes a link when everyone who can already read the page can also see the entry being linked to (the GM is exempt). When that is the only reason a new entry was not linked, you get a warning — "*Eldin* is mentioned in 1 page(s) whose readers cannot see it" — with the page names in the console; reveal the entry (or apply the campaign baseline) and run **Link mentions** to catch up. The campaign's portal entry and its timeline are never linked to, so the campaign's own name stays plain text in your prose.
```

- [ ] **Step 4: Checks**

Run: `npm run check:links && npm run check:vendor && npx vitest run`
Expected: all OK / green.

- [ ] **Step 5: Commit**

```bash
git add module.json CHANGELOG.md docs/gm-guide.md
git commit -m "chore(release): 0.19.1 — changelog, guide, version"
```

---

## Self-review

- **Spec coverage:** §1 → Task 1 (predicate + three call sites + sweep safety via `planForBurst` filter). §2 → Task 2 (planner, hook, `registerCore` step, import "gm" explicit NONE, e2e audit). §3 → Task 3 (bucket, toast, console detail, dialog list, i18n). Versioning/docs → Task 5. Testing: unit in Tasks 1–3; e2e cases 1–3 and the import assertion in Task 4; v13 smoke in Task 4 Step 8 (spec's "case 2 through MEJ's dialog on v13" is folded into the stock smoke — the native subset has no New-Entry-dialog-driven creation helper, so the API form in spec 11 is the covering test, as the spec allows). Out-of-scope items untouched.
- **Placeholders:** none; every code step carries the code.
- **Type consistency:** `isLinkableEntity(entry, mejTypeOf)` used identically in Tasks 1 and 4; `inheritedOwnership(data, baseline, { isGM })` identical in Task 2 test/hook; row field `hidden` identical across Task 3 planner, hook and tests; i18n keys `retroLink.hidden` / `retroLink.hiddenOnly` identical in Task 3 and the Task 4 toast regex.
