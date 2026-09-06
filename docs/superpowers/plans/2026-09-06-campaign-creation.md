# Campaign Creation (0.19.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A campaign can only come into existence as folder + portal + timeline, created from the journal sidebar (or the Hub), with every stray path either closed or auto-upgraded.

**Architecture:** `createCampaign()` becomes the one atomic routine (folder → portal → timeline) and gains two siblings, `convertFolderToCampaign()` and `upgradeEntryToCampaign()`. A shared `promptNewCampaign()` dialog serves every surface. Two new hook modules do the UI work: `campaign-directory.mjs` (sidebar button + flag icon) and `campaign-guard.mjs` (strip Campaign from type pickers, cancel or upgrade stray campaign pages). Decisions are pure functions under `scripts/logic/` with vitest coverage; dataVersion 7 backfills timelines and upgrades existing strays.

**Tech Stack:** Foundry VTT 13.351 / 14.367 client API (ApplicationV2, DialogV2, Hooks), Monk's Enhanced Journal (API mode on the fork, native mode on stock 13.06), vitest, Playwright e2e harness (`tests/e2e`, World A on :30000, world-b on :30013).

**Spec:** `docs/superpowers/specs/2026-09-06-campaign-creation-design.md`

## Global Constraints

- Companion-side only: nothing under `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` is modified.
- Work happens in worktree `.claude/worktrees/campaign-creation`, branch `feat/campaign-creation`, base `main @ bd11ff9`. Never commit to `main`; never write into the main checkout.
- `scripts/logic/*` stays Foundry-free (vitest-loadable). Foundry glue lives in `scripts/data/*`, `scripts/hooks/*`, `scripts/apps/*`.
- Hook modules registered at `init` may import only `constants.mjs` and `scripts/logic/*` at top level; heavy modules (store, dialog, `CampaignHubPage.mjs`) are imported dynamically inside callbacks (see `hooks/folder-context.mjs` header comment).
- Copy (exact strings, `lang/en.json` under `MEJCampaignCompanion`):
  - `campaign.createButton` = `New Campaign`
  - `campaign.created` = `Campaign "{name}" created.`
  - `campaign.createFailed` = `Could not create the campaign. Check the console for details.`
  - `campaign.convertFolder` = `Make this folder a campaign`
  - `campaign.converted` = `Folder "{name}" is now a campaign.`
  - `campaign.strayBlocked` = `Campaign pages are created with the New Campaign button in the journal sidebar.`
  - `campaign.strayUpgraded` = `Created campaign "{name}" from this entry.`
  - `campaign.noCampaignFolder` = `This page isn't inside a campaign folder — use New Campaign in the journal sidebar.`
  - `migration.campaignStructure` = `Campaign structure: {timelines} timeline(s) created, {campaigns} campaign(s) created from loose pages.`
  - `migration.campaignStructureSkipped` = `{count} campaign page(s) could not be converted — see the console.`
- Timeline name on creation stays `${campaign.name} — Timeline` (em dash, `ensureTimelineJournal`).
- Auto-upgrade and folder conversion default `ownershipDefault` to `"observer"`.
- `CURRENT_DATA_VERSION` = 7; `module.json` version = `0.19.0`.
- e2e: World A is the user's real world — cleanup is id-tracked only, never name-based; never delete anything the test didn't create; close the MEJ shell before deleting fixtures (an open Hub re-creates timelines); no `retries`, `waitForTimeout`, or `test.skip` in shipped tests; always `--trace off`; respect `<FOUNDRY_DATA>/.claude-e2e-lock` (wait, never `npm run e2e:unlock`). Shell commands max 10 min — run e2e per spec file.
- Every Foundry write in new store functions is GM-gated (`game.user.isGM`) — the module's advertised invariant.

---

### Task 1: Pure logic — `canConvertFolder`, `classifyCampaignPageCreate`, `strayCampaignIntent`, `planCampaignStructure`

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (append after `isCampaignPortal`)
- Create: `scripts/logic/campaign-guard.mjs`
- Create: `scripts/logic/campaign-migration.mjs`
- Test: `test/campaigns.test.js` (append a `describe`), `test/campaign-guard.test.js` (new), `test/campaign-migration.test.js` (new)

**Interfaces:**
- Consumes: `MODULE_ID`, `CAMPAIGN_TYPE`, `CAMPAIGN_DOCUMENT_TYPE` from `scripts/constants.mjs`; `isCampaignFolder` from `campaigns.mjs`.
- Produces:
  - `campaigns.mjs`: `canConvertFolder(folder) → boolean`, `hasPortalMarker(page) → boolean`, `isCampaignTypedPage(page) → boolean`
  - `campaign-guard.mjs`: `classifyCampaignPageCreate({ isPortal, isGM, entryPageCount, entryInCampaign }) → "ignore"|"block-not-gm"|"block-multipage"|"block-in-campaign"|"allow"`, `strayCampaignIntent(data) → null | { otherPages: number }`, `CAMPAIGN_OPTION_VALUES: string[]`
  - `campaign-migration.mjs`: `planCampaignStructure({ folders, entries }) → { timelineFor: string[], upgrade: string[], skipped: { uuid, reason }[] }`

- [ ] **Step 1: Write the failing tests**

Append to `test/campaigns.test.js` (inside the outer `describe("campaigns module")`, after the existing inner describes):

```js
  describe("canConvertFolder / hasPortalMarker / isCampaignTypedPage", async () => {
    const { canConvertFolder, hasPortalMarker, isCampaignTypedPage } = await import("../scripts/logic/campaigns.mjs");
    const jf = (id, extra = {}) => ({ id, type: "JournalEntry", folder: null, flags: {}, ...extra });

    it("accepts a plain root JournalEntry folder", () => {
      expect(canConvertFolder(jf("f1"))).toBe(true);
    });
    it("rejects nested, campaign, non-journal and null folders", () => {
      expect(canConvertFolder(jf("f2", { folder: jf("p") }))).toBe(false);
      expect(canConvertFolder(jf("f3", { flags: { [MODULE_ID]: { campaign: { ownershipDefault: "observer" } } } }))).toBe(false);
      expect(canConvertFolder(jf("f4", { type: "Actor" }))).toBe(false);
      expect(canConvertFolder(null)).toBe(false);
    });
    it("hasPortalMarker reads only the companion flag", () => {
      expect(hasPortalMarker({ flags: { [MODULE_ID]: { campaignPortal: true } } })).toBe(true);
      expect(hasPortalMarker({ type: "mej-campaign-companion.campaign", flags: {} })).toBe(false);
      expect(hasPortalMarker(null)).toBe(false);
    });
    it("isCampaignTypedPage matches the three type spellings and nothing else", () => {
      expect(isCampaignTypedPage({ type: "mej-campaign-companion.campaign" })).toBe(true);
      expect(isCampaignTypedPage({ type: "campaign" })).toBe(true);
      expect(isCampaignTypedPage({ type: "text", _source: { type: "mej-campaign-companion.campaign" } })).toBe(true);
      expect(isCampaignTypedPage({ type: "text" })).toBe(false);
      expect(isCampaignTypedPage(null)).toBe(false);
    });
  });
```

Create `test/campaign-guard.test.js`:

```js
import { describe, it, expect } from "vitest";
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../scripts/constants.mjs";
import { classifyCampaignPageCreate, strayCampaignIntent, CAMPAIGN_OPTION_VALUES } from "../scripts/logic/campaign-guard.mjs";

describe("classifyCampaignPageCreate (spec 2026-09-06 §3 table)", () => {
  const base = { isPortal: false, isGM: true, entryPageCount: 0, entryInCampaign: false };
  it("ignores portal-marked pages regardless of anything else", () => {
    expect(classifyCampaignPageCreate({ ...base, isPortal: true, isGM: false, entryPageCount: 3, entryInCampaign: true })).toBe("ignore");
  });
  it("blocks non-GMs", () => {
    expect(classifyCampaignPageCreate({ ...base, isGM: false })).toBe("block-not-gm");
  });
  it("blocks a page added to an entry that already has pages", () => {
    expect(classifyCampaignPageCreate({ ...base, entryPageCount: 1 })).toBe("block-multipage");
  });
  it("blocks a page whose entry already sits inside a campaign", () => {
    expect(classifyCampaignPageCreate({ ...base, entryInCampaign: true })).toBe("block-in-campaign");
  });
  it("allows a fresh single-page campaign entry outside any campaign", () => {
    expect(classifyCampaignPageCreate(base)).toBe("allow");
  });
  it("multipage wins over in-campaign (both block; order is deterministic)", () => {
    expect(classifyCampaignPageCreate({ ...base, entryPageCount: 2, entryInCampaign: true })).toBe("block-multipage");
  });
});

describe("strayCampaignIntent", () => {
  it("returns null for entries with no campaign intent", () => {
    expect(strayCampaignIntent({ name: "x" })).toBe(null);
    expect(strayCampaignIntent({ name: "x", pages: [{ type: "text" }] })).toBe(null);
    expect(strayCampaignIntent(null)).toBe(null);
  });
  it("detects MEJ's New Entry pagetype flag, with or without a subtype suffix", () => {
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: CAMPAIGN_TYPE } } })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: "campaign:foo" } } })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ flags: { "monks-enhanced-journal": { pagetype: "person" } } })).toBe(null);
  });
  it("detects an inline campaign page and counts the other inline pages", () => {
    expect(strayCampaignIntent({ pages: [{ type: CAMPAIGN_DOCUMENT_TYPE }] })).toEqual({ otherPages: 0 });
    expect(strayCampaignIntent({ pages: [{ type: "text" }, { type: CAMPAIGN_DOCUMENT_TYPE }] })).toEqual({ otherPages: 1 });
  });
  it("ignores inline pages that carry the portal marker (ensureCampaignPortal's own creates)", () => {
    expect(strayCampaignIntent({ pages: [{ type: CAMPAIGN_DOCUMENT_TYPE, flags: { [MODULE_ID]: { campaignPortal: true } } }] })).toBe(null);
  });
});

describe("CAMPAIGN_OPTION_VALUES", () => {
  it("lists the bare MEJ key and the prefixed native subtype", () => {
    expect(CAMPAIGN_OPTION_VALUES).toEqual([CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE]);
  });
});
```

Create `test/campaign-migration.test.js`:

```js
import { describe, it, expect } from "vitest";
import { planCampaignStructure } from "../scripts/logic/campaign-migration.mjs";

const folder = (id, { isCampaign = true, hasTimeline = false } = {}) => ({ id, isCampaign, hasTimeline });
const entry = (id, { pageCount = 1, stray = false, inCampaign = false } = {}) =>
  ({ id, uuid: `JournalEntry.${id}`, pageCount, strayCampaignPage: stray, inCampaign });

describe("planCampaignStructure (spec 2026-09-06 §4)", () => {
  it("backfills a timeline only for campaign folders lacking one", () => {
    const plan = planCampaignStructure({
      folders: [folder("a"), folder("b", { hasTimeline: true }), folder("c", { isCampaign: false })],
      entries: []
    });
    expect(plan.timelineFor).toEqual(["a"]);
  });
  it("upgrades a loose single-page stray", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e1", { stray: true })] });
    expect(plan.upgrade).toEqual(["e1"]);
    expect(plan.skipped).toEqual([]);
  });
  it("skips a multipage stray with reason 'multipage'", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e2", { stray: true, pageCount: 2 })] });
    expect(plan.upgrade).toEqual([]);
    expect(plan.skipped).toEqual([{ uuid: "JournalEntry.e2", reason: "multipage" }]);
  });
  it("skips a stray inside a campaign with reason 'in-campaign' (checked before page count)", () => {
    const plan = planCampaignStructure({ folders: [], entries: [entry("e3", { stray: true, pageCount: 2, inCampaign: true })] });
    expect(plan.skipped).toEqual([{ uuid: "JournalEntry.e3", reason: "in-campaign" }]);
  });
  it("ignores non-stray entries and preserves input order", () => {
    const plan = planCampaignStructure({
      folders: [],
      entries: [entry("x"), entry("e5", { stray: true }), entry("e4", { stray: true })]
    });
    expect(plan.upgrade).toEqual(["e5", "e4"]);
  });
  it("tolerates missing inputs", () => {
    expect(planCampaignStructure({})).toEqual({ timelineFor: [], upgrade: [], skipped: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/campaigns.test.js test/campaign-guard.test.js test/campaign-migration.test.js`
Expected: FAIL — `canConvertFolder` etc. are not exported; the two new modules cannot be resolved.

- [ ] **Step 3: Implement**

Append to `scripts/logic/campaigns.mjs` (after `isCampaignPortal`):

```js
/** The page carries the companion's portal marker (stamped by buildCampaignPortalData and upgradeEntryToCampaign). */
export function hasPortalMarker(page) {
  return page?.flags?.[MODULE_ID]?.campaignPortal === true;
}

/** A campaign-typed page by any of its three spellings - see isCampaignPortalPage for why there are three. */
export function isCampaignTypedPage(page) {
  if (!page) return false;
  return page.type === CAMPAIGN_DOCUMENT_TYPE ||
    page.type === "campaign" ||
    page._source?.type === CAMPAIGN_DOCUMENT_TYPE;
}

/**
 * Can this folder be converted in place into a campaign (spec 2026-09-06
 * §1): a plain, root-level JournalEntry folder. Nested folders are refused
 * because campaigns never nest; campaign folders because there is nothing
 * to convert.
 */
export function canConvertFolder(folder) {
  if (!folder || folder.type !== "JournalEntry") return false;
  if (folder.folder) return false;
  return !isCampaignFolder(folder);
}
```

Create `scripts/logic/campaign-guard.mjs`:

```js
// Pure decisions behind hooks/campaign-guard.mjs (spec 2026-09-06 §3). No
// Foundry imports - same convention as campaigns.mjs.
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";

/** <option> values a page-type picker may carry for our campaign type: MEJ's bare registry key and Foundry's prefixed subtype. */
export const CAMPAIGN_OPTION_VALUES = [CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE];

/**
 * Spec §3 table. `entryPageCount` is the number of pages the entry will hold
 * BESIDES the campaign page; `entryInCampaign` says whether the entry's
 * folder resolves to a campaign. Order matters: a multipage entry is refused
 * before its folder is even looked at.
 */
export function classifyCampaignPageCreate({ isPortal, isGM, entryPageCount, entryInCampaign }) {
  if (isPortal) return "ignore";
  if (!isGM) return "block-not-gm";
  if (entryPageCount > 0) return "block-multipage";
  if (entryInCampaign) return "block-in-campaign";
  return "allow";
}

/**
 * Inspect JournalEntry creation data for a stray campaign page. MEJ's New
 * Entry dialog carries the intent as flags.monks-enhanced-journal.pagetype
 * ("campaign" or "campaign:<subtype>") with no pages yet, and adds the page
 * itself in _onCreate; API/macro/import creation carries inline pages.
 * Inline pages already carrying the portal marker are ensureCampaignPortal's
 * own work and never count. Null when no campaign page is involved.
 */
export function strayCampaignIntent(data) {
  if (!data) return null;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const inline = pages.filter((p) => p?.type === CAMPAIGN_DOCUMENT_TYPE && p?.flags?.[MODULE_ID]?.campaignPortal !== true);
  const pagetype = String(data.flags?.["monks-enhanced-journal"]?.pagetype ?? "").split(":")[0];
  if (!inline.length && pagetype !== CAMPAIGN_TYPE) return null;
  return { otherPages: pages.length - inline.length };
}
```

Create `scripts/logic/campaign-migration.mjs`:

```js
// dataVersion-7 planner (spec 2026-09-06 §4). Pure: the executor in
// campaign-companion.mjs builds the shaped inputs and walks the plan.
//   folders: { id, isCampaign, hasTimeline }
//   entries: { id, uuid, pageCount, strayCampaignPage, inCampaign }

export function planCampaignStructure({ folders = [], entries = [] } = {}) {
  const timelineFor = folders.filter((f) => f.isCampaign && !f.hasTimeline).map((f) => f.id);
  const upgrade = [];
  const skipped = [];
  for (const e of entries) {
    if (!e.strayCampaignPage) continue;
    if (e.inCampaign) { skipped.push({ uuid: e.uuid, reason: "in-campaign" }); continue; }
    if (e.pageCount > 1) { skipped.push({ uuid: e.uuid, reason: "multipage" }); continue; }
    upgrade.push(e.id);
  }
  return { timelineFor, upgrade, skipped };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/campaigns.test.js test/campaign-guard.test.js test/campaign-migration.test.js`
Expected: PASS. Then `npm test` — every existing test still passes (787 + new).

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/campaigns.mjs scripts/logic/campaign-guard.mjs scripts/logic/campaign-migration.mjs test/campaigns.test.js test/campaign-guard.test.js test/campaign-migration.test.js
git commit -m "feat(campaigns): pure decisions for folder conversion, stray-page guard and v7 migration"
```

---

### Task 2: Atomic `createCampaign`, `convertFolderToCampaign`, `upgradeEntryToCampaign`, shared dialog, Hub call sites

**Files:**
- Modify: `scripts/data/campaign-store.mjs` (imports, `createCampaign`, new functions after `ensureCampaignPortal`)
- Create: `scripts/apps/new-campaign-dialog.mjs`
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onNewCampaign` ~1096-1125, `onAdoptWorld` ~1199-1230, portal-scope block ~286-297, imports line 20 and 42-45)
- Modify: `lang/en.json` (new `campaign` namespace)
- Test: `tests/e2e/23-campaign-creation.spec.mjs` (new, first two tests + cleanup scaffold)

**Interfaces:**
- Consumes: `canConvertFolder`, `hasPortalMarker`, `isCampaignTypedPage`, `campaignOf` (Task 1 / existing); `ensureTimelineJournal` from `data/timeline-journal.mjs`; `buildCampaignPortalData`.
- Produces: `createCampaign(name, { ownershipDefault }) → Folder|null` (now also creates the timeline); `completeCampaignStructure(folder) → Promise<void>`; `convertFolderToCampaign(folder, { ownershipDefault }) → Folder|null`; `upgradeEntryToCampaign(entry, { ownershipDefault }) → Promise<Folder|null>` (serialized); `promptNewCampaign({ name, title, intro }) → Promise<{ name, baseline }|null>`.

- [ ] **Step 1: Store changes**

In `scripts/data/campaign-store.mjs` replace the import block and `createCampaign`, and add the new functions directly after `ensureCampaignPortal`:

```js
// Foundry glue over logic/campaigns.mjs (spec §1): the seam every other
// subsystem consumes for campaign scope. Imports Foundry globals, so it
// is NOT vitest-loadable; keep anything testable in logic/campaigns.mjs.
import { MODULE_ID, CAMPAIGN_FLAG, AUTO_CAPTURE_CAMPAIGN_SETTING } from "../constants.mjs";
import {
  isCampaignFolder, campaignOf, campaignFlagOf, isTimelineJournal, isCampaignPortal,
  ownershipLevelFor, bulkOwnershipPlan, canConvertFolder, hasPortalMarker, isCampaignTypedPage
} from "../logic/campaigns.mjs";
import { buildCampaignPortalData } from "../logic/campaign-portal-data.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";
// ESM cycle: timeline-journal.mjs imports baselineOwnership from this file.
// Safe because both sides only reference the other's function declarations
// at call time (hoisted bindings), never during module evaluation.
import { ensureTimelineJournal } from "./timeline-journal.mjs";
```

```js
/**
 * GM-only. Creates the whole campaign structure (spec 2026-09-06 §1): a
 * root-level flagged folder (campaigns never nest - spec §1), then its
 * portal, then its timeline. RULING: if this is the world's first campaign
 * and no auto-capture target is set yet, seed AUTO_CAPTURE_CAMPAIGN_SETTING
 * to it - a legacy (pre-campaign) world's auto-capture setting is unset by
 * definition, and without this its first import/adoption would silently
 * stop auto-capturing until a GM finds the separate capture-target picker.
 */
export async function createCampaign(name, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM) return null;
  const wasFirst = getCampaigns().length === 0;
  const folder = await Folder.create({
    name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
  if (!folder) return null;
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await completeCampaignStructure(folder);
  return folder;
}

async function seedAutoCaptureIfFirst(folder, wasFirst) {
  if (wasFirst && !game.settings.get(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING)) {
    await game.settings.set(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, folder.id);
  }
}

/**
 * Portal, then timeline - each idempotent, each its own repair point.
 * Foundry has no transactions: a failed write is logged and the other still
 * runs, so a later Hub open or the migration completes the structure rather
 * than duplicating it (spec 2026-09-06 §1).
 */
export async function completeCampaignStructure(campaign) {
  try {
    await ensureCampaignPortal(campaign);
  } catch (err) {
    console.error(`${MODULE_ID} | portal creation failed for campaign ${campaign.id}`, err);
  }
  try {
    await ensureTimelineJournal(campaign);
  } catch (err) {
    console.error(`${MODULE_ID} | timeline creation failed for campaign ${campaign.id}`, err);
  }
}

/**
 * GM-only. Promote a plain root JournalEntry folder into a campaign in place
 * (spec 2026-09-06 §1): flag it, then portal + timeline. Entries already in
 * it stay where they are. Null (no writes) when canConvertFolder refuses.
 */
export async function convertFolderToCampaign(folder, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM || !canConvertFolder(folder)) return null;
  const wasFirst = getCampaigns().length === 0;
  await folder.update({ [`flags.${MODULE_ID}.${CAMPAIGN_FLAG}`]: { ownershipDefault } });
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await completeCampaignStructure(folder);
  return folder;
}

// Upgrades run one at a time: two create hooks can fire for the same entry
// (createJournalEntry for inline pages, createJournalEntryPage for MEJ's
// _onCreate) and rapid creates must not interleave folder writes.
let upgradeChain = Promise.resolve();

/**
 * GM-only. Turn a loose single-page campaign entry into a real campaign
 * (spec 2026-09-06 §3): root folder named after the entry, entry moved in
 * and stamped as the portal, timeline created. Re-checks eligibility at run
 * time, so a second call for the same entry is a no-op. Resolves to the
 * folder, or null when nothing was done.
 */
export function upgradeEntryToCampaign(entry, { ownershipDefault = "observer" } = {}) {
  const run = upgradeChain
    .then(() => doUpgrade(entry, { ownershipDefault }))
    .catch((err) => {
      console.error(`${MODULE_ID} | campaign upgrade failed for ${entry?.uuid}`, err);
      return null;
    });
  upgradeChain = run;
  return run;
}

async function doUpgrade(entry, { ownershipDefault }) {
  if (!game.user.isGM || !entry?.pages) return null;
  const pages = entry.pages.contents;
  const page = pages[0];
  if (pages.length !== 1 || !isCampaignTypedPage(page) || hasPortalMarker(page) || campaignOf(entry)) return null;
  const wasFirst = getCampaigns().length === 0;
  const folder = await Folder.create({
    name: entry.name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
  if (!folder) return null;
  await seedAutoCaptureIfFirst(folder, wasFirst);
  await entry.update({ folder: folder.id, "ownership.default": baselineOwnership(folder) });
  const { flags } = buildCampaignPortalData(entry.name);
  await page.update({ name: entry.name, flags });
  await ensureTimelineJournal(folder);
  return folder;
}
```

- [ ] **Step 2: Shared dialog**

Create `scripts/apps/new-campaign-dialog.mjs`:

```js
// The New Campaign prompt (spec 2026-09-06 §1), shared by the Hub picker,
// the adopt banner, the sidebar button and folder conversion. Foundry-only
// (DialogV2, no MEJ imports), so init-registered hooks may import it
// dynamically without touching MEJ's import chain.
import { I18N } from "../constants.mjs";

/**
 * Name + Player-access prompt. `name` pre-fills the input; `title`/`intro`
 * override the window title and add a leading paragraph (the adopt banner
 * uses both). Resolves { name, baseline } or null on cancel / blank name.
 */
export async function promptNewCampaign({ name = "", title = null, intro = null } = {}) {
  const esc = foundry.utils.escapeHTML;
  const baselineOptions = ["none", "observer", "owner"].map((k) =>
    `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
  const content = `
    ${intro ? `<p>${esc(intro)}</p>` : ""}
    <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
      <input type="text" name="name" value="${esc(name)}" autofocus></div>
    <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
      <select name="baseline">${baselineOptions}</select></div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: title ?? game.i18n.localize(`${I18N}.hub.newCampaign`) },
    content,
    ok: {
      callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        baseline: button.form.elements.baseline.value
      })
    },
    rejectClose: false
  });
  return result?.name ? result : null;
}
```

- [ ] **Step 3: Hub call sites**

In `scripts/apps/CampaignHubPage.mjs` add `import { promptNewCampaign } from "./new-campaign-dialog.mjs";` next to the other `./` app imports (line ~42). Replace the body of `onNewCampaign` from `const esc = ...` through `if (!result?.name) return;` with:

```js
    const result = await promptNewCampaign();
    if (!result) return;
```

(the remaining lines — `createCampaign(...)`, `state.campaignId`, setting, render — stay). In `onAdoptWorld` replace from `const esc = ...` through `if (!result?.name) return;` with:

```js
    const result = await promptNewCampaign({
      name: game.world.title,
      title: game.i18n.localize(`${I18N}.hub.adoptGo`),
      intro: game.i18n.localize(`${I18N}.hub.adoptExplain`)
    });
    if (!result) return;
```

In the portal-scope block (~line 291) change

```js
      const portalCampaign = campaignOf(this.document);
      if (portalCampaign) {
        this.state.campaignId = portalCampaign.id;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, portalCampaign.id);
      }
```

to

```js
      const portalCampaign = campaignOf(this.document);
      if (portalCampaign) {
        this.state.campaignId = portalCampaign.id;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, portalCampaign.id);
      } else {
        // A campaign page with no campaign folder: only the v7 migration's
        // skipped strays can still look like this (spec 2026-09-06 §5).
        ui.notifications.warn(game.i18n.localize(`${I18N}.campaign.noCampaignFolder`));
      }
```

- [ ] **Step 4: i18n**

In `lang/en.json`, add a `campaign` object directly before `"hub"` under `MEJCampaignCompanion`:

```json
  "campaign": {
    "createButton": "New Campaign",
    "created": "Campaign \"{name}\" created.",
    "createFailed": "Could not create the campaign. Check the console for details.",
    "convertFolder": "Make this folder a campaign",
    "converted": "Folder \"{name}\" is now a campaign.",
    "strayBlocked": "Campaign pages are created with the New Campaign button in the journal sidebar.",
    "strayUpgraded": "Created campaign \"{name}\" from this entry.",
    "noCampaignFolder": "This page isn't inside a campaign folder — use New Campaign in the journal sidebar."
  },
```

- [ ] **Step 5: e2e spec 23 scaffold + first tests**

Create `tests/e2e/23-campaign-creation.spec.mjs`:

```js
// Campaign creation (spec 2026-09-06): one atomic structure (folder +
// portal + timeline), a sidebar front door, folder conversion, the stray-
// page guard, and the v7 migration. Fixtures are id-tracked and deleted in
// afterEach; the shell is closed first because an open Hub re-creates a
// scoped campaign's timeline while cleanup runs (spec 22's lesson).
import { test, expect } from "@playwright/test";
import {
  login, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors, settle, reloadGame,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";
import { CURRENT_DATA_VERSION } from "../../scripts/constants.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const MOD = "mej-campaign-companion";
const STORE = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const RUN = Date.now().toString(36).slice(-5);
const name = (tag) => `TT-CC ${tag} ${RUN}`;
const created = { folders: [], journals: [] };

/** Folder id + portal/timeline presence for one campaign folder. */
async function structureOf(page, folderId) {
  return page.evaluate((id) => {
    const f = game.folders.get(id);
    if (!f) return null;
    const flag = f.getFlag("mej-campaign-companion", "campaign") ?? null;
    const portal = f.contents.find((e) => e.pages.contents.some((p) => p.getFlag("mej-campaign-companion", "campaignPortal") === true));
    const timelines = f.contents.filter((e) => e.getFlag("mej-campaign-companion", "timeline"));
    return { flag, portalId: portal?.id ?? null, portalName: portal?.name ?? null, timelineNames: timelines.map((t) => t.name), parent: f.folder?.id ?? null };
  }, folderId);
}

async function cleanup(gm) {
  await gm.evaluate(async ({ journals, folders, MOD, version }) => {
    try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
    const tracked = new Set(folders);
    const inTracked = () => game.journal.contents.filter((e) => tracked.has(e.folder?.id)).map((e) => e.id);
    let extra = inTracked();
    for (let i = 0; i < 6 && extra.length === 0 && folders.length; i++) {
      await new Promise((r) => setTimeout(r, 300));
      extra = inTracked();
    }
    const jids = [...new Set([...journals.filter((id) => game.journal.get(id)), ...extra])];
    if (jids.length) await JournalEntry.implementation.deleteDocuments(jids);
    const fids = folders.filter((id) => game.folders.get(id));
    if (fids.length) await Folder.implementation.deleteDocuments(fids, { deleteContents: true });
    if (game.settings.get(MOD, "dataVersion") !== version) await game.settings.set(MOD, "dataVersion", version);
  }, { ...created, MOD, version: CURRENT_DATA_VERSION });
  created.folders.length = 0;
  created.journals.length = 0;
}

test.describe("23 campaign creation", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, (gm) => cleanup(gm));
  });

  test("1. createCampaign() builds folder, portal and timeline in one call", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Atomic");
    const folderId = await page.evaluate(async ({ STORE, n }) => {
      const { createCampaign } = await import(STORE);
      return (await createCampaign(n, { ownershipDefault: "observer" })).id;
    }, { STORE, n });
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "observer" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    expect(s.parent).toBe(null);
    assertNoConsoleErrors(errors);
  });

  test("2. convertFolderToCampaign() promotes a plain root folder in place and refuses nested/campaign folders", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Convert");
    const ids = await page.evaluate(async (n) => {
      const root = await Folder.create({ name: n, type: "JournalEntry" });
      const nested = await Folder.create({ name: `${n} nested`, type: "JournalEntry", folder: root.id });
      const member = await JournalEntry.create({ name: `${n} member`, folder: root.id, pages: [{ name: "p", type: "text" }] });
      return { root: root.id, nested: nested.id, member: member.id };
    }, n);
    created.folders.push(ids.root, ids.nested);
    created.journals.push(ids.member);
    const result = await page.evaluate(async ({ STORE, ids }) => {
      const { convertFolderToCampaign } = await import(STORE);
      const nestedResult = await convertFolderToCampaign(game.folders.get(ids.nested), { ownershipDefault: "owner" });
      const rootResult = await convertFolderToCampaign(game.folders.get(ids.root), { ownershipDefault: "owner" });
      const again = await convertFolderToCampaign(game.folders.get(ids.root), { ownershipDefault: "none" });
      return { nested: nestedResult?.id ?? null, root: rootResult?.id ?? null, again: again?.id ?? null, memberFolder: game.journal.get(ids.member).folder?.id ?? null };
    }, { STORE, ids });
    expect(result.nested).toBe(null);
    expect(result.root).toBe(ids.root);
    expect(result.again).toBe(null);
    expect(result.memberFolder).toBe(ids.root);
    const s = await structureOf(page, ids.root);
    expect(s.flag).toEqual({ ownershipDefault: "owner" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] **Step 6: Run**

Run: `npm test` → PASS. Then `npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off` → 2 passed. Also `npx playwright test tests/e2e/14-campaigns.spec.mjs --trace off` → all pass (test 1 drives the Hub picker through the new dialog; test 7 seeds a raw flagged folder and is unaffected — see Deviations).

- [ ] **Step 7: Commit**

```bash
git add scripts/data/campaign-store.mjs scripts/apps/new-campaign-dialog.mjs scripts/apps/CampaignHubPage.mjs lang/en.json tests/e2e/23-campaign-creation.spec.mjs
git commit -m "feat(campaigns): atomic createCampaign with timeline, folder conversion, entry upgrade, shared New Campaign dialog"
```

---

### Task 3: Sidebar New Campaign button + campaign folder icon

**Files:**
- Create: `scripts/hooks/campaign-directory.mjs`
- Modify: `scripts/campaign-companion.mjs` (imports ~line 17; init block after `registerTimelineDirectory();` ~line 157)
- Modify: `styles/campaign-companion.css` (append)
- Test: `tests/e2e/23-campaign-creation.spec.mjs` (append tests 3–5)

**Interfaces:**
- Consumes: `promptNewCampaign` (Task 2), `createCampaign` (Task 2), `isCampaignFolder`, `I18N`.
- Produces: `registerCampaignDirectory()`, `addCreateCampaignButton(root)`, `decorateCampaignFolders(root)`; DOM: `button.mej-cc-create-campaign` in `.directory-header .header-actions`; `li.folder.mej-cc-campaign-folder` with `i.fa-flag`.

- [ ] **Step 1: Hook module**

Create `scripts/hooks/campaign-directory.mjs`:

```js
// Campaign creation from the journal sidebar (spec 2026-09-06 §2): a GM-only
// New Campaign header button and a flag icon on campaign folder rows, on
// both Foundry's JournalDirectory and MEJ's shell sidebar copy - the same
// two hooks timeline-directory.mjs uses (see its header for why both run
// after MEJ's own decoration). Top-level imports are constants + pure logic
// only, so this registers at init; the dialog and store load on click.
import { I18N } from "../constants.mjs";
import { isCampaignFolder } from "../logic/campaigns.mjs";

const BUTTON_CLASS = "mej-cc-create-campaign";
const FOLDER_CLASS = "mej-cc-campaign-folder";
const FOLDER_ICON = "fa-solid fa-flag fa-fw";

function rootOf(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}

/**
 * Insert the New Campaign button after Create Folder. Only for a GM, and
 * only where the directory itself offers Create Folder (permission and
 * non-compendium surfaces both fall out of that one check). Idempotent.
 * Exported for tests.
 */
export function addCreateCampaignButton(root) {
  if (!root?.querySelector || !game.user?.isGM) return;
  const actions = root.querySelector(".directory-header .header-actions");
  const after = actions?.querySelector("button.create-folder");
  if (!actions || !after || actions.querySelector(`.${BUTTON_CLASS}`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.innerHTML = `<i class="fa-solid fa-flag" inert></i><span>${foundry.utils.escapeHTML(game.i18n.localize(`${I18N}.campaign.createButton`))}</span>`;
  button.addEventListener("click", onCreateCampaign);
  after.after(button);
}

async function onCreateCampaign(event) {
  event.preventDefault();
  const [{ promptNewCampaign }, { createCampaign }] = await Promise.all([
    import("../apps/new-campaign-dialog.mjs"),
    import("../data/campaign-store.mjs")
  ]);
  const result = await promptNewCampaign();
  if (!result) return;
  const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
  if (!campaign) {
    ui.notifications.error(game.i18n.localize(`${I18N}.campaign.createFailed`));
    return;
  }
  ui.notifications.info(game.i18n.format(`${I18N}.campaign.created`, { name: campaign.name }));
}

/** Flag icon + class on every campaign folder row under `root`. Idempotent. Exported for tests. */
export function decorateCampaignFolders(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("li.folder[data-folder-id]")) {
    const folder = game.folders.get(li.dataset.folderId);
    if (!folder || !isCampaignFolder(folder)) continue;
    li.classList.add(FOLDER_CLASS);
    const icon = li.querySelector(":scope > .folder-header > i");
    if (icon) icon.className = FOLDER_ICON;
  }
}

function decorate(root) {
  addCreateCampaignButton(root);
  decorateCampaignFolders(root);
}

export function registerCampaignDirectory() {
  Hooks.on("renderJournalDirectory", (app, html) => decorate(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => decorate(rootOf(app?.element)));
}
```

- [ ] **Step 2: Register at init and style**

In `scripts/campaign-companion.mjs` add `import { registerCampaignDirectory } from "./hooks/campaign-directory.mjs";` after the `registerTimelineDirectory` import, and after `registerTimelineDirectory();` in the init block add:

```js
  // Sidebar New Campaign button + flag icon on campaign folders (spec
  // 2026-09-06 §2) - pure-logic imports only, safe at init like the two above.
  registerCampaignDirectory();
```

Append to `styles/campaign-companion.css`:

```css
/* Campaign folder rows in the journal sidebar (spec 2026-09-06 §2): the flag
   icon is swapped in by hooks/campaign-directory.mjs; this only lifts the
   header so a campaign reads as more than a folder. */
#journal .mej-cc-campaign-folder > .folder-header .folder-name,
#MonksEnhancedJournal .mej-cc-campaign-folder > .folder-header .folder-name {
  font-weight: 600;
}
```

- [ ] **Step 3: e2e tests 3–5**

Append inside the `test.describe` of `tests/e2e/23-campaign-creation.spec.mjs`:

```js
  /** Bring the core journal sidebar to the front (the MEJ shell covers it while open). */
  async function showSidebar(page) {
    await page.evaluate(async () => {
      try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
      await ui.journal.activate();
    });
    await settle(page, 300);
  }

  /** Fill the New Campaign DialogV2 and confirm. */
  async function confirmNewCampaign(page, n, baseline = "observer") {
    const dialog = page.locator(".application.dialog:has(input[name='name'])").last();
    await expect(dialog).toBeVisible();
    await dialog.locator("input[name='name']").fill(n);
    await dialog.locator("select[name='baseline']").selectOption(baseline);
    await dialog.locator("button[data-action='ok']").click();
  }

  test("3. the sidebar New Campaign button creates folder, portal and timeline and toasts", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await showSidebar(page);
    const button = page.locator("#journal .directory-header button.mej-cc-create-campaign");
    await expect(button).toHaveCount(1);
    await expect(button).toContainText("New Campaign");
    const n = name("Sidebar");
    await button.click();
    await confirmNewCampaign(page, n, "owner");
    await expect(page.locator("#notifications .notification", { hasText: `Campaign "${n}" created.` })).toBeVisible();
    const folderId = await page.evaluate((n) => game.folders.find((f) => f.type === "JournalEntry" && f.name === n)?.id ?? null, n);
    expect(folderId).not.toBe(null);
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "owner" });
    expect(s.portalName).toBe(n);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    // The row is a campaign now: flag icon + class, on the same render.
    const row = page.locator(`#journal li.folder[data-folder-id="${folderId}"]`);
    await expect(row).toHaveClass(/mej-cc-campaign-folder/);
    await expect(row.locator(":scope > .folder-header > i.fa-flag")).toHaveCount(1);
    assertNoConsoleErrors(errors);
  });

  test("4. MEJ's shell sidebar carries the same button; plain folders carry no flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const plainId = await page.evaluate(async (n) => (await Folder.create({ name: n, type: "JournalEntry" })).id, name("Plain"));
    created.folders.push(plainId);
    await showSidebar(page);
    const plainRow = page.locator(`#journal li.folder[data-folder-id="${plainId}"]`);
    await expect(plainRow).toHaveCount(1);
    await expect(plainRow).not.toHaveClass(/mej-cc-campaign-folder/);
    await expect(plainRow.locator(":scope > .folder-header > i.fa-flag")).toHaveCount(0);
    // Open the shell on any non-timeline entry and look at its sidebar copy.
    await page.evaluate(async () => {
      const entry = game.journal.contents.find((e) => !e.getFlag("mej-campaign-companion", "timeline"));
      await game.MonksEnhancedJournal.openJournalEntry(entry);
    });
    await settle(page, 500);
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".directory-header button.mej-cc-create-campaign")).toHaveCount(1);
    assertNoConsoleErrors(errors);
  });

  test("5. a player seat sees no New Campaign button", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    await showSidebar(page);
    await expect(page.locator("#journal .directory-header button.create-entry, #journal .directory-header button.create-folder").first()).toBeVisible();
    await expect(page.locator("#journal .directory-header button.mej-cc-create-campaign")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
```

If "User 1" cannot create entries in World A (no Create Entry button rendered), replace the first `expect(...).toBeVisible()` in test 5 with `await expect(page.locator("#journal .directory-header")).toBeVisible();` — the assertion that matters is the zero count.

- [ ] **Step 4: Run**

Run: `npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off` → 5 passed. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/campaign-directory.mjs scripts/campaign-companion.mjs styles/campaign-companion.css tests/e2e/23-campaign-creation.spec.mjs
git commit -m "feat(campaigns): sidebar New Campaign button and flag icon on campaign folders"
```

---

### Task 4: Folder context menu — "Make this folder a campaign"

**Files:**
- Modify: `scripts/hooks/folder-context.mjs`
- Test: `tests/e2e/23-campaign-creation.spec.mjs` (append test 6)

**Interfaces:**
- Consumes: `canConvertFolder` (Task 1), `promptNewCampaign`, `convertFolderToCampaign` (Task 2), `folderFromHeader` (existing, same file).
- Produces: context option named `MEJCampaignCompanion.campaign.convertFolder`.

- [ ] **Step 1: Add the option**

In `scripts/hooks/folder-context.mjs` change the logic import to `import { isCampaignFolder, canConvertFolder } from "../logic/campaigns.mjs";`, add after `addOption`:

```js
/**
 * "Make this folder a campaign" (spec 2026-09-06 §2): a plain root journal
 * folder is promoted in place through the same Name + Player-access prompt
 * as every other creation surface; a changed name renames the folder first
 * (portal-sync keeps folder and portal names aligned from then on).
 */
function addConvertOption(options) {
  if (options.some((o) => o?.name === `${I18N}.campaign.convertFolder`)) return;
  options.push({
    name: `${I18N}.campaign.convertFolder`,
    icon: '<i class="fa-solid fa-flag"></i>',
    condition: (header) => game.user.isGM && canConvertFolder(folderFromHeader(header)),
    callback: async (header) => {
      const folder = folderFromHeader(header);
      if (!folder) return;
      const [{ promptNewCampaign }, { convertFolderToCampaign }] = await Promise.all([
        import("../apps/new-campaign-dialog.mjs"),
        import("../data/campaign-store.mjs")
      ]);
      const result = await promptNewCampaign({
        name: folder.name,
        title: game.i18n.localize(`${I18N}.campaign.convertFolder`)
      });
      if (!result) return;
      if (result.name !== folder.name) await folder.update({ name: result.name });
      const campaign = await convertFolderToCampaign(folder, { ownershipDefault: result.baseline });
      if (!campaign) {
        ui.notifications.error(game.i18n.localize(`${I18N}.campaign.createFailed`));
        return;
      }
      ui.notifications.info(game.i18n.format(`${I18N}.campaign.converted`, { name: campaign.name }));
    }
  });
}
```

and change `registerFolderContext` to:

```js
export function registerFolderContext() {
  Hooks.on("getFolderContextOptions", (app, options) => {
    addOption(options);
    addConvertOption(options);
  });
}
```

- [ ] **Step 2: e2e test 6**

Append inside the `test.describe`:

```js
  test("6. right-click 'Make this folder a campaign' converts a root folder in place; nested and campaign folders don't offer it", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Ctx");
    const ids = await page.evaluate(async (n) => {
      const root = await Folder.create({ name: n, type: "JournalEntry" });
      const nested = await Folder.create({ name: `${n} nested`, type: "JournalEntry", folder: root.id });
      const member = await JournalEntry.create({ name: `${n} member`, folder: root.id, pages: [{ name: "p", type: "text" }] });
      return { root: root.id, nested: nested.id, member: member.id };
    }, n);
    created.folders.push(ids.root, ids.nested);
    created.journals.push(ids.member);
    await showSidebar(page);
    const item = page.locator("#context-menu .context-item", { hasText: "Make this folder a campaign" });

    // Nested folder: expand the root so the nested row is visible, right-click it, no option.
    const rootRow = page.locator(`#journal li.folder[data-folder-id="${ids.root}"]`);
    if (!(await rootRow.evaluate((el) => el.classList.contains("expanded")))) await rootRow.locator(":scope > .folder-header").click();
    await page.locator(`#journal li.folder[data-folder-id="${ids.nested}"] > .folder-header`).click({ button: "right" });
    await expect(page.locator("#context-menu")).toBeVisible();
    await expect(item).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Root folder: option present; rename in the dialog; converted in place.
    await rootRow.locator(":scope > .folder-header").click({ button: "right" });
    await expect(item).toHaveCount(1);
    await item.click();
    const renamed = `${n} renamed`;
    await confirmNewCampaign(page, renamed, "none");
    await expect(page.locator("#notifications .notification", { hasText: `Folder "${renamed}" is now a campaign.` })).toBeVisible();
    const s = await structureOf(page, ids.root);
    expect(s.flag).toEqual({ ownershipDefault: "none" });
    expect(s.portalName).toBe(renamed);
    expect(s.timelineNames).toEqual([`${renamed} — Timeline`]);
    expect(await page.evaluate((id) => game.journal.get(id).folder?.id, ids.member)).toBe(ids.root);

    // Campaign folder now: option gone.
    await rootRow.locator(":scope > .folder-header").click({ button: "right" });
    await expect(page.locator("#context-menu")).toBeVisible();
    await expect(item).toHaveCount(0);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 3: Run and commit**

Run: `npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off` → 6 passed.

```bash
git add scripts/hooks/folder-context.mjs tests/e2e/23-campaign-creation.spec.mjs
git commit -m "feat(campaigns): 'Make this folder a campaign' folder context option"
```

---

### Task 5: The guard — strip Campaign from type pickers, cancel or upgrade strays

**Files:**
- Create: `scripts/hooks/campaign-guard.mjs`
- Modify: `scripts/campaign-companion.mjs` (ready block, after the `MODE_ABSENT` early return ~line 257)
- Test: `tests/e2e/23-campaign-creation.spec.mjs` (append tests 7–9)

**Interfaces:**
- Consumes: `classifyCampaignPageCreate`, `strayCampaignIntent`, `CAMPAIGN_OPTION_VALUES` (Task 1); `campaignOf`, `campaignOfFolder`, `hasPortalMarker`, `isCampaignTypedPage`; `upgradeEntryToCampaign` (Task 2).
- Produces: `registerCampaignGuard()`, `stripCampaignOptions(root)`.

- [ ] **Step 1: Hook module**

Create `scripts/hooks/campaign-guard.mjs`:

```js
// Closing the stray-campaign-page doors (spec 2026-09-06 §3). Registered at
// ready, not init: MEJ builds its New Entry type <select> in a module-level
// renderDialogV2 hook, and ours must run after it. Decisions are pure
// (logic/campaign-guard.mjs); this file only reads Foundry state and writes
// through the store. Imports the store dynamically so a stray create on a
// still-booting client never pulls the store in early.
import { MODULE_ID, I18N, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";
import { classifyCampaignPageCreate, strayCampaignIntent, CAMPAIGN_OPTION_VALUES } from "../logic/campaign-guard.mjs";
import { campaignOf, campaignOfFolder, hasPortalMarker, isCampaignTypedPage } from "../logic/campaigns.mjs";

// MEJ's New Entry picker and Foundry's Create Page picker.
const TYPE_SELECTS = 'select[name="flags.monks-enhanced-journal.pagetype"], select[name="type"]';

/** Remove every Campaign option from the page-type selects under `root`. Idempotent. Exported for tests. */
export function stripCampaignOptions(root) {
  if (!root?.querySelectorAll) return;
  for (const select of root.querySelectorAll(TYPE_SELECTS)) {
    let removedSelected = false;
    for (const opt of [...select.options]) {
      if (!CAMPAIGN_OPTION_VALUES.includes(opt.value)) continue;
      removedSelected ||= opt.selected;
      opt.remove();
    }
    if (removedSelected && select.options.length) select.selectedIndex = 0;
  }
}

function blocked() {
  ui.notifications.warn(game.i18n.localize(`${I18N}.campaign.strayBlocked`));
  return false;
}

/** preCreateJournalEntry: MEJ dialog intent (pagetype flag) or inline campaign pages. */
function onPreCreateEntry(entry, data) {
  const intent = strayCampaignIntent(data);
  if (!intent) return;
  const folder = data.folder ? game.folders.get(data.folder) ?? null : null;
  const verdict = classifyCampaignPageCreate({
    isPortal: false,
    isGM: game.user.isGM,
    entryPageCount: intent.otherPages,
    entryInCampaign: !!campaignOfFolder(folder)
  });
  if (verdict.startsWith("block")) return blocked();
}

/** preCreateJournalEntryPage: a campaign page added to an existing entry. */
function onPreCreatePage(page, data) {
  if (data.type !== CAMPAIGN_DOCUMENT_TYPE) return;
  const entry = page.parent;
  const verdict = classifyCampaignPageCreate({
    isPortal: data.flags?.[MODULE_ID]?.campaignPortal === true,
    isGM: game.user.isGM,
    entryPageCount: entry?.pages?.size ?? 0,
    entryInCampaign: !!campaignOf(entry)
  });
  if (verdict.startsWith("block")) return blocked();
}

/**
 * After creation, on the creating GM's client only: an entry holding exactly
 * one unmarked campaign page and no campaign becomes a campaign. Both create
 * hooks route here; the store re-checks eligibility under its own serial
 * chain, so the second arrival is a no-op.
 */
function maybeUpgrade(entry, userId) {
  if (userId !== game.user.id || !game.user.isGM || !entry?.pages) return;
  const pages = entry.pages.contents;
  if (pages.length !== 1 || !isCampaignTypedPage(pages[0]) || hasPortalMarker(pages[0]) || campaignOf(entry)) return;
  import("../data/campaign-store.mjs")
    .then(({ upgradeEntryToCampaign }) => upgradeEntryToCampaign(entry))
    .then((folder) => {
      if (folder) ui.notifications.info(game.i18n.format(`${I18N}.campaign.strayUpgraded`, { name: folder.name }));
    });
}

export function registerCampaignGuard() {
  Hooks.on("renderDialogV2", (dialog, html) => stripCampaignOptions(html instanceof HTMLElement ? html : html?.[0] ?? dialog?.element ?? null));
  Hooks.on("preCreateJournalEntry", (entry, data) => onPreCreateEntry(entry, data));
  Hooks.on("preCreateJournalEntryPage", (page, data) => onPreCreatePage(page, data));
  Hooks.on("createJournalEntry", (entry, options, userId) => maybeUpgrade(entry, userId));
  Hooks.on("createJournalEntryPage", (page, options, userId) => maybeUpgrade(page?.parent, userId));
}
```

- [ ] **Step 2: Register at ready**

In `scripts/campaign-companion.mjs` add `import { registerCampaignGuard } from "./hooks/campaign-guard.mjs";` beside the other hook imports, and in the `ready` handler immediately after the `if (mode === MODE_ABSENT) return;` line add:

```js
  // Campaign is never offered as a page type, and a campaign page created
  // any other way is refused or upgraded (spec 2026-09-06 §3). Must follow
  // MEJ's own module-level renderDialogV2 hook, hence ready rather than init.
  registerCampaignGuard();
```

- [ ] **Step 3: e2e tests 7–9**

Append inside the `test.describe`:

```js
  test("7. neither MEJ's New Entry dialog nor the core Create Page dialog offers Campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await showSidebar(page);
    await page.locator("#journal .directory-header button.create-entry").click();
    const mejSelect = page.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
    await expect(mejSelect).toBeVisible();
    await expect(mejSelect.locator('option[value="campaign"], option[value="mej-campaign-companion.campaign"]')).toHaveCount(0);
    await expect(mejSelect.locator('option[value="session"]')).toHaveCount(1); // Session stays (api mode)
    await page.keyboard.press("Escape");
    await settle(page, 200);

    const hostId = await page.evaluate(async (n) => (await JournalEntry.create({ name: n, pages: [{ name: "p", type: "text" }] })).id, name("Host"));
    created.journals.push(hostId);
    await page.evaluate((id) => JournalEntryPage.createDialog({}, { parent: game.journal.get(id) }), hostId);
    const coreSelect = page.locator('.application.dialog select[name="type"]').last();
    await expect(coreSelect).toBeVisible();
    await expect(coreSelect.locator('option[value="mej-campaign-companion.campaign"]')).toHaveCount(0);
    await expect(coreSelect.locator('option[value="text"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("8. a loose campaign page created by API is upgraded into a campaign", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Stray");
    const entryId = await page.evaluate(async (n) =>
      (await JournalEntry.create({ name: n, pages: [{ name: n, type: "mej-campaign-companion.campaign" }] })).id, n);
    created.journals.push(entryId);
    await expect(page.locator("#notifications .notification", { hasText: `Created campaign "${n}" from this entry.` })).toBeVisible({ timeout: 15_000 });
    const folderId = await page.evaluate((id) => game.journal.get(id).folder?.id ?? null, entryId);
    expect(folderId).not.toBe(null);
    created.folders.push(folderId);
    const s = await structureOf(page, folderId);
    expect(s.flag).toEqual({ ownershipDefault: "observer" });
    expect(s.portalId).toBe(entryId);
    expect(s.timelineNames).toEqual([`${n} — Timeline`]);
    const pageFlags = await page.evaluate((id) => game.journal.get(id).pages.contents[0].flags, entryId);
    expect(pageFlags["mej-campaign-companion"].campaignPortal).toBe(true);
    expect(pageFlags["monks-enhanced-journal"].type).toBe("campaign");
    assertNoConsoleErrors(errors);
  });

  test("9. a campaign page inside a campaign, into a multipage entry, or via MEJ's dialog intent into a campaign folder is refused", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Refuse");
    const campaignId = await page.evaluate(async ({ STORE, n }) => {
      const { createCampaign } = await import(STORE);
      return (await createCampaign(n)).id;
    }, { STORE, n });
    created.folders.push(campaignId);
    const hostId = await page.evaluate(async (n) => (await JournalEntry.create({ name: `${n} host`, pages: [{ name: "p", type: "text" }] })).id, n);
    created.journals.push(hostId);
    const results = await page.evaluate(async ({ campaignId, hostId, n }) => {
      const T = "mej-campaign-companion.campaign";
      const inCampaign = await JournalEntry.create({ name: `${n} in`, folder: campaignId, pages: [{ name: "c", type: T }] });
      const intent = await JournalEntry.create({ name: `${n} intent`, folder: campaignId, flags: { "monks-enhanced-journal": { pagetype: "campaign" } } });
      const multipage = await JournalEntryPage.create({ name: "c", type: T }, { parent: game.journal.get(hostId) });
      return {
        inCampaign: inCampaign?.id ?? null,
        intent: intent?.id ?? null,
        multipage: multipage?.id ?? null,
        hostPages: game.journal.get(hostId).pages.size,
        warnings: [...document.querySelectorAll("#notifications .notification")].filter((el) => /New Campaign button/.test(el.textContent)).length
      };
    }, { campaignId, hostId, n });
    expect(results.inCampaign).toBe(null);
    expect(results.intent).toBe(null);
    expect(results.multipage).toBe(null);
    expect(results.hostPages).toBe(1);
    expect(results.warnings).toBeGreaterThanOrEqual(1);
    assertNoConsoleErrors(errors);
  });
```

If `JournalEntry.create` resolves to something other than `undefined` when a preCreate hook returns false on this Foundry build, adjust the three `?? null` reads to `?.id ?? null` on whatever it returns — the assertion is that no document with that name exists: add `expect(await page.evaluate((n) => game.journal.contents.filter((e) => e.name.startsWith(n)).length, n)).toBe(1)` (only the host).

- [ ] **Step 4: Run and commit**

Run: `npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off` → 9 passed; `npx playwright test tests/e2e/01-session.spec.mjs tests/e2e/15-campaign-portal.spec.mjs --trace off` → no regressions (Session creation via the dialog and portal creation via `ensureCampaignPortal` must be untouched by the guard).

```bash
git add scripts/hooks/campaign-guard.mjs scripts/campaign-companion.mjs tests/e2e/23-campaign-creation.spec.mjs
git commit -m "feat(campaigns): guard strips Campaign from type pickers and upgrades or refuses stray campaign pages"
```

---

### Task 6: dataVersion 7 — timeline backfill and stray upgrade

**Files:**
- Modify: `scripts/constants.mjs:84` (`CURRENT_DATA_VERSION = 7`)
- Modify: `scripts/campaign-companion.mjs` (imports; migration block, after the v6 fold and before the version stamp ~line 394)
- Modify: `lang/en.json` (new `migration` namespace)
- Test: `tests/e2e/23-campaign-creation.spec.mjs` (append test 10)

**Interfaces:**
- Consumes: `planCampaignStructure` (Task 1), `upgradeEntryToCampaign` (Task 2), `campaignTimelines`, `ensureTimelineJournal` (`data/timeline-journal.mjs`), `campaignOf`, `hasPortalMarker`, `isCampaignTypedPage`.

- [ ] **Step 1: Constant and i18n**

`scripts/constants.mjs`: `export const CURRENT_DATA_VERSION = 7;`

`lang/en.json`, add after the `campaign` object:

```json
  "migration": {
    "campaignStructure": "Campaign structure: {timelines} timeline(s) created, {campaigns} campaign(s) created from loose pages.",
    "campaignStructureSkipped": "{count} campaign page(s) could not be converted — see the console."
  },
```

- [ ] **Step 2: Migration step**

In `scripts/campaign-companion.mjs` extend the imports:

```js
import { getCampaigns, campaignPortal, ensureCampaignPortal, upgradeEntryToCampaign } from "./data/campaign-store.mjs";
import { campaignTimelines, ensureTimelineJournal } from "./data/timeline-journal.mjs";
import { isTimelineJournal, campaignOf, hasPortalMarker, isCampaignTypedPage } from "./logic/campaigns.mjs";
import { planCampaignStructure } from "./logic/campaign-migration.mjs";
```

(merge with the existing `campaign-store` / `campaigns` import lines rather than duplicating them). Insert before `await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);`:

```js
    // v7: every campaign has its timeline, and loose campaign pages become
    // campaigns (spec 2026-09-06 §4). Pure plan; per-step try/catch; strays
    // the plan can't convert are listed, never deleted.
    const structurePlan = planCampaignStructure({
      folders: getCampaigns().map((f) => ({ id: f.id, isCampaign: true, hasTimeline: campaignTimelines(f).length > 0 })),
      entries: game.journal.contents.map((e) => {
        const pages = e.pages?.contents ?? [];
        return {
          id: e.id,
          uuid: e.uuid,
          pageCount: pages.length,
          strayCampaignPage: pages.some((p) => isCampaignTypedPage(p) && !hasPortalMarker(p)),
          inCampaign: !!campaignOf(e)
        };
      })
    });
    let timelinesCreated = 0;
    for (const id of structurePlan.timelineFor) {
      try {
        if (await ensureTimelineJournal(game.folders.get(id))) timelinesCreated += 1;
      } catch (err) {
        console.error(`${MODULE_ID} | timeline backfill failed for folder ${id}`, err);
      }
    }
    let campaignsCreated = 0;
    for (const id of structurePlan.upgrade) {
      try {
        if (await upgradeEntryToCampaign(game.journal.get(id))) campaignsCreated += 1;
      } catch (err) {
        console.error(`${MODULE_ID} | campaign upgrade failed for entry ${id}`, err);
      }
    }
    for (const s of structurePlan.skipped) {
      console.warn(`${MODULE_ID} | campaign page on ${s.uuid} was not converted (${s.reason})`);
    }
    if (timelinesCreated || campaignsCreated) {
      ui.notifications.info(game.i18n.format(`${I18N}.migration.campaignStructure`, { timelines: timelinesCreated, campaigns: campaignsCreated }));
    }
    if (structurePlan.skipped.length) {
      ui.notifications.warn(game.i18n.format(`${I18N}.migration.campaignStructureSkipped`, { count: structurePlan.skipped.length }), { permanent: true });
    }
```

- [ ] **Step 3: e2e test 10**

Append inside the `test.describe`. Strays are seeded with the portal marker (so the Task 5 guard lets them through and doesn't upgrade them) and the marker is then removed by update — updates never trigger the guard:

```js
  test("10. dataVersion 7 backfills a missing timeline, upgrades a loose stray and skips a multipage one", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const n = name("Mig");
    const ids = await page.evaluate(async (n) => {
      const M = "mej-campaign-companion";
      const T = `${M}.campaign`;
      const marked = { [M]: { campaignPortal: true } };
      const bare = await Folder.create({ name: `${n} bare`, type: "JournalEntry", flags: { [M]: { campaign: { ownershipDefault: "observer" } } } });
      const stray = await JournalEntry.create({ name: `${n} stray`, pages: [{ name: "c", type: T, flags: marked }] });
      const multi = await JournalEntry.create({ name: `${n} multi`, pages: [{ name: "t", type: "text" }, { name: "c", type: T, flags: marked }] });
      for (const e of [stray, multi]) {
        const p = e.pages.contents.find((p) => p.type === T);
        await p.update({ [`flags.${M}.-=campaignPortal`]: null });
      }
      return { bare: bare.id, stray: stray.id, multi: multi.id };
    }, n);
    created.folders.push(ids.bare);
    created.journals.push(ids.stray, ids.multi);
    expect(await page.evaluate((id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "campaignPortal") ?? null, ids.stray)).toBe(null);

    await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 6));
    await reloadGame(page);
    await page.waitForFunction((v) => game.settings.get("mej-campaign-companion", "dataVersion") === v, CURRENT_DATA_VERSION, { timeout: 60_000 });

    const after = await page.evaluate(({ ids, n }) => {
      const M = "mej-campaign-companion";
      const bare = game.folders.get(ids.bare);
      const stray = game.journal.get(ids.stray);
      const multi = game.journal.get(ids.multi);
      return {
        bareTimelines: bare.contents.filter((e) => e.getFlag(M, "timeline")).map((e) => e.name),
        strayFolder: stray.folder?.id ?? null,
        strayFolderFlag: stray.folder?.getFlag(M, "campaign") ?? null,
        strayMarked: stray.pages.contents[0].getFlag(M, "campaignPortal") === true,
        strayTimelines: (stray.folder?.contents ?? []).filter((e) => e.getFlag(M, "timeline")).map((e) => e.name),
        multiFolder: multi.folder?.id ?? null,
        multiPages: multi.pages.size
      };
    }, { ids, n });
    if (after.strayFolder) created.folders.push(after.strayFolder);
    expect(after.bareTimelines).toEqual([`${n} bare — Timeline`]);
    expect(after.strayFolderFlag).toEqual({ ownershipDefault: "observer" });
    expect(after.strayMarked).toBe(true);
    expect(after.strayTimelines).toEqual([`${n} stray — Timeline`]);
    expect(after.multiFolder).toBe(null);
    expect(after.multiPages).toBe(2);
    assertNoConsoleErrors(errors);
  });
```

`assertNoConsoleErrors` only fails on `console.error`; the migration's `console.warn` for the multipage stray is expected.

- [ ] **Step 4: Run and commit**

Run: `npm test` → PASS; `npx playwright test tests/e2e/23-campaign-creation.spec.mjs --trace off` → 10 passed; `npx playwright test tests/e2e/19-reveal-migration.spec.mjs tests/e2e/20-timeline-journal-open.spec.mjs --trace off` → pass (both read `CURRENT_DATA_VERSION`).

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs lang/en.json tests/e2e/23-campaign-creation.spec.mjs
git commit -m "feat(campaigns): dataVersion 7 backfills timelines and upgrades loose campaign pages"
```

---

### Task 7: Docs, guide image, version bump

**Files:**
- Modify: `docs/gm-guide.md` ("Campaigns" section ~lines 95-112; timeline paragraph ~line 122; native-mode bullet ~line 306)
- Modify: `README.md` (native-mode line ~70-71; campaign mention in the feature list if any)
- Modify: `docs/player-guide.md` (one line on the flag icon, in whatever section describes the sidebar)
- Modify: `CHANGELOG.md` (new 0.19.0 section at top), `module.json` (`"version": "0.19.0"`)
- Modify: `tests/e2e/guide-screenshots.spec.mjs` (test "capture standalone dialogs and windows")
- Create: `docs/images/campaign-create-button.png` (generated)

- [ ] **Step 1: gm-guide.md**

Replace the first two paragraphs of "## Campaigns" with:

```markdown
A campaign is three things created together: a folder in Foundry's journal sidebar, a **portal entry** named after it, and a **timeline** journal named `<campaign name> — Timeline`. Everything filed into that folder is what the Hub means by "in this campaign". Campaign folders carry a flag icon in the sidebar so they stand out from ordinary folders.

**Creating one.** The journal sidebar's header has a GM-only **New Campaign** button beside **Create Folder** — it works whether or not MEJ's window is open. It asks for two things: a **Name**, and **Player access** with three options — **GM only**, **Players can view** (selected by default), and **Players can edit**. Click **Confirm** and the folder, its portal entry and its timeline appear together; there's no separate step. The same dialog is reachable from the Hub's campaign picker (**➕ New Campaign…**).

![The journal sidebar header with Create Journal Entry, Create Folder and the companion's New Campaign button](images/campaign-create-button.png)

**Already have a folder?** Right-click any plain top-level journal folder and choose **Make this folder a campaign**. The same dialog appears with the folder's name filled in; confirming adds the flag, portal and timeline in place — the entries already in the folder stay exactly where they are. Nested folders can't become campaigns (campaigns never nest).

**Campaign is not a page type.** It never appears in MEJ's New Entry dialog or Foundry's Create Page dialog. If something else — a macro, an import — creates a loose campaign page anyway, the companion turns it into a proper campaign on the spot (folder named after the entry, timeline included, players can view) and says so in a toast; a campaign page that can't be converted cleanly (inside an existing campaign, or added to an entry that already has pages) is refused with a message pointing at the New Campaign button.
```

In the timeline section replace "**Campaign timelines** live inside a campaign's folder: the first time you scope the Hub to a campaign without picking a timeline explicitly, the Hub creates that campaign's timeline on the spot, named `<campaign name> — Timeline`. That first one is the campaign's default," with "**Campaign timelines** live inside a campaign's folder; the one created with the campaign, named `<campaign name> — Timeline`, is its default,". In "Running on stock MEJ (native mode)" replace the first bullet with:

```markdown
- **Session** doesn't appear in MEJ's own "New Entry" dialog — create sessions with the **New Session** button in the Hub's header bar. (**Campaign** is never a page type in either mode; use the sidebar's **New Campaign** button.)
```

Also update the "From the sidebar" paragraph's list to "the context menu ends with **Open Campaign Hub**" for campaign folders and mention "**Make this folder a campaign** on plain top-level folders".

- [ ] **Step 2: README, player guide, CHANGELOG, module.json**

README native-mode line → `Session does not appear in MEJ's own "New Entry" dialog — create sessions with the **New Session** button in the Campaign Hub. Campaigns are created with the **New Campaign** button in the journal sidebar in both modes.` Add to the feature list after the Campaign Hub bullet: `- **Campaigns** — a flagged folder + portal entry + timeline, created together from the journal sidebar's **New Campaign** button (or the Hub), or by promoting an existing top-level folder.`

`docs/player-guide.md`: in the section that first mentions the journal sidebar, add: `Campaign folders show a flag icon in the sidebar; everything inside one belongs to that campaign.`

`CHANGELOG.md`, new top section:

```markdown
## 0.19.0

- **Campaigns are created whole.** `createCampaign()` now makes the folder, the portal entry and the `<name> — Timeline` journal in one go; the Hub no longer creates timelines as a side effect of being opened.
- **New Campaign in the journal sidebar** (GM only, core sidebar and MEJ's shell sidebar) — the first way to create a campaign that doesn't need the Hub open. Campaign folders carry a flag icon.
- **Make this folder a campaign** — right-click a plain top-level journal folder to promote it in place; its entries stay put.
- **Campaign is no longer a page type.** It is stripped from MEJ's New Entry dialog and Foundry's Create Page dialog; a loose campaign page created by any other path is upgraded into a real campaign, or refused with a toast when it can't be.
- **Data migration (dataVersion 7):** every campaign without a timeline gets one; loose single-page campaign entries become campaigns; anything that can't be converted is listed in the console, never deleted.
```

`module.json`: `"version": "0.19.0"`.

- [ ] **Step 3: Guide image**

In `tests/e2e/guide-screenshots.spec.mjs`, inside `test("capture standalone dialogs and windows", …)`, at the very start of its body (before any dialog is opened) add:

```js
    // Sidebar New Campaign button (gm-guide "Campaigns", spec 2026-09-06).
    await page.evaluate(async () => {
      try { await game.MonksEnhancedJournal?.journal?.close?.(); } catch { /* nothing open */ }
      await ui.journal.activate();
    });
    await settle(page, 300);
    await shot(page.locator("#journal .directory-header .header-actions"), "campaign-create-button");
```

(`settle` and `shot` already exist in that file.) Run: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs --grep "standalone dialogs" --trace off` — if the seed test is a prerequisite for that test, run the whole file instead (7 tests, ~10 min; split with `--grep` if the 10-minute shell limit bites). Confirm `docs/images/campaign-create-button.png` shows three buttons.

- [ ] **Step 4: Check and commit**

Run: `npm run check:links` → OK; `npm test` → PASS.

```bash
git add docs/gm-guide.md README.md docs/player-guide.md CHANGELOG.md module.json tests/e2e/guide-screenshots.spec.mjs docs/images/campaign-create-button.png
git commit -m "docs: campaign creation guide, changelog and 0.19.0 version bump"
```

---

### Task 8: Verification gates

**Files:** none modified (log files go to `$CLAUDE_JOB_DIR/tmp`).

- [ ] **Step 1: Unit + docs**

`npm test` → all pass; `npm run check:links` → OK; `npm run check:vendor` → OK.

- [ ] **Step 2: v14 e2e, targeted then full**

Per spec file, each `--trace off`, each under 10 minutes: `23-campaign-creation` (10/10), `14-campaigns`, `15-campaign-portal`, `16-multi-timeline`, `20-timeline-journal-open`, `02-hub-timeline`, `01-session`, `05-docx-import`, `22-auto-link-sessions`. Then the remaining specs. Any failure is A/B'd by running the same spec from the `main` checkout (the harness pins the module symlink to whichever checkout runs it) before being called a regression.

- [ ] **Step 3: v13 stock gate**

`FOUNDRY_TARGET=v13 npx playwright test tests/e2e/13-stock-smoke.spec.mjs --trace off` → 8/8, then `FOUNDRY_TARGET=v13 npx playwright test tests/e2e/23-campaign-creation.spec.mjs --grep "3\\.|5\\.|7\\." --trace off` (sidebar button, player seat, dialog stripping — in native mode test 7's `option[value="session"]` assertion does not hold: guard that line with `if (await page.evaluate(() => game.modules.get("monks-enhanced-journal")?.api))` or split it into its own api-only expectation). Report results in the PR body.

- [ ] **Step 4: Ledger**

Record every ruling and every environmental failure (with its A/B evidence) in the SDD ledger; carry them into the spec's Deviations section in the release commit.

---

## Deviations from the spec (known at planning time)

- Spec §6 said `14-campaigns` test 7 "flips to assert the timeline exists right after creation". That test seeds a raw flagged `Folder.create` (not `createCampaign()`), so eager creation never applies to it and its assertion still holds — it is left unchanged.
- Spec §4's summary toast is shown only when at least one timeline or campaign was created; a world with nothing to do stays silent (the existing migrations' convention).
- Spec §2's button markup is icon + text label, matching the neighbouring Create Entry / Create Folder buttons (spec updated in the same commit as this plan).
