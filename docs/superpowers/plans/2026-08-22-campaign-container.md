# Campaign Container & Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a true campaign container (flagged journal Folders) so membership — not MEJ typing — drives the Hub, timeline, ownership, import, and capture, with multiple campaigns per world.

**Architecture:** A campaign is a Foundry journal `Folder` carrying `flags["mej-campaign-companion"].campaign`; membership is folder ancestry. Pure membership logic lives in `scripts/logic/campaigns.mjs` (vitest-loadable, no Foundry imports — same convention as `logic/hub-index.mjs`); Foundry glue lives in `scripts/data/campaign-store.mjs`. Every consumer (Hub panes, timeline, import, auto-capture, ownership tooling, adoption) resolves scope through that seam.

**Tech Stack:** Foundry VTT v13/v14 module, ES modules, Handlebars templates, vitest (unit, `npm test`), Playwright (e2e, `npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-08-22-campaign-container-design.md`

## Global Constraints

- Pure logic in `scripts/logic/` must not import Foundry-dependent modules (vitest loads it directly; `scripts/constants.mjs` is safe — `test/constants.test.js` already loads it).
- Unit tests: vitest, files in `test/<name>.test.js`, run with `npx vitest run test/<name>.test.js`.
- All user-facing strings go through i18n under the `MEJCampaignCompanion` prefix (`I18N` constant); add keys to `lang/en.json` in the same task that uses them.
- The Hub is a single instance; UI state lives on module-level `HUB_STATE` in `scripts/apps/CampaignHubPage.mjs` (never instance fields).
- `JournalEntry.create({...})` with a plain object returns the document directly, NOT an array (see `data/mej-entry.mjs` comment).
- Ownership writes touch only `ownership.default`; never per-user override keys.
- Commit after every task; message prefix `feat:`/`fix:`/`test:`/`docs:` as appropriate.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/logic/campaigns.mjs` (new) | Pure membership: flag read, ancestry walk, partition, ownership mapping, bulk-plan, adoption plan, attachment guard |
| `scripts/data/campaign-store.mjs` (new) | Foundry glue seam: `getCampaigns`, `createCampaign`, `campaignEntries`, `unfiledEntries`, baseline/bulk apply, hide/reveal |
| `scripts/constants.mjs` | New flag + setting-name constants |
| `scripts/campaign-companion.mjs` | Setting registrations (existing block at :12+) |
| `scripts/data/timeline-journal.mjs` | Per-campaign timeline resolution/creation; legacy singleton retained for pre-adoption worlds |
| `scripts/apps/CampaignHubPage.mjs` | Campaign picker state + scope resolution; all pane contexts scoped; new actions |
| `templates/hub.hbs` | Picker UI, Journal rows/badges, stacked timelines, spillover button, adoption banner |
| `scripts/logic/hub-index.mjs` | `buildIndexSource` includes untyped entries as type `"journal"` |
| `scripts/search/live-index.mjs` | `searchScoped()` wrapper (scope filter + spillover count) |
| `scripts/apps/import-wizard.mjs` + `templates/import-wizard.hbs` | "Import into" destination, subfolder, audience default |
| `scripts/data/mej-entry.mjs` | `createMejEntry` gains `folder` option |
| `scripts/hooks/auto-capture.mjs` | Capture campaign target; decline when unset |
| `lang/en.json` | New strings per task |
| `test/campaigns.test.js` (new) | Unit tests for all pure logic |
| `tests/e2e/14-campaigns.spec.mjs` (new) | E2E for creation, scoping, import, adoption, permissions |

---

### Task 1: Pure campaign membership logic

**Files:**
- Create: `scripts/logic/campaigns.mjs`
- Modify: `scripts/constants.mjs` (append after line 63, the `MEJ_ENCOUNTER_TYPE` block)
- Test: `test/campaigns.test.js`

**Interfaces:**
- Consumes: `MODULE_ID`, `CAMPAIGN_FLAG` from `scripts/constants.mjs`.
- Produces: `campaignFlagOf(folder)`, `isCampaignFolder(folder)`, `campaignOf(doc)` → Folder|null, `campaignIdOf(doc)` → string|null, `isMemberOf(entry, folder)` → boolean, `partitionByCampaign(entries)` → Map, `isTimelineJournal(entry)` → boolean, `ownershipLevelFor(key, levels)` → number, `canAttachToTimeline(entry, timelineJournal)` → boolean. All operate on plain doc-shaped objects (`.flags`, `.folder`, `.documentName`, `.parent`) so vitest needs no Foundry.

- [ ] **Step 1: Add constants**

Append to `scripts/constants.mjs`:

```js
/** Folder flag key: marks a journal Folder as a campaign (spec §1). Flag shape: { ownershipDefault: "none"|"observer"|"owner" }. */
export const CAMPAIGN_FLAG = "campaign";

/** World setting: schema version for future migrations (spec §6). */
export const DATA_VERSION_SETTING = "dataVersion";

/** Current schema version written by the adoption/migration runner. */
export const CURRENT_DATA_VERSION = 1;

/** World setting: Folder id of the campaign that receives auto-captured encounters/media (spec §4). "" = unset → capture declines. */
export const AUTO_CAPTURE_CAMPAIGN_SETTING = "autoCaptureCampaign";

/** Client setting: the Hub's campaign picker choice ("" = All, "unfiled", or a Folder id) (spec §2). */
export const HUB_CAMPAIGN_SCOPE_SETTING = "hubCampaignScope";

/** World setting: the one-time adoption offer has been shown/dismissed (spec §6). */
export const ADOPTION_PROMPTED_SETTING = "adoptionPrompted";
```

- [ ] **Step 2: Write the failing tests**

Create `test/campaigns.test.js`:

```js
import { describe, it, expect } from "vitest";
import { MODULE_ID } from "../scripts/constants.mjs";
import {
  campaignFlagOf, isCampaignFolder, campaignOf, campaignIdOf, isMemberOf,
  partitionByCampaign, isTimelineJournal, ownershipLevelFor, canAttachToTimeline
} from "../scripts/logic/campaigns.mjs";

const LEVELS = { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };

function folder(id, { campaign = null, parent = null } = {}) {
  return { id, folder: parent, flags: campaign ? { [MODULE_ID]: { campaign } } : {} };
}
function entry(id, { folder: f = null, timeline = false } = {}) {
  return {
    id, documentName: "JournalEntry", folder: f,
    flags: timeline ? { [MODULE_ID]: { timeline: { timepoints: [] } } } : {}
  };
}

describe("isCampaignFolder / campaignFlagOf", () => {
  it("detects the campaign flag", () => {
    const c = folder("c1", { campaign: { ownershipDefault: "owner" } });
    expect(isCampaignFolder(c)).toBe(true);
    expect(campaignFlagOf(c)).toEqual({ ownershipDefault: "owner" });
  });
  it("rejects plain folders and null", () => {
    expect(isCampaignFolder(folder("f1"))).toBe(false);
    expect(isCampaignFolder(null)).toBe(false);
    expect(campaignFlagOf(undefined)).toBe(null);
  });
});

describe("campaignOf", () => {
  const camp = folder("c1", { campaign: { ownershipDefault: "observer" } });
  it("resolves direct membership", () => {
    expect(campaignOf(entry("e1", { folder: camp }))).toBe(camp);
  });
  it("resolves through subfolders (ancestry)", () => {
    const sub = folder("s1", { parent: camp });
    expect(campaignOf(entry("e1", { folder: sub }))).toBe(camp);
  });
  it("nearest flagged ancestor wins (defensive nesting rule)", () => {
    const inner = folder("c2", { campaign: { ownershipDefault: "none" }, parent: camp });
    expect(campaignOf(entry("e1", { folder: inner }))).toBe(inner);
  });
  it("returns null for loose entries and null docs", () => {
    expect(campaignOf(entry("e1"))).toBe(null);
    expect(campaignOf(entry("e1", { folder: folder("f1") }))).toBe(null);
    expect(campaignOf(null)).toBe(null);
  });
  it("resolves a page via its parent entry", () => {
    const page = { documentName: "JournalEntryPage", parent: entry("e1", { folder: camp }) };
    expect(campaignOf(page)).toBe(camp);
  });
  it("campaignIdOf/isMemberOf wrap it", () => {
    expect(campaignIdOf(entry("e1", { folder: camp }))).toBe("c1");
    expect(campaignIdOf(entry("e1"))).toBe(null);
    expect(isMemberOf(entry("e1", { folder: camp }), camp)).toBe(true);
    expect(isMemberOf(entry("e1"), camp)).toBe(false);
    expect(isMemberOf(entry("e1", { folder: camp }), null)).toBe(false);
  });
});

describe("partitionByCampaign", () => {
  it("groups by campaign id with null for unfiled", () => {
    const camp = folder("c1", { campaign: {} });
    const a = entry("a", { folder: camp });
    const b = entry("b");
    const byId = partitionByCampaign([a, b]);
    expect(byId.get("c1")).toEqual([a]);
    expect(byId.get(null)).toEqual([b]);
  });
});

describe("isTimelineJournal", () => {
  it("detects the timeline flag", () => {
    expect(isTimelineJournal(entry("t", { timeline: true }))).toBe(true);
    expect(isTimelineJournal(entry("e"))).toBe(false);
    expect(isTimelineJournal(null)).toBe(false);
  });
});

describe("ownershipLevelFor", () => {
  it("maps keys, defaulting unknown to OBSERVER", () => {
    expect(ownershipLevelFor("none", LEVELS)).toBe(0);
    expect(ownershipLevelFor("observer", LEVELS)).toBe(2);
    expect(ownershipLevelFor("owner", LEVELS)).toBe(3);
    expect(ownershipLevelFor("banana", LEVELS)).toBe(2);
    expect(ownershipLevelFor(undefined, LEVELS)).toBe(2);
  });
});

describe("canAttachToTimeline (spec §3 attachment discipline)", () => {
  const camp = folder("c1", { campaign: {} });
  const other = folder("c2", { campaign: {} });
  it("allows same-campaign attachment", () => {
    expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { folder: camp, timeline: true }))).toBe(true);
  });
  it("refuses cross-campaign and unfiled-entry attachment", () => {
    expect(canAttachToTimeline(entry("e", { folder: other }), entry("t", { folder: camp, timeline: true }))).toBe(false);
    expect(canAttachToTimeline(entry("e"), entry("t", { folder: camp, timeline: true }))).toBe(false);
  });
  it("legacy un-campaigned timeline accepts anything (pre-adoption worlds)", () => {
    expect(canAttachToTimeline(entry("e"), entry("t", { timeline: true }))).toBe(true);
    expect(canAttachToTimeline(entry("e", { folder: camp }), entry("t", { timeline: true }))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/campaigns.test.js`
Expected: FAIL — cannot resolve `../scripts/logic/campaigns.mjs`.

- [ ] **Step 4: Implement `scripts/logic/campaigns.mjs`**

```js
// Pure campaign-membership logic (spec §1). No Foundry imports so vitest
// can load it directly - same convention as hub-index.mjs. Operates on
// doc-shaped plain objects: folders have .flags/.folder, entries have
// .documentName/.folder/.flags, pages have .documentName/.parent.
import { MODULE_ID, CAMPAIGN_FLAG } from "../constants.mjs";

/** The campaign flag object ({ ownershipDefault, ... }) or null. */
export function campaignFlagOf(folder) {
  return folder?.flags?.[MODULE_ID]?.[CAMPAIGN_FLAG] ?? null;
}

export function isCampaignFolder(folder) {
  return !!campaignFlagOf(folder);
}

/**
 * The campaign Folder a document belongs to, or null. Accepts a
 * JournalEntry or JournalEntryPage (resolved via .parent). Walks the
 * folder ancestry; nearest flagged ancestor wins - creation UI prevents
 * nesting, this rule is the defensive fallback (spec §1).
 */
export function campaignOf(doc) {
  const entry = doc?.documentName === "JournalEntryPage" ? doc.parent : doc;
  let folder = entry?.folder ?? null;
  while (folder) {
    if (isCampaignFolder(folder)) return folder;
    folder = folder.folder ?? null;
  }
  return null;
}

export function campaignIdOf(doc) {
  return campaignOf(doc)?.id ?? null;
}

export function isMemberOf(entry, campaignFolder) {
  return !!campaignFolder && campaignOf(entry)?.id === campaignFolder.id;
}

/** Split entries into Map<campaignId|null, entry[]>; null key = unfiled. */
export function partitionByCampaign(entries) {
  const byId = new Map();
  for (const e of entries ?? []) {
    const id = campaignIdOf(e);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(e);
  }
  return byId;
}

/** Is this journal a timeline journal (a campaign's, or the legacy singleton)? */
export function isTimelineJournal(entry) {
  return !!entry?.flags?.[MODULE_ID]?.timeline;
}

/** "none"|"observer"|"owner" -> ownership level; `levels` is CONST.DOCUMENT_OWNERSHIP_LEVELS (injected for testability). Unknown -> OBSERVER. */
export function ownershipLevelFor(key, levels) {
  const map = { none: levels.NONE, observer: levels.OBSERVER, owner: levels.OWNER };
  return map[key] ?? levels.OBSERVER;
}

/**
 * Spec §3 attachment discipline: an entry may only attach to timepoints of
 * its own campaign. A timeline journal with no campaign (the pre-adoption
 * legacy singleton) accepts anything.
 */
export function canAttachToTimeline(entry, timelineJournal) {
  const timelineCampaign = campaignIdOf(timelineJournal);
  if (timelineCampaign === null) return true;
  return campaignIdOf(entry) === timelineCampaign;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/campaigns.test.js`
Expected: PASS (all tests). Also run `npx vitest run` — full suite stays green.

- [ ] **Step 6: Commit**

```bash
git add scripts/constants.mjs scripts/logic/campaigns.mjs test/campaigns.test.js
git commit -m "feat: pure campaign membership logic (folder-flag campaigns, ancestry resolution)"
```

---

### Task 2: Campaign store (Foundry glue) + setting registrations

**Files:**
- Create: `scripts/data/campaign-store.mjs`
- Modify: `scripts/campaign-companion.mjs` (settings block starting line 12)
- Test: none new (glue is exercised by e2e Task 12; pure parts already covered)

**Interfaces:**
- Consumes: Task 1's `campaigns.mjs` exports; `isVisibleToUser(entry, user)` from `scripts/logic/hub-index.mjs`.
- Produces: `getCampaigns()` → Folder[] (name-sorted), `createCampaign(name, {ownershipDefault})` → Promise<Folder|null>, `campaignEntries(campaign, {user})` → JournalEntry[], `unfiledEntries({user})` → JournalEntry[], `baselineOwnership(campaign)` → number, `applyBaselineToMembers(campaign)` → Promise<number>, `setEntryHidden(entry, hidden)` → Promise<void>. Settings registered: `DATA_VERSION_SETTING` (world, Number, default 0), `AUTO_CAPTURE_CAMPAIGN_SETTING` (world, String, default ""), `HUB_CAMPAIGN_SCOPE_SETTING` (client, String, default ""), `ADOPTION_PROMPTED_SETTING` (world, Boolean, default false).

- [ ] **Step 1: Implement `scripts/data/campaign-store.mjs`**

```js
// Foundry glue over logic/campaigns.mjs (spec §1): the seam every other
// subsystem consumes for campaign scope. Imports Foundry globals, so it
// is NOT vitest-loadable; keep anything testable in logic/campaigns.mjs.
import { MODULE_ID, CAMPAIGN_FLAG } from "../constants.mjs";
import {
  isCampaignFolder, campaignOf, campaignFlagOf, isTimelineJournal,
  ownershipLevelFor, bulkOwnershipPlan
} from "../logic/campaigns.mjs";
import { isVisibleToUser } from "../logic/hub-index.mjs";

/** Every campaign folder in the world, name-sorted. */
export function getCampaigns() {
  return game.folders
    .filter((f) => f.type === "JournalEntry" && isCampaignFolder(f))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** GM-only. Creates a root-level campaign folder (campaigns never nest - spec §1). */
export async function createCampaign(name, { ownershipDefault = "observer" } = {}) {
  if (!game.user.isGM) return null;
  return Folder.create({
    name,
    type: "JournalEntry",
    folder: null,
    flags: { [MODULE_ID]: { [CAMPAIGN_FLAG]: { ownershipDefault } } }
  });
}

/** Visibility-filtered members of a campaign; the campaign's timeline journal is excluded (spec §1). */
export function campaignEntries(campaign, { user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    campaignOf(e)?.id === campaign.id && !isTimelineJournal(e) && isVisibleToUser(e, user));
}

/** Visibility-filtered entries under no campaign (any type - spec §2 Unfiled scope), timeline journals excluded. */
export function unfiledEntries({ user = game.user } = {}) {
  return game.journal.contents.filter((e) =>
    !campaignOf(e) && !isTimelineJournal(e) && isVisibleToUser(e, user));
}

/** The campaign's ownership baseline as a CONST.DOCUMENT_OWNERSHIP_LEVELS value (spec §5). */
export function baselineOwnership(campaign) {
  const key = campaignFlagOf(campaign)?.ownershipDefault;
  return ownershipLevelFor(key, CONST.DOCUMENT_OWNERSHIP_LEVELS);
}

/** Spec §5 bulk apply: set every member's ownership.default to the baseline. Returns the update count. */
export async function applyBaselineToMembers(campaign) {
  const level = baselineOwnership(campaign);
  const updates = bulkOwnershipPlan(campaignEntries(campaign, { user: game.user }), level);
  if (updates.length) await JournalEntry.updateDocuments(updates);
  return updates.length;
}

/** Spec §5 hide/reveal: hide -> NONE; reveal -> the entry's campaign baseline (OBSERVER when unfiled). */
export async function setEntryHidden(entry, hidden) {
  const level = hidden
    ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    : baselineOwnership(campaignOf(entry));
  await entry.update({ "ownership.default": level });
}
```

- [ ] **Step 2: Add `bulkOwnershipPlan` to `scripts/logic/campaigns.mjs` with a failing-then-passing test**

Append to `test/campaigns.test.js`:

```js
import { bulkOwnershipPlan } from "../scripts/logic/campaigns.mjs";

describe("bulkOwnershipPlan", () => {
  it("plans updates only for entries not already at the level", () => {
    const entries = [
      { id: "a", ownership: { default: 0 } },
      { id: "b", ownership: { default: 2 } },
      { id: "c", ownership: {} },
      { id: "d" }
    ];
    expect(bulkOwnershipPlan(entries, 2)).toEqual([
      { _id: "a", "ownership.default": 2 },
      { _id: "c", "ownership.default": 2 },
      { _id: "d", "ownership.default": 2 }
    ]);
    expect(bulkOwnershipPlan([], 2)).toEqual([]);
  });
});
```

Run `npx vitest run test/campaigns.test.js` → FAIL (no export). Then append to `scripts/logic/campaigns.mjs`:

```js
/**
 * Spec §5 bulk apply plan: JournalEntry.updateDocuments payloads setting
 * every entry's ownership.default to `level`, skipping ones already there.
 * Touches ONLY the default level - per-user overrides are separate keys.
 */
export function bulkOwnershipPlan(entries, level) {
  return (entries ?? [])
    .filter((e) => (e.ownership?.default ?? null) !== level)
    .map((e) => ({ _id: e.id, "ownership.default": level }));
}
```

Run again → PASS.

- [ ] **Step 3: Register the new settings**

In `scripts/campaign-companion.mjs`, extend the constants import at the top of the file with `DATA_VERSION_SETTING, AUTO_CAPTURE_CAMPAIGN_SETTING, HUB_CAMPAIGN_SCOPE_SETTING, ADOPTION_PROMPTED_SETTING`, then append inside the same function that registers `TIMELINE_JOURNAL_SETTING` (line 12), following its style:

```js
  game.settings.register(MODULE_ID, DATA_VERSION_SETTING, {
    scope: "world", config: false, type: Number, default: 0
  });
  game.settings.register(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, {
    scope: "world", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, {
    scope: "client", config: false, type: String, default: ""
  });
  game.settings.register(MODULE_ID, ADOPTION_PROMPTED_SETTING, {
    scope: "world", config: false, type: Boolean, default: false
  });
```

- [ ] **Step 4: Verify**

Run: `npx vitest run` → full suite green. Foundry-side smoke happens in Task 12's e2e.

- [ ] **Step 5: Commit**

```bash
git add scripts/data/campaign-store.mjs scripts/logic/campaigns.mjs scripts/campaign-companion.mjs test/campaigns.test.js
git commit -m "feat: campaign store seam (glue) + campaign settings registration"
```

---

### Task 3: Per-campaign timeline resolution

**Files:**
- Modify: `scripts/data/timeline-journal.mjs` (whole file, currently 21 lines)
- Test: none new (resolution is a thin Foundry query; covered by e2e Task 12; `canAttachToTimeline` already unit-tested in Task 1)

**Interfaces:**
- Consumes: `campaignIdOf`, `isTimelineJournal` from Task 1.
- Produces: `getTimelineJournal()` (legacy singleton, unchanged), `campaignTimelineJournal(campaign)` → JournalEntry|null, `resolveTimelineJournal(campaign)` → JournalEntry|null (null campaign → legacy), `ensureTimelineJournal(campaign = null)` → Promise<JournalEntry|null>. **Breaking change note for later tasks:** existing callers (`CampaignHubPage.mjs:181`, `import-wizard.mjs:485`, `auto-capture.mjs`) call `ensureTimelineJournal()` with no argument — that still works (legacy singleton) until Tasks 5/8/9 update them to pass a campaign.

- [ ] **Step 1: Rewrite `scripts/data/timeline-journal.mjs`**

```js
import { MODULE_ID, TIMELINE_JOURNAL_SETTING } from "../constants.mjs";
import { isTimelineJournal } from "../logic/campaigns.mjs";

/** The legacy world-singleton timeline JournalEntry, or null. Retained for pre-adoption worlds; adoption (spec §6) moves it into a campaign and clears the setting. */
export function getTimelineJournal() {
  const id = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING);
  return id ? game.journal.get(id) ?? null : null;
}

/** The campaign's timeline journal: a directly-contained member entry flagged `timeline` (spec §3). */
export function campaignTimelineJournal(campaign) {
  return campaign.contents.find((e) => isTimelineJournal(e)) ?? null;
}

/** Resolve the timeline for a scope; null campaign -> legacy singleton. */
export function resolveTimelineJournal(campaign = null) {
  return campaign ? campaignTimelineJournal(campaign) : getTimelineJournal();
}

/** Find or create the scope's timeline journal. Creation requires GM privileges. */
export async function ensureTimelineJournal(campaign = null) {
  let journal = resolveTimelineJournal(campaign);
  if (journal) return journal;
  if (!game.user.isGM) return null;
  journal = await JournalEntry.create({
    name: campaign ? `${campaign.name} — Timeline` : "Campaign Timeline",
    ...(campaign ? { folder: campaign.id } : {}),
    flags: { [MODULE_ID]: { timeline: { timepoints: [] } } },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
  if (!campaign) await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, journal.id);
  return journal;
}
```

- [ ] **Step 2: Verify existing callers still compile/behave**

Run: `grep -rn "ensureTimelineJournal\|getTimelineJournal" scripts/` — every existing call site passes no argument, which now means "legacy singleton", identical to today. Run `npx vitest run` → green (this module isn't unit-imported).

- [ ] **Step 3: Commit**

```bash
git add scripts/data/timeline-journal.mjs
git commit -m "feat: per-campaign timeline resolution with legacy-singleton fallback"
```

---

### Task 4: Hub campaign picker + scoped Index pane

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (HUB_STATE :54-67, actions :75-99, `_prepareBodyContext` :172-194, `#indexContext` :205-220, listeners in `activateListeners` around :891-964)
- Modify: `scripts/logic/hub-index.mjs:21-30` (`buildIndexSource`)
- Modify: `templates/hub.hbs` (index controls block, lines 8-60)
- Modify: `lang/en.json`
- Test: `test/hub-index.test.js` (extend), `test/campaigns.test.js` (no change)

**Interfaces:**
- Consumes: `getCampaigns`, `campaignEntries`, `unfiledEntries` from `campaign-store.mjs`; `campaignOf`, `isCampaignFolder` from `logic/campaigns.mjs`; `HUB_CAMPAIGN_SCOPE_SETTING`.
- Produces: `HUB_STATE.campaignId` (`""` = All, `"unfiled"`, or Folder id); instance helpers `#scope()` → `{campaign: Folder|null, unfiled: boolean}` and `#scopedEntries()` → JournalEntry[] — **Tasks 5, 6, 7, 8 all consume these two helpers**; `buildIndexSource` now emits untyped entries as `type: "journal"`.

- [ ] **Step 1: Extend `buildIndexSource` with a failing test first**

Append to `test/hub-index.test.js`:

```js
describe("buildIndexSource untyped rows (spec §2)", () => {
  it("includes untyped entries as type 'journal' with a book icon", () => {
    const entries = [
      { uuid: "e1", name: "Typed", testUserPermission: () => true },
      { uuid: "e2", name: "Plain prose", testUserPermission: () => true }
    ];
    const user = { isGM: true };
    const getMEJType = (e) => (e.uuid === "e1" ? "person" : false);
    const rows = buildIndexSource(entries, user, getMEJType, () => "fas fa-user");
    expect(rows).toEqual([
      { uuid: "e1", name: "Typed", type: "person", icon: "fas fa-user" },
      { uuid: "e2", name: "Plain prose", type: "journal", icon: "fas fa-book" }
    ]);
  });
});
```

Run: `npx vitest run test/hub-index.test.js` → FAIL (untyped entry currently skipped). Then change `buildIndexSource` in `scripts/logic/hub-index.mjs` (replace the `if (!type) continue;` skip):

```js
export function buildIndexSource(entries, user, getMEJType, getIcon) {
  const rows = [];
  for (const entry of entries ?? []) {
    if (!isVisibleToUser(entry, user)) continue;
    // Spec §2: membership, not typing - untyped members list as "journal".
    const type = getMEJType(entry) || "journal";
    rows.push({
      uuid: entry.uuid, name: entry.name, type,
      icon: type === "journal" ? "fas fa-book" : getIcon(type)
    });
  }
  return rows;
}
```

Run again → PASS. Update the JSDoc comment above it (it says "every MEJ-typed journal entry").

- [ ] **Step 2: Add scope state + helpers to `CampaignHubPage.mjs`**

Add `campaignId: null` to `HUB_STATE` (after `secretsPlayer: ""`). Add imports at top: `getCampaigns, campaignEntries, unfiledEntries` from `../data/campaign-store.mjs`; `campaignOf, isCampaignFolder` from `../logic/campaigns.mjs`; add `HUB_CAMPAIGN_SCOPE_SETTING` to the constants import. Add instance methods (near `#typeLabel`):

```js
  /** Resolve HUB_STATE.campaignId to a scope. Lazily seeded from the client setting; stale folder ids reset to All. */
  #scope() {
    if (this.state.campaignId === null) {
      this.state.campaignId = game.settings.get(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING);
    }
    const id = this.state.campaignId;
    if (id === "unfiled") return { campaign: null, unfiled: true };
    const folder = id ? game.folders.get(id) : null;
    if (id && (!folder || !isCampaignFolder(folder))) {
      this.state.campaignId = "";
      return { campaign: null, unfiled: false };
    }
    return { campaign: folder ?? null, unfiled: false };
  }

  /** Spec §2: the entries the current scope covers. Zero-campaign worlds see everything (pre-adoption behavior). */
  #scopedEntries() {
    const { campaign, unfiled } = this.#scope();
    if (unfiled) return unfiledEntries({ user: game.user });
    if (campaign) return campaignEntries(campaign, { user: game.user });
    const campaigns = getCampaigns();
    if (!campaigns.length) return unfiledEntries({ user: game.user });
    return campaigns.flatMap((c) => campaignEntries(c, { user: game.user }));
  }

  #campaignScopeContext() {
    const campaigns = getCampaigns();
    const current = this.state.campaignId ?? "";
    const options = [
      { value: "", label: game.i18n.localize(`${I18N}.hub.scope.all`), selected: current === "" },
      ...campaigns.map((c) => ({ value: c.id, label: c.name, selected: current === c.id }))
    ];
    if (unfiledEntries({ user: game.user }).length) {
      options.push({ value: "unfiled", label: game.i18n.localize(`${I18N}.hub.scope.unfiled`), selected: current === "unfiled" });
    }
    return { hasCampaigns: campaigns.length > 0, options };
  }
```

- [ ] **Step 3: Scope `#indexContext` and label "journal" rows**

In `#indexContext()` replace `game.journal.contents` with the scoped set and add campaign badges (All mode only):

```js
  #indexContext() {
    const { campaign, unfiled } = this.#scope();
    const entries = this.#scopedEntries();
    const source = buildIndexSource(entries, game.user, mejType, this.#typeIcon.bind(this));
    const rows = filterIndexRows(source, this.state, this.#typeLabel.bind(this));
    const mentionCounts = mentionBadgeCounts();
    const badge = !campaign && !unfiled;
    const campaignNames = badge ? new Map(entries.map((e) => [e.uuid, campaignOf(e)?.name ?? null])) : null;
    for (const row of rows) {
      row.mentions = mentionCounts.get(row.uuid) ?? 0;
      if (badge) row.campaign = campaignNames.get(row.uuid);
    }
    // ... rest unchanged (allTypes, return object), but add to the returned object:
    //   campaignScope: this.#campaignScopeContext(),
    //   isUnfiledScope: unfiled
  }
```

In `#typeLabel(type)` add a first line: `if (type === "journal") return game.i18n.localize(`${I18N}.hub.journalType`);`

- [ ] **Step 4: Picker + New Campaign in the template and listeners**

In `templates/hub.hbs`, insert at line 8 (top of `.mej-cc-index-controls`, before the doctype filter):

```hbs
<select name="campaign-scope" class="mej-cc-campaign-scope" aria-label="{{localize 'MEJCampaignCompanion.hub.scope.label'}}">
    {{#each index.campaignScope.options}}
    <option value="{{this.value}}" {{#if this.selected}}selected{{/if}}>{{this.label}}</option>
    {{/each}}
</select>
{{#if isGM}}
<button type="button" class="mej-cc-new-campaign" data-action="newCampaign"
        data-tooltip="{{localize 'MEJCampaignCompanion.hub.newCampaign'}}">
    <i class="fa-solid fa-folder-plus"></i>
</button>
{{/if}}
```

In the index row markup (the `<li class="mej-cc-index-row">` block further down in `hub.hbs` — locate with `grep -n "mej-cc-index-row" templates/hub.hbs`), add after the type label span:

```hbs
{{#if this.campaign}}<span class="mej-cc-row-campaign">{{this.campaign}}</span>{{/if}}
```

In `activateListeners` (next to the `index-filter` listener at ~:915) add:

```js
    const scopeSelect = this.element.querySelector('select[name="campaign-scope"]');
    scopeSelect?.addEventListener("change", async (event) => {
      this.state.campaignId = event.target.value;
      await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, event.target.value);
      this.render({ parts: ["main"] });
    });
```

Register the action `newCampaign: CampaignHubPage.onNewCampaign` in `DEFAULT_OPTIONS.actions` and implement (near `onNewSession`, :596):

```js
  static async onNewCampaign() {
    const esc = foundry.utils.escapeHTML;
    const baselineOptions = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
        <input type="text" name="name" value="" autofocus></div>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${baselineOptions}</select></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.hub.newCampaign`) },
      content,
      ok: {
        callback: (event, button) => ({
          name: button.form.elements.name.value.trim(),
          baseline: button.form.elements.baseline.value
        })
      },
      rejectClose: false
    });
    if (!result?.name) return;
    const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
    if (campaign) {
      this.state.campaignId = campaign.id;
      await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, campaign.id);
      this.render({ parts: ["main"] });
    }
  }
```

Add `createCampaign` to the `campaign-store.mjs` import.

- [ ] **Step 5: i18n strings**

Add to `lang/en.json` under the existing `hub` object:

```json
"scope": { "label": "Campaign", "all": "All campaigns", "unfiled": "Unfiled" },
"newCampaign": "New Campaign",
"newCampaignName": "Name",
"newCampaignBaseline": "Player access",
"baseline": { "none": "GM only", "observer": "Players can view", "owner": "Players can edit" },
"journalType": "Journal"
```

- [ ] **Step 6: Verify**

Run: `npx vitest run` → green. Launch the test world (`npm run test:e2e` env or the module's usual harness) is deferred to Task 12; for now assert no import cycles: `node --input-type=module -e "import('./scripts/logic/campaigns.mjs').then(() => console.log('ok'))"`.

- [ ] **Step 7: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs scripts/logic/hub-index.mjs templates/hub.hbs lang/en.json test/hub-index.test.js
git commit -m "feat: Hub campaign picker, scoped index with journal rows and campaign badges"
```

---

### Task 5: Scoped search, dashboards, and secrets + spillover affordance

**Files:**
- Modify: `scripts/search/live-index.mjs` (add `searchScoped` near `searchAll`, :175-182)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`#searchContext` :232-245, `#dashboardsContext`, `#secretsContext`, actions)
- Modify: `templates/hub.hbs` (search tab, lines 137-163)
- Modify: `lang/en.json`
- Test: e2e in Task 12 (`searchScoped` is Foundry-bound via entry resolution; its pure parts are Task 1's `campaignIdOf`)

**Interfaces:**
- Consumes: `#scope()` from Task 4; `campaignIdOf` from Task 1; existing `searchAll(query)`.
- Produces: `searchScoped(query, scopeId)` → `{hits, spillover}` where `scopeId` is `""|null` (no filter), `"unfiled"`, or a Folder id; Hub action `searchAllCampaigns`.

- [ ] **Step 1: Add `searchScoped` to `scripts/search/live-index.mjs`**

Directly below `searchAll` (which already resolves each hit's entry for its OBSERVER permission filter — reuse the same resolution helper it uses):

```js
/**
 * Spec §2: scope-filtered search with a spillover count for the
 * "N more matches in other campaigns" affordance. scopeId: ""/null = no
 * filter (All), "unfiled" = entries in no campaign, else a campaign
 * Folder id. Permission filtering is searchAll's, unchanged.
 */
export function searchScoped(query, scopeId) {
  const hits = searchAll(query);
  if (!scopeId) return { hits, spillover: 0 };
  const inScope = hits.filter((hit) => {
    const entry = fromUuidSync(hit.uuid);
    const cid = campaignIdOf(entry);
    return scopeId === "unfiled" ? cid === null : cid === scopeId;
  });
  return { hits: inScope, spillover: hits.length - inScope.length };
}
```

Add `import { campaignIdOf } from "../logic/campaigns.mjs";` to the imports. If `live-index.mjs` does not already use `fromUuidSync`, resolve entries the same way `searchAll`'s permission filter does (check its implementation at :175-182 and mirror it).

- [ ] **Step 2: Use it in `#searchContext` and add the spillover button**

In `CampaignHubPage.mjs`, change `#searchContext()`'s first line from `searchAll(this.state.searchQuery)` to:

```js
    const scopeId = this.state.campaignId || null;
    const { hits, spillover } = searchScoped(this.state.searchQuery, scopeId);
    const results = hits.map((hit) => ({ /* unchanged mapping */ }));
```

and add `spillover` to the returned object. Update the import from `../search/live-index.mjs` to include `searchScoped`.

In `templates/hub.hbs` search tab (after the results list, near the `noResults`/`typeToSearch` empty states around line 160):

```hbs
{{#if search.spillover}}
<button type="button" class="mej-cc-search-spillover" data-action="searchAllCampaigns">
    {{localize "MEJCampaignCompanion.hub.search.spillover" count=search.spillover}}
</button>
{{/if}}
```

Register and implement the action:

```js
  static async onSearchAllCampaigns() {
    this.state.campaignId = "";
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, "");
    this.render({ parts: ["main"] });
  }
```

- [ ] **Step 3: Scope dashboards and secrets**

- `#dashboardsContext(isGM)`: its rows come from `runQueryAll(q.query)` per saved query. Post-filter each query's results with the same scope rule — add a small private helper and apply it:

```js
  #scopeFilterRows(rows) {
    const id = this.state.campaignId;
    if (!id) return rows;
    return rows.filter((r) => {
      const entry = fromUuidSync(r.uuid);
      const cid = campaignIdOf(entry);
      return id === "unfiled" ? cid === null : cid === id;
    });
  }
```

- `#secretsContext()`: it scans `game.journal` (around line 324). Replace that source with `this.#scopedEntries()` so the secrets tracker only shows the scoped campaign's entries.

Add `campaignIdOf` to the `logic/campaigns.mjs` import in `CampaignHubPage.mjs`.

- [ ] **Step 4: i18n**

Add under `hub.search` in `lang/en.json`:

```json
"spillover": "{count} more matches in other campaigns — search all"
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run` → green (no unit surface changed).

```bash
git add scripts/search/live-index.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git commit -m "feat: scope search/dashboards/secrets to the Hub campaign picker with spillover count"
```

---

### Task 6: Timeline pane — per-campaign stacks + attachment discipline

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (`_prepareBodyContext` :172-194, `#timelineContext` :247+, timepoint actions `onAddTimepoint`/`onRenameTimepoint`/`onDeleteTimepoint`/link handlers, and the drag-drop handler — locate with `grep -n "_onDrop\|addLink\|addTimepoint" scripts/apps/CampaignHubPage.mjs`)
- Modify: `templates/hub.hbs` (timeline tab, line 82 onward)
- Modify: `lang/en.json`
- Test: attachment guard unit-covered in Task 1; pane behavior in Task 12 e2e

**Interfaces:**
- Consumes: `resolveTimelineJournal(campaign)`, `ensureTimelineJournal(campaign)` from Task 3; `#scope()` from Task 4; `canAttachToTimeline(entry, timelineJournal)` from Task 1.
- Produces: `context.timeline = { stacks: [{ name: string|null, journalId: string|null, ...paneFields }] }`; each stack wrapper carries `data-journal-id` that all timepoint actions resolve against.

- [ ] **Step 1: Build stacks in `_prepareBodyContext`**

Replace the singleton block (lines 177-184) with:

```js
    const { campaign, unfiled } = this.#scope();
    let stacks;
    if (unfiled) {
      stacks = [];
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
        // Spec §2: All mode stacks per-campaign timelines, never interleaved.
        // No lazy creation here - creating N journals on a render would be a
        // side-effect storm; a campaign's timeline is created when scoped to it.
        stacks = campaigns.map((c) => ({ name: c.name, ...this.#timelineContext(resolveTimelineJournal(c), isGM) }));
        const legacy = getTimelineJournal();
        if (legacy && !campaignOf(legacy)) {
          stacks.push({ name: game.i18n.localize(`${I18N}.hub.scope.unfiled`), ...this.#timelineContext(legacy, isGM) });
        }
      }
    }
    context.timeline = { stacks };
```

Update `#timelineContext(journal, isGM)` to include `journalId: journal?.id ?? null` in both its return branches.

- [ ] **Step 2: Template stacks**

In `templates/hub.hbs`, inside the timeline tab (line 82) `.tab-inner`, wrap the existing timeline body in:

```hbs
{{#each timeline.stacks}}
<div class="mej-cc-timeline-stack" data-journal-id="{{this.journalId}}">
    {{#if this.name}}<h3 class="mej-cc-timeline-campaign">{{this.name}}</h3>{{/if}}
    <!-- existing timeline markup, with every `timeline.` reference changed to `this.` -->
</div>
{{/each}}
{{#unless timeline.stacks.length}}
<p class="mej-cc-timeline-empty">{{localize "MEJCampaignCompanion.hub.timelineEmptyScope"}}</p>
{{/unless}}
```

- [ ] **Step 3: Resolve the journal per action + attachment guard**

Every timepoint action currently resolves the singleton (`getTimelineJournal()`/`ensureTimelineJournal()`). Change each to resolve from the DOM:

```js
    const journalId = target.closest("[data-journal-id]")?.dataset.journalId;
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return;
```

In the drop handler that links an entry onto a timepoint (the `Timepoints.addLink` call site), insert before linking:

```js
    if (!canAttachToTimeline(entry, journal)) {
      return ui.notifications.warn(game.i18n.localize(`${I18N}.hub.wrongCampaign`));
    }
```

Add `canAttachToTimeline` and `campaignOf` to the `logic/campaigns.mjs` import; `resolveTimelineJournal` to the timeline-journal import.

- [ ] **Step 4: i18n**

```json
"wrongCampaign": "Entries can only attach to timepoints in their own campaign.",
"timelineEmptyScope": "No timeline in this scope."
```

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run` → green.

```bash
git add scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git commit -m "feat: per-campaign timeline stacks with cross-campaign attachment guard"
```

---

### Task 7: Ownership tooling — campaign settings, bulk apply, hide/reveal

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs` (actions, `#indexContext`, `#campaignScopeContext` area)
- Modify: `templates/hub.hbs` (index controls + index row)
- Modify: `lang/en.json`
- Test: `bulkOwnershipPlan` already unit-tested (Task 2); dialog/actions covered by Task 12 e2e

**Interfaces:**
- Consumes: `baselineOwnership`, `applyBaselineToMembers`, `setEntryHidden` from `campaign-store.mjs`; `campaignFlagOf` from `logic/campaigns.mjs`; `CAMPAIGN_FLAG`, `MODULE_ID`.
- Produces: Hub actions `editCampaign`, `toggleEntryHidden`; index rows gain `hidden: boolean`.

- [ ] **Step 1: Campaign settings dialog (action `editCampaign`)**

Add a gear button in `templates/hub.hbs` right after the campaign picker `<select>` (Task 4's block), GM-only and only when scoped to a campaign:

```hbs
{{#if index.campaignScope.isCampaignScope}}{{#if isGM}}
<button type="button" class="mej-cc-edit-campaign" data-action="editCampaign"
        data-tooltip="{{localize 'MEJCampaignCompanion.hub.editCampaign'}}">
    <i class="fa-solid fa-gear"></i>
</button>
{{/if}}{{/if}}
```

In `#campaignScopeContext()` add `isCampaignScope: !!current && current !== "unfiled"` to the returned object. Register `editCampaign: CampaignHubPage.onEditCampaign` and implement:

```js
  static async onEditCampaign() {
    const { campaign } = this.#scope();
    if (!campaign || !game.user.isGM) return;
    const esc = foundry.utils.escapeHTML;
    const currentKey = campaignFlagOf(campaign)?.ownershipDefault ?? "observer";
    const options = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === currentKey ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${options}</select></div>
      <div class="form-group"><label><input type="checkbox" name="applyNow" checked>
        ${esc(game.i18n.localize(`${I18N}.hub.applyBaselineNow`))}</label></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: campaign.name },
      content,
      ok: { callback: (event, button) => ({
        baseline: button.form.elements.baseline.value,
        applyNow: button.form.elements.applyNow.checked
      }) },
      rejectClose: false
    });
    if (!result) return;
    await campaign.setFlag(MODULE_ID, CAMPAIGN_FLAG, { ownershipDefault: result.baseline });
    if (result.applyNow) {
      const n = await applyBaselineToMembers(campaign);
      ui.notifications.info(game.i18n.format(`${I18N}.hub.baselineApplied`, { count: n }));
    }
    this.render({ parts: ["main"] });
  }
```

(Renaming a campaign is renaming the folder — Foundry's native folder UI covers it; no dialog field for it.)

- [ ] **Step 2: Hide/reveal toggle on index rows**

In `#indexContext()`, after building `rows`, mark hidden state (reuse the `entries` array already in scope):

```js
    const byUuid = new Map(entries.map((e) => [e.uuid, e]));
    for (const row of rows) {
      row.hidden = (byUuid.get(row.uuid)?.ownership?.default ?? null) === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    }
```

In the index-row markup in `templates/hub.hbs` (same `<li class="mej-cc-index-row">` block as Task 4's badge), add a GM-only eye toggle:

```hbs
{{#if @root.isGM}}
<button type="button" class="mej-cc-row-hide" data-action="toggleEntryHidden"
        data-tooltip="{{localize (concat 'MEJCampaignCompanion.hub.' (ternary this.hidden 'reveal' 'hide'))}}">
    <i class="fa-solid {{#if this.hidden}}fa-eye-slash{{else}}fa-eye{{/if}}"></i>
</button>
{{/if}}
```

If the repo's Handlebars helpers don't include `ternary`/`concat` (check with `grep -rn "registerHelper" scripts/`), use two `{{#if this.hidden}}` branches for the tooltip instead. Register and implement the action:

```js
  static async onToggleEntryHidden(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    if (!entry) return;
    const isHidden = (entry.ownership?.default ?? null) === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    await setEntryHidden(entry, !isHidden);
    this.render({ parts: ["main"] });
  }
```

(The index row `<li>` already carries `data-uuid` for `openIndexRow` — verify with `grep -n "data-uuid" templates/hub.hbs`.)

- [ ] **Step 3: i18n**

```json
"editCampaign": "Campaign settings",
"applyBaselineNow": "Apply to all current members now",
"baselineApplied": "Updated default permissions on {count} entries.",
"hide": "Hide from players",
"reveal": "Reveal to players"
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run` → green.

```bash
git add scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git commit -m "feat: campaign ownership baseline dialog, bulk apply, hide/reveal toggle"
```

---

### Task 8: Creation paths — folder + baseline stamping

**Files:**
- Modify: `scripts/data/mej-entry.mjs` (`createMejEntry`, around line 48)
- Modify: `scripts/apps/CampaignHubPage.mjs` (`onNewSession` at :596)
- Modify: `lang/en.json`
- Test: Task 12 e2e (creation into campaign; ownership stamped)

**Interfaces:**
- Consumes: `#scope()`, `getCampaigns()`, `baselineOwnership()`.
- Produces: `createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null, folder = null)` — new trailing `folder` param (a Folder id string). Shared helper `promptCampaignChoice()` on `CampaignHubPage` — **Task 10 reuses it**.

- [ ] **Step 1: Add `folder` to `createMejEntry`**

In `scripts/data/mej-entry.mjs`, extend the signature and the create payload (JSDoc too):

```js
export async function createMejEntry(type, name, htmlContent, extraFlags = {}, ownership = null, folder = null) {
  const entry = await JournalEntry.create({
    name,
    ...(folder ? { folder } : {}),
    ...(ownership ? { ownership } : {}),
    pages: [{ /* unchanged */ }]
  });
  return entry.pages.contents[0];
}
```

All existing callers pass fewer arguments and are unaffected.

- [ ] **Step 2: Shared campaign-choice prompt**

Add to `CampaignHubPage.mjs` (near `onNewCampaign`):

```js
  /** GM picks a campaign (used when the scope doesn't already imply one). Returns Folder|null; null = user cancelled or zero campaigns exist. */
  static async promptCampaignChoice(title) {
    const campaigns = getCampaigns();
    if (!campaigns.length) return null;
    if (campaigns.length === 1) return campaigns[0];
    const esc = foundry.utils.escapeHTML;
    const options = campaigns.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title },
      content: `<div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.scope.label`))}</label><select name="campaign">${options}</select></div>`,
      ok: { callback: (event, button) => button.form.elements.campaign.value },
      rejectClose: false
    });
    return result ? game.folders.get(result) ?? null : null;
  }
```

- [ ] **Step 3: Route `onNewSession` through the scope**

At the top of `onNewSession` (:596), resolve the destination, then thread it into the session `JournalEntry.create` call inside (add `folder` and `ownership` keys to its data object the same way `createMejEntry` does):

```js
    const { campaign: scoped } = this.#scope();
    const campaign = scoped ?? await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.newSession`));
    // Zero-campaign world: campaign stays null -> legacy loose creation, unchanged.
    const destination = campaign
      ? { folder: campaign.id, ownership: { default: baselineOwnership(campaign) } }
      : {};
```

Merge `...destination` into the create data. Note: `playersWriteSessions` still escalates via the existing `preCreateJournalEntry` hook — do not remove the ownership key here; the hook only upgrades.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run` → green.

```bash
git add scripts/data/mej-entry.mjs scripts/apps/CampaignHubPage.mjs lang/en.json
git commit -m "feat: Hub creations land in the scoped campaign with baseline ownership"
```

---

### Task 9: Import wizard — destination, subfolder, audience default

**Files:**
- Modify: `templates/import-wizard.hbs` (audience block at lines 18-24)
- Modify: `scripts/apps/import-wizard.mjs` (`#formAudience` :212-216, `#linkCandidates` :224+, `#onCreate` :400-511, `#createPage` — locate with `grep -n "#createPage" scripts/apps/import-wizard.mjs`)
- Modify: `lang/en.json`
- Test: Task 12 e2e (import into campaign + subfolder + timeline)

**Interfaces:**
- Consumes: `getCampaigns`, `createCampaign`, `baselineOwnership` from `campaign-store.mjs`; `ensureTimelineJournal(campaign)` from Task 3.
- Produces: review form fields `destination` (Folder id or `"__new"`) and `subfolder` (checkbox); `#formAudience()` now returns `"default" | "gm" | "players"`.

- [ ] **Step 1: Template — destination + subfolder + audience default**

In `templates/import-wizard.hbs`, insert BEFORE the audience form-group (line 18):

```hbs
<div class="form-group mej-cc-import-destination">
  <label>{{localize "MEJCampaignCompanion.import.destination"}}</label>
  <select name="destination">
    {{#each campaigns}}<option value="{{this.id}}">{{this.name}}</option>{{/each}}
    <option value="__new">{{localize "MEJCampaignCompanion.import.destinationNew"}}</option>
  </select>
</div>
<div class="form-group mej-cc-import-subfolder">
  <label><input type="checkbox" name="subfolder" checked>
    {{localize "MEJCampaignCompanion.import.subfolder"}}</label>
</div>
```

And add a first option to the audience `<select>` (before the `gm` option):

```hbs
<option value="default" selected>{{localize "MEJCampaignCompanion.import.audienceDefault"}}</option>
```

Supply `campaigns: getCampaigns().map((c) => ({ id: c.id, name: c.name }))` from the wizard's review-step context method (locate where the review template's context is prepared: `grep -n "import-wizard.hbs\|_prepareContext\|review" scripts/apps/import-wizard.mjs`).

- [ ] **Step 2: Form readers**

Replace `#formAudience` and add `#formDestination`:

```js
  /** "default" (campaign baseline) | "gm" | "players". */
  #formAudience() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    const v = form?.elements.audience?.value;
    return v === "players" || v === "gm" ? v : "default";
  }

  /** { campaignId: string|"__new", subfolder: boolean } */
  #formDestination() {
    const form = this.element.querySelector("form.mej-cc-import-review");
    return {
      campaignId: form?.elements.destination?.value ?? "__new",
      subfolder: form?.elements.subfolder?.checked !== false
    };
  }
```

- [ ] **Step 3: Wire `#onCreate`**

At the top of `#onCreate` (after the plan is built, before the audience/ownership block at :413), resolve the destination:

```js
    const dest = this.#formDestination();
    let campaign = dest.campaignId !== "__new" ? game.folders.get(dest.campaignId) ?? null : null;
    if (!campaign) {
      campaign = await createCampaign(this.state.docTitle || game.i18n.localize(`${I18N}.import.title`));
    }
    let targetFolderId = campaign?.id ?? null;
    if (campaign && dest.subfolder) {
      const sub = await Folder.create({ name: this.state.docTitle || campaign.name, type: "JournalEntry", folder: campaign.id });
      targetFolderId = sub.id;
    }
```

Replace the ownership resolution (:413-416) with:

```js
    const audience = this.#formAudience();
    const ownership =
      audience === "players" ? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
      : audience === "default" && campaign ? { default: baselineOwnership(campaign) }
      : null;  // "gm", or "default" with no campaign -> Foundry default (GM-only)
```

For the auto-link containment audience (the `#linkCandidates(audience, ...)` call at :434), map the new value — insert before it:

```js
    const linkAudience = audience === "default"
      ? (campaign && baselineOwnership(campaign) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER ? "players" : "gm")
      : audience;
```

and pass `linkAudience` instead of `audience` (both the :434 call and the session-row special case at :442 keep their existing logic).

Change the timeline line (:485) to `timeline ??= await ensureTimelineJournal(campaign);` and thread `targetFolderId` into `#createPage(page, campaignDate, ownership, targetFolderId)` — inside `#createPage`, add `...(folderId ? { folder: folderId } : {})` to each of its three `JournalEntry.create` payloads (text row at :344, session row at :352, and pass it as `createMejEntry`'s new `folder` argument at :359).

- [ ] **Step 4: i18n**

```json
"destination": "Import into",
"destinationNew": "New Campaign…",
"subfolder": "Create a subfolder named after the document",
"audienceDefault": "Campaign default"
```

(Under the existing `import` object.)

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run` → green (`doc-import.test.js` covers the pure planner, untouched).

```bash
git add templates/import-wizard.hbs scripts/apps/import-wizard.mjs lang/en.json
git commit -m "feat: import wizard destination campaign, subfolder, and campaign-default audience"
```

---

### Task 10: Auto-capture campaign target

**Files:**
- Modify: `scripts/hooks/auto-capture.mjs` (`fileOntoNewestTimepoint` :87, `createEncounter` :151-158, media path :203)
- Modify: `scripts/apps/CampaignHubPage.mjs` (new action `setCaptureCampaign`)
- Modify: `templates/hub.hbs` (GM controls area, next to the New Session button around line 53)
- Modify: `lang/en.json`
- Test: Task 12 e2e (capture declines without a target; files into target campaign)

**Interfaces:**
- Consumes: `AUTO_CAPTURE_CAMPAIGN_SETTING`; `getCampaigns` from `campaign-store.mjs`; `isCampaignFolder` from Task 1; `ensureTimelineJournal(campaign)`, `resolveTimelineJournal(campaign)` from Task 3; `promptCampaignChoice` from Task 8.
- Produces: `captureCampaign()` (module-local to `auto-capture.mjs`).

- [ ] **Step 1: Resolve the capture campaign in `auto-capture.mjs`**

Add near the top (imports: `AUTO_CAPTURE_CAMPAIGN_SETTING` from constants, `isCampaignFolder` from `../logic/campaigns.mjs`, `getCampaigns` from `../data/campaign-store.mjs`, and extend the timeline-journal import with `resolveTimelineJournal`):

```js
/** The campaign that receives captures (spec §4), or null. Null in a world WITH campaigns means "decline"; null in a zero-campaign world means "legacy loose behavior". */
function captureCampaign() {
  const id = game.settings.get(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING);
  const folder = id ? game.folders.get(id) : null;
  return folder && isCampaignFolder(folder) ? folder : null;
}
```

In `createEncounter` (:151), before creating the page:

```js
  const campaign = captureCampaign();
  if (!campaign && getCampaigns().length) {
    ui.notifications.warn(game.i18n.localize(`${I18N}.hub.captureNoCampaign`));
    return null;
  }
```

Then pass the destination into the create: `createMejEntry(MEJ_ENCOUNTER_TYPE, name, ..., {...}, campaign ? { default: baselineOwnership(campaign) } : null, campaign?.id ?? null)` (import `baselineOwnership`). Guard the caller of `createEncounter` for a null return (check how its result is used at the call site — `grep -n "createEncounter(" scripts/hooks/auto-capture.mjs`).

Change `fileOntoNewestTimepoint` (:87) to resolve the capture campaign's timeline instead of the singleton: replace its `getTimelineJournal()` / `ensureTimelineJournal()` call with:

```js
  const campaign = captureCampaign();
  if (!campaign && getCampaigns().length) return;   // campaigns exist but no target: decline silently for media
  const journal = await ensureTimelineJournal(campaign);
```

(Media relay at :203 goes through `fileOntoNewestTimepoint`, so it inherits the same resolution.)

- [ ] **Step 2: Hub control to set the target**

In `templates/hub.hbs`, next to the New Session button (GM block, ~line 53):

```hbs
<button type="button" class="mej-cc-capture-target" data-action="setCaptureCampaign"
        data-tooltip="{{localize 'MEJCampaignCompanion.hub.captureTarget'}}">
    <i class="fa-solid fa-crosshairs"></i>
</button>
```

Register `setCaptureCampaign: CampaignHubPage.onSetCaptureCampaign` and implement:

```js
  static async onSetCaptureCampaign() {
    if (!game.user.isGM) return;
    const campaign = await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.captureTarget`));
    if (!campaign) return;
    await game.settings.set(MODULE_ID, AUTO_CAPTURE_CAMPAIGN_SETTING, campaign.id);
    ui.notifications.info(game.i18n.format(`${I18N}.hub.captureTargetSet`, { name: campaign.name }));
  }
```

- [ ] **Step 3: i18n**

```json
"captureNoCampaign": "No campaign set to receive captures — choose one in the Hub.",
"captureTarget": "Auto-capture campaign",
"captureTargetSet": "Captures will file into \"{name}\"."
```

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run` → green (`auto-capture.test.js` and `encounter-capture.test.js` cover pure helpers; if either imported a changed signature, update the test to pass the new trailing arguments explicitly).

```bash
git add scripts/hooks/auto-capture.mjs scripts/apps/CampaignHubPage.mjs templates/hub.hbs lang/en.json
git commit -m "feat: auto-capture targets a campaign; declines with a named reason when unset"
```

---

### Task 11: Adoption of existing worlds + Unfiled filing + dataVersion

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (add `adoptionPlan`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (adoption banner context + actions `adoptWorld`, `dismissAdoption`, `fileIntoCampaign`, `fileAllShown`)
- Modify: `templates/hub.hbs` (banner at top of index tab; row + bulk actions in Unfiled scope)
- Modify: `scripts/campaign-companion.mjs` (dataVersion stamp on ready)
- Modify: `lang/en.json`
- Test: `test/campaigns.test.js` (adoptionPlan); Task 12 e2e (full adoption flow)

**Interfaces:**
- Consumes: everything above.
- Produces: `adoptionPlan(entries, getMEJType, legacyTimelineId)` → string[] of entry ids to move.

**Documented refinement of spec §6:** adoption moves only ROOT-LEVEL (folderless) MEJ-typed entries plus the legacy timeline journal. Entries the user already organized into their own folders are left in place (moving them would flatten that organization) and surface in Unfiled for manual filing — the user can drag whole folders into the campaign natively.

- [ ] **Step 1: `adoptionPlan` with failing test first**

Append to `test/campaigns.test.js`:

```js
import { adoptionPlan } from "../scripts/logic/campaigns.mjs";

describe("adoptionPlan (spec §6)", () => {
  const typed = (id) => ({ id, folder: null, documentName: "JournalEntry", flags: {} });
  const getMEJType = (e) => (e.id.startsWith("t") ? "person" : false);
  it("moves root-level MEJ-typed entries and the legacy timeline; skips foldered and untyped", () => {
    const entries = [
      typed("t1"),
      { ...typed("t2"), folder: { id: "f1", flags: {} } },   // user-foldered: preserved
      typed("plain"),                                        // untyped: manual filing
      typed("timeline-x")                                    // untyped but IS the legacy timeline
    ];
    expect(adoptionPlan(entries, getMEJType, "timeline-x")).toEqual(["t1", "timeline-x"]);
    expect(adoptionPlan([], getMEJType, null)).toEqual([]);
  });
});
```

Run: `npx vitest run test/campaigns.test.js` → FAIL. Implement in `scripts/logic/campaigns.mjs`:

```js
/**
 * Spec §6 adoption plan: ids of entries to move into the new campaign
 * folder - root-level MEJ-typed entries plus the legacy timeline journal.
 * Foldered entries are preserved where they are (documented refinement);
 * untyped root entries stay for manual filing via the Unfiled scope.
 */
export function adoptionPlan(entries, getMEJType, legacyTimelineId) {
  const ids = [];
  for (const e of entries ?? []) {
    if (e.folder) continue;
    if (e.id === legacyTimelineId || getMEJType(e)) ids.push(e.id);
  }
  return ids;
}
```

Run again → PASS.

- [ ] **Step 2: Adoption banner + action**

In `CampaignHubPage.mjs`, compute banner visibility in `_prepareBodyContext` (GM only, zero campaigns, not yet prompted, and there is something to adopt):

```js
    if (isGM && !getCampaigns().length && !game.settings.get(MODULE_ID, ADOPTION_PROMPTED_SETTING)) {
      const legacyId = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING) || null;
      context.adoption = adoptionPlan(game.journal.contents, mejType, legacyId).length > 0;
    }
```

Template, at the very top of the index tab's `.tab-inner` (before `.mej-cc-index-controls`):

```hbs
{{#if adoption}}
<div class="mej-cc-adoption-banner">
    <span>{{localize "MEJCampaignCompanion.hub.adoptOffer"}}</span>
    <button type="button" data-action="adoptWorld">{{localize "MEJCampaignCompanion.hub.adoptGo"}}</button>
    <button type="button" data-action="dismissAdoption"><i class="fa-solid fa-xmark"></i></button>
</div>
{{/if}}
```

Actions (register both):

```js
  static async onAdoptWorld() {
    if (!game.user.isGM) return;
    const esc = foundry.utils.escapeHTML;
    const baselineOptions = ["none", "observer", "owner"].map((k) =>
      `<option value="${k}" ${k === "observer" ? "selected" : ""}>${esc(game.i18n.localize(`${I18N}.hub.baseline.${k}`))}</option>`).join("");
    const content = `
      <p>${esc(game.i18n.localize(`${I18N}.hub.adoptExplain`))}</p>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignName`))}</label>
        <input type="text" name="name" value="${esc(game.world.title)}"></div>
      <div class="form-group"><label>${esc(game.i18n.localize(`${I18N}.hub.newCampaignBaseline`))}</label>
        <select name="baseline">${baselineOptions}</select></div>`;
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${I18N}.hub.adoptGo`) },
      content,
      ok: { callback: (event, button) => ({
        name: button.form.elements.name.value.trim(),
        baseline: button.form.elements.baseline.value
      }) },
      rejectClose: false
    });
    if (!result?.name) return;
    const campaign = await createCampaign(result.name, { ownershipDefault: result.baseline });
    if (!campaign) return;
    const legacyId = game.settings.get(MODULE_ID, TIMELINE_JOURNAL_SETTING) || null;
    const ids = adoptionPlan(game.journal.contents, mejType, legacyId);
    if (ids.length) await JournalEntry.updateDocuments(ids.map((id) => ({ _id: id, folder: campaign.id })));
    if (legacyId) await game.settings.set(MODULE_ID, TIMELINE_JOURNAL_SETTING, "");
    await game.settings.set(MODULE_ID, ADOPTION_PROMPTED_SETTING, true);
    this.state.campaignId = campaign.id;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, campaign.id);
    ui.notifications.info(game.i18n.format(`${I18N}.hub.adopted`, { count: ids.length, name: campaign.name }));
    this.render({ parts: ["main"] });
  }

  static async onDismissAdoption() {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, ADOPTION_PROMPTED_SETTING, true);
    this.render({ parts: ["main"] });
  }
```

Imports to extend: `adoptionPlan` from `../logic/campaigns.mjs`; `TIMELINE_JOURNAL_SETTING`, `ADOPTION_PROMPTED_SETTING` from constants. Note the legacy timeline journal, once moved into the folder, is found by `campaignTimelineJournal()` via its `timeline` flag — no data rewrite needed.

- [ ] **Step 3: Unfiled filing actions**

Index row action (GM, Unfiled scope only — template gate `{{#if index.isUnfiledScope}}{{#if @root.isGM}}`, placed next to the Task 7 eye button):

```hbs
<button type="button" class="mej-cc-row-file" data-action="fileIntoCampaign"
        data-tooltip="{{localize 'MEJCampaignCompanion.hub.fileInto'}}">
    <i class="fa-solid fa-folder-open"></i>
</button>
```

Bulk button in the index controls, same gating:

```hbs
<button type="button" class="mej-cc-file-all" data-action="fileAllShown">
    <i class="fa-solid fa-folder-open"></i> {{localize "MEJCampaignCompanion.hub.fileAllShown"}}
</button>
```

Actions:

```js
  static async onFileIntoCampaign(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const entry = uuid ? await fromUuid(uuid) : null;
    const campaign = entry ? await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.fileInto`)) : null;
    if (!campaign) return;
    await entry.update({ folder: campaign.id });
    this.render({ parts: ["main"] });
  }

  static async onFileAllShown() {
    if (!game.user.isGM) return;
    // The currently-filtered Unfiled rows: recompute exactly what the pane shows.
    const entries = this.#scopedEntries();
    const source = buildIndexSource(entries, game.user, mejType, this.#typeIcon.bind(this));
    const rows = filterIndexRows(source, this.state, this.#typeLabel.bind(this));
    if (!rows.length) return;
    const campaign = await CampaignHubPage.promptCampaignChoice(game.i18n.localize(`${I18N}.hub.fileAllShown`));
    if (!campaign) return;
    const ids = rows.map((r) => foundry.utils.parseUuid(r.uuid).id);
    await JournalEntry.updateDocuments(ids.map((id) => ({ _id: id, folder: campaign.id })));
    ui.notifications.info(game.i18n.format(`${I18N}.hub.adopted`, { count: ids.length, name: campaign.name }));
    this.render({ parts: ["main"] });
  }
```

- [ ] **Step 4: dataVersion stamp**

In `scripts/campaign-companion.mjs`, in the existing `ready` hook (locate: `grep -n "Hooks.on(\"ready\"\|Hooks.once(\"ready\"" scripts/campaign-companion.mjs`), append:

```js
  // Spec §6: versioned migration hook. No migrations exist yet at version 1;
  // future schema changes bump CURRENT_DATA_VERSION and add steps here.
  if (game.user.isGM && game.settings.get(MODULE_ID, DATA_VERSION_SETTING) < CURRENT_DATA_VERSION) {
    await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);
  }
```

(If the ready hook callback isn't async, make it so or use `.then()`.)

- [ ] **Step 5: i18n**

```json
"adoptOffer": "This world has campaign content but no campaign. Create one from it?",
"adoptGo": "Create campaign from this world",
"adoptExplain": "Moves this world's typed entries and its timeline into a new campaign folder. Entries already in your own folders, and plain journal entries, stay put — file them from the Unfiled view.",
"adopted": "Filed {count} entries into \"{name}\".",
"fileInto": "File into campaign…",
"fileAllShown": "File all shown into…"
```

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run` → green.

```bash
git add scripts/logic/campaigns.mjs scripts/apps/CampaignHubPage.mjs scripts/campaign-companion.mjs templates/hub.hbs lang/en.json test/campaigns.test.js
git commit -m "feat: world adoption flow, unfiled filing actions, dataVersion migration hook"
```

---

### Task 12: E2E suite

**Files:**
- Create: `tests/e2e/14-campaigns.spec.mjs`
- Modify (only if red): `tests/e2e/03-search.spec.mjs`
- Test: `npx playwright test tests/e2e/14-campaigns.spec.mjs`

**Interfaces:**
- Consumes: the whole feature. Mirror the harness setup of `tests/e2e/03-search.spec.mjs` (world launch, GM + player logins, seeding helpers) — read that file first and reuse its fixtures/helpers verbatim.

- [ ] **Step 1: Read the harness conventions**

Read `tests/e2e/03-search.spec.mjs` and `tests/e2e/helpers/` to learn: how a world is launched/reset, how GM and player pages log in, how entries are seeded, and how the Hub shell page is opened. Use those helpers; do not invent new launch code.

- [ ] **Step 2: Write the scenarios**

`tests/e2e/14-campaigns.spec.mjs`, one `test.describe` with serial flow (seeding once):

1. **Create campaign:** GM opens Hub → New Campaign ("Alpha", Players can view). Assert the picker contains "Alpha" and scoping to it persists across a Hub re-open (client setting).
2. **Membership + Journal rows:** GM creates a Person inside the Alpha folder (seed via API: `JournalEntry.create` with `folder`) and a PLAIN text entry in the folder. Scope Alpha → both listed; the plain one shows the "Journal" type label. Create a loose text entry → appears only under Unfiled.
3. **Scoped search + spillover:** second campaign "Beta" with an entry whose body contains a unique token also present in an Alpha entry. Scope Beta, search the token → only Beta's hit, and the spillover button shows "1 more". Click it → scope flips to All, both hits.
4. **Timeline discipline:** scope Alpha (GM) → timeline stack exists (auto-created). Attempt to drag/link a Beta entry onto an Alpha timepoint via the UI → warn notification, no link. (If the drag is impractical in Playwright, call the drop handler's guard path via `page.evaluate` on the exposed API and assert the notification.)
5. **Import into campaign:** run the import wizard on the fixture docx used by the existing import e2e (find it: `grep -rn "docx" tests/e2e/`), choosing "Import into: Alpha" + subfolder. Assert entries land under a subfolder of Alpha, appear in Alpha's index scope, and the timepoint went to Alpha's timeline, not a singleton.
6. **Adoption:** fresh world state (or a dedicated describe with its own reset) seeded with loose typed entries + legacy singleton timeline; GM opens Hub → banner shown → adopt → entries moved into the new campaign folder, `timelineJournalId` cleared, banner gone, picker scoped to the new campaign.
7. **Permissions from the player seat:** GM hides an Alpha entry (eye toggle) → player's Hub index and search lose it. GM runs campaign settings "apply to all" with Players can view → player sees members. This MUST run as a real player login (the historically bug-prone path).

- [ ] **Step 3: Run the new suite**

Run: `npx playwright test tests/e2e/14-campaigns.spec.mjs`
Expected: PASS. Fix implementation (not tests) where reality disagrees with the spec'd behavior.

- [ ] **Step 4: Full regression**

Run: `npx vitest run && npx playwright test`
Expected: all green. `03-search.spec.mjs` runs in a zero-campaign world → behavior is unchanged by design (pre-adoption fallback); if it reddens, the fallback broke — fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/14-campaigns.spec.mjs
git commit -m "test: e2e coverage for campaign container (creation, scoping, import, adoption, permissions)"
```
