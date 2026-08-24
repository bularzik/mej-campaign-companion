# Multiple Named Timelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a campaign hold any number of named timelines (one designated as the auto-filing default) and let timelines exist outside any campaign as world timelines, selectable from a Hub picker.

**Architecture:** A timeline stays "any JournalEntry carrying the `timeline` flag" — no new document type. Ordering/default-resolution/partitioning move into a pure planner (`logic/timelines.mjs`); `data/timeline-journal.mjs` grows plural lookups and creation while keeping its existing function names so current callers keep working. The Hub's Timeline pane gains a picker plus GM management, and every auto-filing path resolves the campaign's default timeline instead of "the" timeline.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-multi-timeline-design.md` (on this branch — read it first; its Decisions table is binding, notably: journal name IS the timeline name; world timelines accept any entry while campaign timelines stay campaign-restricted; auto-filing never prompts; zero migration).

## Global Constraints

- Branch `feature/multi-timeline`, worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/multi-timeline`. Never commit to main. No changes to the monks-enhanced-journal repo, ever.
- Playwright always `--trace off`; TT- fixture prefix; World A shared — id-tracked destructive cleanup only; reset the campaign scope AND the new timeline selection to `""` before each test ends; the harness auto-pins the module symlink per run, verify with readlink afterward anyway.
- Unit suite: **573 green** before this plan; Task 1 adds exactly 12 → **585** from Task 1 on.
- `dataVersion` stays 2 — this plan performs NO migration and writes no flags on load. A legacy campaign's sole timeline must remain its default purely by fallback.
- `canAttachToTimeline` (logic/campaigns.mjs) must NOT change: its existing null-campaign branch is what makes world timelines accept anything.
- Timeline journals stay excluded from Hub index rows, member listings, and export — no task may weaken those exclusions.

---

### Task 1: Pure timeline planner

**Files:**
- Create: `scripts/logic/timelines.mjs`
- Test: `test/timelines.test.js`

**Interfaces:**
- Consumes: nothing (pure; doc-shaped plain objects only, no Foundry imports — same convention as `logic/campaigns.mjs`).
- Produces: `orderTimelines(timelines, defaultId) -> Timeline[]`; `resolveDefaultTimelineId(timelines, flagId) -> string|null`; `partitionTimelines(entries, campaignIdOf) -> { byCampaign: Map<string, Timeline[]>, world: Timeline[] }`. Tasks 2-4 consume all three by exactly these names.

- [ ] **Step 1: Write the failing tests**

Create `test/timelines.test.js`:

```js
import { describe, it, expect } from "vitest";
import { orderTimelines, resolveDefaultTimelineId, partitionTimelines } from "../scripts/logic/timelines.mjs";

const tl = (id, name) => ({ id, name });

describe("orderTimelines", () => {
  it("puts the default first, then name-sorts the rest", () => {
    const list = [tl("a", "Zed"), tl("b", "Mid"), tl("c", "Apex")];
    expect(orderTimelines(list, "b").map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
  it("name-sorts everything when the default is absent or unknown", () => {
    const list = [tl("a", "Zed"), tl("c", "Apex")];
    expect(orderTimelines(list, null).map((t) => t.id)).toEqual(["c", "a"]);
    expect(orderTimelines(list, "gone").map((t) => t.id)).toEqual(["c", "a"]);
  });
  it("returns a new array and tolerates empty/nullish input", () => {
    const list = [tl("a", "A")];
    expect(orderTimelines(list, "a")).not.toBe(list);
    expect(orderTimelines([], "x")).toEqual([]);
    expect(orderTimelines(null, null)).toEqual([]);
  });
});

describe("resolveDefaultTimelineId", () => {
  const list = [tl("first", "Zed"), tl("second", "Apex")];
  it("honors a flag id that names one of the timelines", () => {
    expect(resolveDefaultTimelineId(list, "second")).toBe("second");
  });
  it("falls back to the FIRST element as given (creation order), not name order", () => {
    expect(resolveDefaultTimelineId(list, null)).toBe("first");
    expect(resolveDefaultTimelineId(list, "stale")).toBe("first");
  });
  it("returns null for an empty or nullish list", () => {
    expect(resolveDefaultTimelineId([], "x")).toBe(null);
    expect(resolveDefaultTimelineId(null, null)).toBe(null);
  });
});

describe("partitionTimelines", () => {
  const campaignIdOf = (e) => e.campaignId ?? null;
  const entry = (id, campaignId) => ({ id, name: id, campaignId });
  it("groups by campaign and buckets campaign-less timelines as world", () => {
    const { byCampaign, world } = partitionTimelines(
      [entry("t1", "c1"), entry("t2", "c1"), entry("t3", null), entry("t4", "c2")], campaignIdOf);
    expect(byCampaign.get("c1").map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(byCampaign.get("c2").map((t) => t.id)).toEqual(["t4"]);
    expect(world.map((t) => t.id)).toEqual(["t3"]);
  });
  it("returns empty structures for no input", () => {
    const { byCampaign, world } = partitionTimelines([], campaignIdOf);
    expect(byCampaign.size).toBe(0);
    expect(world).toEqual([]);
  });
  it("preserves input order within each bucket", () => {
    const { byCampaign } = partitionTimelines([entry("b", "c1"), entry("a", "c1")], campaignIdOf);
    expect(byCampaign.get("c1").map((t) => t.id)).toEqual(["b", "a"]);
  });
});
```

(3 + 3 + 3 = 9 `it` blocks; Step 5 adds 3 more in `test/campaigns.test.js` = 12 new tests.)

- [ ] **Step 2: Run to verify they fail**

Run (worktree root): `npx vitest run test/timelines.test.js`
Expected: FAIL — module `scripts/logic/timelines.mjs` not found.

- [ ] **Step 3: Implement `scripts/logic/timelines.mjs`**

```js
// Pure timeline selection logic (spec D §1). No Foundry imports so vitest
// can load it directly - same convention as logic/campaigns.mjs. Operates
// on doc-shaped plain objects: timelines have .id and .name.

/**
 * Display order: the default timeline first, then the rest name-sorted
 * (locale compare). A null/unknown defaultId simply name-sorts everything.
 * Always returns a new array; never mutates the input.
 */
export function orderTimelines(timelines, defaultId) {
  const list = [...(timelines ?? [])];
  const byName = (a, b) => (a.name ?? "").localeCompare(b.name ?? "");
  const def = list.find((t) => t.id === defaultId) ?? null;
  const rest = list.filter((t) => t !== def).sort(byName);
  return def ? [def, ...rest] : rest;
}

/**
 * Which timeline is the campaign's auto-filing default: the flagged id
 * when it still names one of `timelines`, else the FIRST element as given.
 * Callers pass Foundry collection order (i.e. creation order), so a legacy
 * campaign's sole timeline is always its default with no stored flag and
 * no migration write (spec D, Migration row). The fallback deliberately
 * ignores display ordering - that is orderTimelines' job.
 */
export function resolveDefaultTimelineId(timelines, flagId) {
  const list = timelines ?? [];
  if (!list.length) return null;
  return list.some((t) => t.id === flagId) ? flagId : list[0].id;
}

/**
 * Split timeline entries into per-campaign buckets plus the world bucket
 * (timelines under no campaign - spec D's world timelines). Input order is
 * preserved within every bucket so callers can feed the result straight to
 * resolveDefaultTimelineId.
 */
export function partitionTimelines(entries, campaignIdOf) {
  const byCampaign = new Map();
  const world = [];
  for (const entry of entries ?? []) {
    const cid = campaignIdOf(entry);
    if (!cid) {
      world.push(entry);
      continue;
    }
    if (!byCampaign.has(cid)) byCampaign.set(cid, []);
    byCampaign.get(cid).push(entry);
  }
  return { byCampaign, world };
}
```

- [ ] **Step 4: Add the campaign-flag key constant**

In `scripts/constants.mjs`, beside the other campaign-flag documentation, add:

```js
/** Key on the campaign flag naming its auto-filing default timeline (spec D §1). Absent = fall back to the campaign's first timeline. */
export const DEFAULT_TIMELINE_KEY = "defaultTimelineId";
```

- [ ] **Step 5: Guard the untouched attachment rule with tests**

In `test/campaigns.test.js`, inside the existing `canAttachToTimeline` describe block (read it first and match its fixture helpers), add 3 tests that pin the behavior this plan must not break:

```js
    it("a world timeline (no campaign) accepts an entry from any campaign", () => {
      const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
      const worldTimeline = entry("wt", { timeline: true });           // no folder => no campaign
      const member = entry("m1", { folder: camp });
      expect(canAttachToTimeline(member, worldTimeline)).toBe(true);
    });
    it("a campaign timeline still refuses another campaign's entry", () => {
      const campA = folder("ca", { campaign: { ownershipDefault: "observer" } });
      const campB = folder("cb", { campaign: { ownershipDefault: "observer" } });
      const timelineA = entry("ta", { folder: campA, timeline: true });
      expect(canAttachToTimeline(entry("mb", { folder: campB }), timelineA)).toBe(false);
    });
    it("a campaign timeline accepts its own campaign's entry", () => {
      const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
      const timeline = entry("t1", { folder: camp, timeline: true });
      expect(canAttachToTimeline(entry("m1", { folder: camp }), timeline)).toBe(true);
    });
```

(Adapt the `folder()`/`entry()` helper calls to that file's real signatures — it already has both helpers; do NOT change `canAttachToTimeline` itself.)

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run` — Expected: 585 passed.

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/timelines.mjs scripts/constants.mjs test/timelines.test.js test/campaigns.test.js
git commit -m "feat: pure timeline ordering, default resolution, and partitioning"
```

---

### Task 2: Plural timeline lookups, creation, and default assignment

**Files:**
- Modify: `scripts/data/timeline-journal.mjs` (whole file — it is 30 lines today)
- Modify: `scripts/hooks/auto-capture.mjs:100`, `scripts/apps/import-wizard.mjs:614` (comment-only clarifications; call sites keep working via preserved names)

**Interfaces:**
- Consumes: Task 1's `orderTimelines`, `resolveDefaultTimelineId`, `partitionTimelines`, `DEFAULT_TIMELINE_KEY`; existing `isTimelineJournal`, `campaignOf`/`campaignIdOf` (logic/campaigns.mjs), `isVisibleToUser` (logic/hub-index.mjs), `baselineOwnership` (data/campaign-store.mjs), `CAMPAIGN_FLAG` + `MODULE_ID` + `TIMELINE_JOURNAL_SETTING` (constants).
- Produces, all exported from `scripts/data/timeline-journal.mjs`: `campaignTimelines(campaign, { user } = {}) -> JournalEntry[]`; `worldTimelines({ user } = {}) -> JournalEntry[]`; `defaultTimeline(campaign) -> JournalEntry|null`; `createTimeline({ campaign = null, name }) -> Promise<JournalEntry|null>`; `setDefaultTimeline(campaign, timelineId) -> Promise<void>`; plus the PRESERVED names `getTimelineJournal()`, `campaignTimelineJournal(campaign)`, `resolveTimelineJournal(campaign)`, `ensureTimelineJournal(campaign)`. Tasks 3-4 consume the new five.

- [ ] **Step 1: Rewrite `scripts/data/timeline-journal.mjs`**

Keep the file's existing header imports and add the new ones; the four existing exports keep their names and contracts (now default-aware):

```js
import { MODULE_ID, TIMELINE_JOURNAL_SETTING, CAMPAIGN_FLAG, DEFAULT_TIMELINE_KEY } from "../constants.mjs";
import { isTimelineJournal, campaignIdOf } from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
import { orderTimelines, resolveDefaultTimelineId } from "../logic/timelines.mjs";
import { baselineOwnership } from "./campaign-store.mjs";

/** The legacy world-singleton timeline JournalEntry, or null. Retained for pre-adoption worlds; adoption (campaign-container spec §6) moves it into a campaign and clears the setting. */
export function getTimelineJournal() {
  const id = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING);
  return id ? game.journal.get(id) ?? null : null;
}

/**
 * Every timeline journal directly inside the campaign folder, in Foundry
 * collection (creation) order - the order resolveDefaultTimelineId's
 * fallback depends on. Visibility-filtered when `user` is given.
 */
export function campaignTimelines(campaign, { user = null } = {}) {
  const list = (campaign?.contents ?? []).filter((e) => isTimelineJournal(e));
  return user ? list.filter((e) => isVisibleToUser(e, user)) : list;
}

/**
 * World timelines (spec D): timeline journals under no campaign folder.
 * Name-sorted for display; visibility-filtered when `user` is given.
 */
export function worldTimelines({ user = null } = {}) {
  const list = game.journal.contents.filter((e) => isTimelineJournal(e) && !campaignIdOf(e));
  const visible = user ? list.filter((e) => isVisibleToUser(e, user)) : list;
  return orderTimelines(visible, null);
}

/** The campaign's auto-filing default timeline (spec D §1), or null when it has none. */
export function defaultTimeline(campaign) {
  const list = campaignTimelines(campaign);
  const flagged = campaign?.getFlag?.(MODULE_ID, CAMPAIGN_FLAG)?.[DEFAULT_TIMELINE_KEY] ?? null;
  const id = resolveDefaultTimelineId(list, flagged);
  return id ? list.find((t) => t.id === id) ?? null : null;
}

/** The campaign's timeline journal - now the DEFAULT one (spec D). Name kept: existing callers want "the timeline to file into". */
export function campaignTimelineJournal(campaign) {
  return defaultTimeline(campaign);
}

/** Resolve the timeline for a scope; null campaign -> legacy singleton. */
export function resolveTimelineJournal(campaign = null) {
  return campaign ? defaultTimeline(campaign) : getTimelineJournal();
}

/** GM-only. Create a timeline journal: inside `campaign` (campaign baseline ownership) or at root as a world timeline. Never sets the default flag - the first one wins by fallback, later ones are promoted explicitly (setDefaultTimeline). */
export async function createTimeline({ campaign = null, name }) {
  if (!game.user.isGM) return null;
  return JournalEntry.create({
    name,
    ...(campaign ? { folder: campaign.id } : {}),
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: {
      default: campaign ? baselineOwnership(campaign) : CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    }
  });
}

/** GM-only. Point the campaign at its auto-filing default timeline. */
export async function setDefaultTimeline(campaign, timelineId) {
  if (!game.user.isGM || !campaign) return;
  const flag = campaign.getFlag(MODULE_ID, CAMPAIGN_FLAG) ?? {};
  await campaign.setFlag(MODULE_ID, CAMPAIGN_FLAG, { ...flag, [DEFAULT_TIMELINE_KEY]: timelineId });
}

/** Find or create the scope's default timeline journal. Creation requires GM privileges. */
export async function ensureTimelineJournal(campaign = null) {
  const journal = resolveTimelineJournal(campaign);
  if (journal) return journal;
  if (!game.user.isGM) return null;
  if (campaign) return createTimeline({ campaign, name: `${campaign.name} — Timeline` });
  const created = await JournalEntry.create({
    name: "Campaign Timeline",
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, created.id);
  return created;
}
```

Watch for an import cycle: `campaign-store.mjs` must not import `timeline-journal.mjs` at module scope. Check with `grep -n "timeline-journal" scripts/data/campaign-store.mjs` — if it does, import `baselineOwnership` dynamically inside `createTimeline` instead and note why in a comment.

- [ ] **Step 2: Clarify the two auto-filing call sites (comments only)**

At `scripts/hooks/auto-capture.mjs:100` and `scripts/apps/import-wizard.mjs:614`, add a one-line comment above each `ensureTimelineJournal(campaign)` call:

```js
      // Spec D: this resolves the campaign's DEFAULT timeline; auto-filing
      // never prompts and never follows the Hub's currently-viewed one.
```

No behavior change — `ensureTimelineJournal` is already default-aware after Step 1.

- [ ] **Step 3: Verify**

Run: `npx vitest run` — Expected: 585 passed (no unit targets this Foundry glue; the suite must not regress).
Run: `node --input-type=module --check < scripts/data/timeline-journal.mjs && echo OK` — Expected: OK.
Run: `grep -rn "campaignTimelineJournal\|getTimelineJournal\|resolveTimelineJournal\|ensureTimelineJournal" scripts --include="*.mjs" | grep -v "timeline-journal.mjs:"` — Expected: the same five call sites as before this task (auto-capture, export-dialog, import-wizard, CampaignHubPage ×2 plus a comment) — no caller broke.

- [ ] **Step 4: Commit**

```bash
git add scripts/data/timeline-journal.mjs scripts/hooks/auto-capture.mjs scripts/apps/import-wizard.mjs
git commit -m "feat: plural timeline lookups, creation, and default assignment"
```

---

### Task 3: Hub timeline picker and stacked All view

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (HUB_STATE, the stacks block at :278-302, a `#timelineSelectionContext()` helper, the picker change listener, `setDefaultTimeline`/rename/delete actions)
- Modify: `templates/hub.hbs` (timeline pane: picker + management toolbar above the stacks)
- Modify: `scripts/constants.mjs` (`HUB_TIMELINE_SELECTION_SETTING`), `scripts/campaign-companion.mjs` (register the setting)
- Modify: `lang/en.json` (picker + management strings)

**Interfaces:**
- Consumes: Task 2's `campaignTimelines`, `worldTimelines`, `defaultTimeline`, `createTimeline`, `setDefaultTimeline`, `ensureTimelineJournal`, `resolveTimelineJournal`, `getTimelineJournal`; Task 1's `orderTimelines`; the existing `#timelineContext(journal, isGM)` helper (unchanged) and its `{ journalId, hasJournal, orderOptions, rows, showDateColumn }` shape.
- Produces: `context.timeline = { stacks, picker: { options, selectedId }, canManage, isDefault, isWorld }`; HUB_STATE gains `timelineId: null`. Task 4's e2e asserts this DOM.

- [ ] **Step 1: Setting + state**

`scripts/constants.mjs`:

```js
/** Client setting: the Hub Timeline pane's selected timeline id ("" = the scope's default/stacked view). Spec D §3. */
export const HUB_TIMELINE_SELECTION_SETTING = "hubTimelineSelection";
```

`scripts/campaign-companion.mjs`, beside the `HUB_CAMPAIGN_SCOPE_SETTING` registration (copy its exact option shape):

```js
  game.settings.register(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, {
    scope: "client", config: false, type: String, default: ""
  });
```

`CampaignHubPage.mjs` HUB_STATE literal: add `timelineId: null,` beside `campaignId`.

- [ ] **Step 2: Selection resolution + picker context**

Add to `CampaignHubPage.mjs` (private methods, beside `#scope()`):

```js
  /** Lazily seeded from the client setting; a stale/invisible id resets to "" (same discipline as #scope). */
  #timelineSelection() {
    if (this.state.timelineId === null) {
      this.state.timelineId = game.settings.get(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING);
    }
    const id = this.state.timelineId;
    if (!id) return null;
    const journal = game.journal.get(id);
    if (!journal || !isTimelineJournal(journal) || !isVisibleToUser(journal, game.user)) {
      this.state.timelineId = "";
      return null;
    }
    return journal;
  }

  /**
   * Picker options (spec D §3): the scoped campaign's timelines (default
   * marked), a separator, world timelines, then GM-only "New timeline…".
   * The separator is a disabled option so the template stays a plain select.
   */
  #timelineSelectionContext(campaign) {
    const user = game.user;
    const mine = campaign ? campaignTimelines(campaign, { user }) : [];
    const defId = campaign ? defaultTimeline(campaign)?.id ?? null : null;
    const ordered = orderTimelines(mine, defId);
    const world = worldTimelines({ user });
    const selectedId = this.#timelineSelection()?.id ?? "";
    const options = [
      { value: "", label: game.i18n.localize(`${I18N}.hub.timeline.allInScope`), selected: selectedId === "" },
      ...ordered.map((t) => ({
        value: t.id,
        label: t.id === defId ? `★ ${t.name}` : t.name,
        selected: selectedId === t.id
      }))
    ];
    if (world.length) {
      options.push({ value: "__sep", label: game.i18n.localize(`${I18N}.hub.timeline.worldGroup`), disabled: true, selected: false });
      options.push(...world.map((t) => ({ value: t.id, label: t.name, selected: selectedId === t.id })));
    }
    if (game.user.isGM) {
      options.push({ value: "__newtl", label: game.i18n.localize(`${I18N}.hub.timeline.newTimeline`), selected: false });
    }
    const selected = this.#timelineSelection();
    return {
      options,
      selectedId,
      canManage: game.user.isGM && !!selected,
      isDefault: !!selected && selected.id === defId,
      isWorld: !!selected && !campaignIdOf(selected)
    };
  }
```

(Import `campaignTimelines`, `worldTimelines`, `defaultTimeline`, `createTimeline`, `setDefaultTimeline` from `../data/timeline-journal.mjs`; `orderTimelines`, `partitionTimelines`, `resolveDefaultTimelineId` from `../logic/timelines.mjs`; `CAMPAIGN_FLAG` and `DEFAULT_TIMELINE_KEY` from `../constants.mjs`; `isTimelineJournal`/`campaignIdOf` are already imported or come from `../logic/campaigns.mjs`; `isVisibleToUser` from `../logic/hub-index.mjs`; `HUB_TIMELINE_SELECTION_SETTING` from `../constants.mjs`.)

- [ ] **Step 3: Rebuild the stacks block**

Replace the stacks computation (`_prepareBodyContext`, currently lines ~278-302) with:

```js
    const { campaign, unfiled } = this.#scope();
    const selectedTimeline = this.#timelineSelection();
    let stacks;
    if (unfiled) {
      stacks = [];
    } else if (selectedTimeline) {
      // Explicit pick wins in every scope (spec D §3).
      stacks = [{ name: null, ...this.#timelineContext(selectedTimeline, isGM) }];
    } else if (campaign) {
      const journal = isGM ? await ensureTimelineJournal(campaign) : resolveTimelineJournal(campaign);
      stacks = [{ name: null, ...this.#timelineContext(journal, isGM) }];
    } else {
      const campaigns = getCampaigns();
      if (!campaigns.length) {
        // Pre-adoption world: legacy singleton behavior, unchanged.
        const journal = isGM ? await ensureTimelineJournal() : getTimelineJournal();
        stacks = [{ name: null, ...this.#timelineContext(journal, isGM) }];
      } else {
        // Spec D §3: All mode stacks each campaign's DEFAULT timeline plus
        // every world timeline, never interleaved. No lazy creation here -
        // creating N journals on a render would be a side-effect storm.
        // One pass over the world's visible timelines, partitioned once
        // (logic/timelines.mjs), instead of re-scanning every folder.
        const visibleTimelines = game.journal.contents
          .filter((e) => isTimelineJournal(e) && isVisibleToUser(e, game.user));
        const { byCampaign, world } = partitionTimelines(visibleTimelines, campaignIdOf);
        stacks = campaigns.map((c) => {
          const list = byCampaign.get(c.id) ?? [];
          const defId = resolveDefaultTimelineId(list, c.getFlag(MODULE_ID, CAMPAIGN_FLAG)?.[DEFAULT_TIMELINE_KEY] ?? null);
          const journal = defId ? list.find((t) => t.id === defId) ?? null : null;
          return { name: c.name, ...this.#timelineContext(journal, isGM) };
        });
        for (const w of orderTimelines(world, null)) {
          stacks.push({ name: w.name, ...this.#timelineContext(w, isGM) });
        }
        const legacy = getTimelineJournal();
        if (legacy && !campaignOf(legacy) && !stacks.some((s) => s.journalId === legacy.id)) {
          stacks.push({ name: game.i18n.localize(`${I18N}.hub.scope.unfiled`), ...this.#timelineContext(legacy, isGM) });
        }
      }
    }
```

and set the context: `context.timeline = { stacks, ...this.#timelineSelectionContext(campaign) };`

- [ ] **Step 4: Actions and listener**

Actions map additions plus handlers (mirror the existing action idiom in this file — `static async onX(event, target)`, GM guard, `this.render({ parts: ["main"] })`):

```js
  static async onMakeTimelineDefault() {
    if (!game.user.isGM) return;
    const { campaign } = this.#scope();
    const journal = game.journal.get(this.state.timelineId);
    if (!campaign || !journal) return;
    await setDefaultTimeline(campaign, journal.id);
    this.render({ parts: ["main"] });
  }

  static async onRenameTimeline() {
    if (!game.user.isGM) return;
    const journal = game.journal.get(this.state.timelineId);
    if (!journal) return;
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.hub.timeline.rename`) },
      content: `<div class="form-group"><label>${foundry.utils.escapeHTML(game.i18n.localize(`${I18N}.hub.timeline.nameLabel`))}</label><input type="text" name="name" value="${foundry.utils.escapeHTML(journal.name)}"></div>`,
      ok: { callback: (event, button) => button.form.elements.name.value.trim() },
      rejectClose: false
    });
    if (!name) return;
    await journal.update({ name });
    this.render({ parts: ["main"] });
  }

  static async onDeleteTimeline() {
    if (!game.user.isGM) return;
    const journal = game.journal.get(this.state.timelineId);
    if (!journal) return;
    const count = (journal.getFlag(MODULE_ID, "timeline")?.timepoints ?? []).length;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${I18N}.hub.timeline.deleteTitle`) },
      content: `<p>${game.i18n.format(`${I18N}.hub.timeline.deleteBody`, { name: foundry.utils.escapeHTML(journal.name), count })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    await journal.delete();
    this.state.timelineId = "";
    await game.settings.set(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, "");
    this.render({ parts: ["main"] });
  }
```

Register these three in `DEFAULT_OPTIONS.actions` as `makeTimelineDefault`, `renameTimeline`, `deleteTimeline`. (`renameTimepoint`/`deleteTimepoint` already exist and are different actions — do not confuse them.)

Picker listener, in `activateListeners(html)` beside the campaign-scope listener, same `ccBound` dedupe:

```js
    const tlSelect = html.querySelector('select[name="timeline-select"]');
    if (tlSelect && !tlSelect.dataset.ccBound) {
      tlSelect.dataset.ccBound = "1";
      tlSelect.addEventListener("change", async (event) => {
        const value = event.target.value;
        if (value === "__sep") {           // disabled separator; restore the visible value
          event.target.value = this.state.timelineId ?? "";
          return;
        }
        if (value === "__newtl") {
          // Action-as-option (same idiom as the campaign picker's New Campaign…):
          // revert the visible selection first so a cancelled dialog leaves it alone.
          event.target.value = this.state.timelineId ?? "";
          const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize(`${I18N}.hub.timeline.newTimeline`) },
            content: `<div class="form-group"><label>${foundry.utils.escapeHTML(game.i18n.localize(`${I18N}.hub.timeline.nameLabel`))}</label><input type="text" name="name" value=""></div>`,
            ok: { callback: (e, button) => button.form.elements.name.value.trim() },
            rejectClose: false
          });
          if (!name) return;
          const { campaign } = this.#scope();
          const created = await createTimeline({ campaign, name });
          if (!created) return;
          this.state.timelineId = created.id;
          await game.settings.set(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, created.id);
          return this.render({ parts: ["main"] });
        }
        this.state.timelineId = value;
        await game.settings.set(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, value);
        this.render({ parts: ["main"] });
      });
    }
```

- [ ] **Step 5: Template**

In `templates/hub.hbs`'s timeline pane, immediately inside `<div class="tab-inner flexcol mej-cc-timeline">` and BEFORE `{{#each timeline.stacks}}`, insert:

```handlebars
                        <div class="mej-cc-timeline-controls">
                            <select name="timeline-select" class="mej-cc-timeline-select" aria-label="{{localize 'MEJCampaignCompanion.hub.timeline.pickerLabel'}}">
                                {{#each timeline.options}}
                                <option value="{{this.value}}" {{#if this.disabled}}disabled{{/if}} {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
                                {{/each}}
                            </select>
                            {{#if timeline.canManage}}
                            {{#unless timeline.isDefault}}{{#unless timeline.isWorld}}
                            <button type="button" class="mej-cc-timeline-default" data-action="makeTimelineDefault">
                                <i class="fa-solid fa-star"></i> {{localize "MEJCampaignCompanion.hub.timeline.makeDefault"}}
                            </button>
                            {{/unless}}{{/unless}}
                            <button type="button" class="mej-cc-timeline-rename" data-action="renameTimeline"
                                    data-tooltip="{{localize 'MEJCampaignCompanion.hub.timeline.rename'}}"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="mej-cc-timeline-delete" data-action="deleteTimeline"
                                    data-tooltip="{{localize 'MEJCampaignCompanion.hub.timeline.deleteTitle'}}"><i class="fa-solid fa-trash"></i></button>
                            {{/if}}
                        </div>
```

- [ ] **Step 6: i18n**

`lang/en.json`, add a `timeline` block inside `hub`:

```json
      "timeline": {
        "pickerLabel": "Timeline",
        "allInScope": "All timelines in scope",
        "worldGroup": "— World timelines —",
        "newTimeline": "➕ New timeline…",
        "nameLabel": "Timeline name",
        "makeDefault": "Make default",
        "rename": "Rename timeline",
        "deleteTitle": "Delete timeline",
        "deleteBody": "Delete “{name}” and its {count} timepoints? This cannot be undone."
      },
```

- [ ] **Step 7: Verify**

Run: `npx vitest run` — Expected: 585 passed.
Run: `node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && node --input-type=module --check < scripts/campaign-companion.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.
Run: `grep -c "{{#if" templates/hub.hbs && grep -c "{{/if}}" templates/hub.hbs` — the two counts must match (balanced Handlebars).

- [ ] **Step 8: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs templates/hub.hbs scripts/constants.mjs scripts/campaign-companion.mjs lang/en.json
git commit -m "feat: Hub timeline picker, world-timeline stacks, GM timeline management"
```

---

### Task 4: E2E — live verification

**Files:**
- Create: `tests/e2e/16-multi-timeline.spec.mjs`
- Modify: `tests/e2e/02-hub-timeline.spec.mjs`, `tests/e2e/14-campaigns.spec.mjs` (picker-selector fallout only, if any)

**Interfaces:**
- Consumes: Tasks 1-3 live behavior. DOM: `select[name="timeline-select"]` with options (`""`, timeline ids, `"__sep"` disabled, `"__newtl"`), `.mej-cc-timeline-default` / `.mej-cc-timeline-rename` / `.mej-cc-timeline-delete`, existing `.mej-cc-timeline-stack[data-journal-id]` and `.mej-cc-timepoint`.
- Produces: the live gate for this branch.

- [ ] **Step 1: Sweep the existing timeline suites**

Run `grep -n "mej-cc-timeline" tests/e2e/*.spec.mjs`. The picker adds a `.mej-cc-timeline-controls` div ABOVE the stacks; existing stack/timepoint selectors are unchanged, so expect zero required edits — but if any assertion counts direct children of `.mej-cc-timeline` or uses `:first-child`, fix it to target `.mej-cc-timeline-stack` explicitly. Report what you found either way.

- [ ] **Step 2: New spec `tests/e2e/16-multi-timeline.spec.mjs`**

Follow `14-campaigns.spec.mjs`'s imports and local helpers (login, TT_PREFIX, settle, trackConsoleErrors, its hub-open/scope helpers, id-tracked cleanup). Every test resets BOTH the campaign scope and the timeline selection to `""` in a `finally`. Scenarios — write these as real tests; each named assertion must exist in code:

```js
  test("1. second timeline in a campaign: picker switches panes", async ({ page }) => {
    // GM. Create campaign via createCampaign API (gets timeline #1 lazily when scoped).
    // Scope to it, open Timeline tab, add a timepoint (existing addTimepoint action) named TT-TP-One.
    // Picker → "__newtl" → dialog name "TT-Second" → created and selected.
    // Assert: exactly one .mej-cc-timeline-stack, its data-journal-id === the new timeline's id,
    //         and it shows NO TT-TP-One timepoint (fresh timeline).
    // Switch the picker back to the first timeline: the TT-TP-One timepoint is visible again.
  });

  test("2. auto-filing targets the default, not the viewed timeline", async ({ page }) => {
    // With the campaign scoped and TT-Second SELECTED in the picker, file a timepoint through a
    // real auto-filing path: call the import-style filing directly via the module API in page.evaluate -
    //   const j = await (await import("/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs")).ensureTimelineJournal(folder);
    //   then addTimepoint(j, "TT-Filed") via data/timepoints.mjs
    // Assert the timepoint landed on timeline #1 (the default), NOT on TT-Second:
    //   read both journals' timeline flags and assert labels contain/omit "TT-Filed" respectively.
  });

  test("3. Make default changes where filing lands", async ({ page }) => {
    // Select TT-Second, click .mej-cc-timeline-default, then repeat scenario 2's filing call.
    // Assert the new timepoint is on TT-Second, and the campaign flag's defaultTimelineId === TT-Second's id.
  });

  test("4. world timeline: appears in All and accepts a campaign entry's link", async ({ page }) => {
    // Scope to All ("" ), picker → "__newtl" → "TT-World" (no campaign scoped ⇒ created at root).
    // Assert: the journal has no folder; in All scope with picker "" it appears as its own stack.
    // Attach a link from a campaign member entry: call Timepoints.addLink on the world timeline via
    // page.evaluate after guarding with canAttachToTimeline(member, worldTimeline) === true;
    // assert canAttachToTimeline returns true here and false for that same member against ANOTHER
    // campaign's timeline (the discipline that must survive).
  });

  test("5. rename and delete", async ({ page }) => {
    // Select TT-Second → .mej-cc-timeline-rename → "TT-Renamed" → picker option text updates.
    // → .mej-cc-timeline-delete → confirm dialog body contains the timepoint count → accept.
    // Assert the journal is gone, the picker no longer lists it, and the selection reset to "".
  });

  test("6. player seat: only observable timelines, no management controls", async ({ browser }) => {
    // GM (first context) creates a campaign with two timelines: one at baseline OBSERVER, one set to NONE.
    // Player context (User 1) opens the Hub, scopes to the campaign, Timeline tab:
    // assert the picker lists the observable timeline and NOT the hidden one, and that
    // .mej-cc-timeline-default/.mej-cc-timeline-rename/.mej-cc-timeline-delete all have count 0.
  });
```

- [ ] **Step 3: Run**

```bash
npx playwright test tests/e2e/16-multi-timeline.spec.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/14-campaigns.spec.mjs --trace off --reporter=line
```

Expected: all passed; run the new spec twice consecutively to prove stability. A failure that is a product bug (picker doesn't switch, filing follows the view, world timeline refused) → stop, report BLOCKED with DOM/console evidence and diagnosis; do not weaken assertions.

- [ ] **Step 4: Confirm the environment**

Run: `readlink ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion` — Expected: the MAIN checkout path (harness teardown restores it). Confirm World A has no leftover TT- journals/folders: `page.evaluate` a count, or re-check via the specs' own cleanup assertions.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/
git commit -m "test: e2e for multiple named timelines - picker, default filing, world timelines, management"
```
