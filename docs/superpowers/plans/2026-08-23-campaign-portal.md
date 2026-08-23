# Campaign Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every campaign an openable entity — a portal JournalEntry whose sheet IS the scoped Campaign Hub — plus an "Open Campaign Hub" folder context-menu entry.

**Architecture:** The portal is a native subtype page (`mej-campaign-companion.campaign` + MEJ interop flag), built by pure `buildCampaignPortalData()` exactly like the Session pattern. The folder remains the sole source of truth: create-together, two-way rename sync via a pure loop-guarded planner, portal-delete ≠ campaign-delete, `dataVersion` 2 migration backfills portals. Routing maps the subtype's sheet to `CampaignHubPage` with a once-per-mount scope shim; the context menu registers on both the core sidebar's suffixed hook and MEJ's shell-sidebar bare hook.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules), MEJ extension API (`registerSheetType`), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-campaign-portal-design.md` (on this branch — read it first; its Decisions table is binding: portal is a view/handle, folder deletion is the only campaign deletion, portals excluded from Hub index/Unfiled/All rows but present in sidebar/search/auto-link, import wizard does NOT gain a campaign type, exporter excludes portals).

## Global Constraints

- Branch `feature/campaign-portal`, worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/campaign-portal`. Never commit to main. No changes to the monks-enhanced-journal repo, ever (the context menu is companion-side hooks only).
- Playwright always `--trace off`; TT- fixture prefix; World A shared — id-tracked destructive cleanup only; restore scope select to All ("") and any changed state; restore the module symlink after e2e even on failure (the harness's global-setup/teardown auto-pins it — verify with readlink afterward regardless).
- Unit suite: 552 green before this plan; Task 1 adds exactly 12 → **564**; Task 2 adds exactly 3 → **567** from Task 2 on.
- The Session subtype is the pattern authority: portal declaration (module.json `documentTypes`), page payload (native type + `flags["monks-enhanced-journal"].type`), and sheet registration mirror it exactly.
- Hub behavior for non-portal documents must be byte-for-byte unchanged: the scope shim runs ONLY when the mounted document's `type === CAMPAIGN_DOCUMENT_TYPE`.

---

### Task 1: Constants, subtype declaration, pure portal logic

**Files:**
- Modify: `scripts/constants.mjs` (after the SESSION_* constants), `module.json` (documentTypes)
- Create: `scripts/logic/campaign-portal-data.mjs`
- Modify: `scripts/logic/campaigns.mjs` (add `isCampaignPortal`)
- Test: `test/campaign-portal-data.test.js`

**Interfaces:**
- Consumes: existing `MODULE_ID`; `campaigns.mjs` conventions (doc-shaped plain objects, no Foundry imports).
- Produces: constants `CAMPAIGN_TYPE = "campaign"` and `CAMPAIGN_DOCUMENT_TYPE = \`${MODULE_ID}.campaign\``; `buildCampaignPortalData(name) -> pageData`; `renameSyncPlan({ folderName, portalName, changedSide }) -> {target: "portal"|"folder", name} | null`; `missingPortalPlan(campaigns, portalOf) -> Folder[]`; `isCampaignPortal(entryOrPage) -> boolean`. Tasks 2-3 consume all of these by exactly these names.

- [ ] **Step 1: Declare the subtype**

In `module.json`'s `documentTypes.JournalEntryPage`, add a sibling of `session`:

```json
   "campaign": {}
```

In `scripts/constants.mjs`, next to the SESSION constants add:

```js
/** MEJ-flag type key for a campaign portal entry (flags["monks-enhanced-journal"].type). */
export const CAMPAIGN_TYPE = "campaign";
/** Native module-declared JournalEntryPage subtype for campaign portals (see module.json documentTypes). */
export const CAMPAIGN_DOCUMENT_TYPE = `${MODULE_ID}.campaign`;
```

- [ ] **Step 2: Write the failing tests**

Create `test/campaign-portal-data.test.js`:

```js
import { describe, it, expect } from "vitest";
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../scripts/constants.mjs";
import { buildCampaignPortalData, renameSyncPlan, missingPortalPlan } from "../scripts/logic/campaign-portal-data.mjs";
import { isCampaignPortal } from "../scripts/logic/campaigns.mjs";

describe("buildCampaignPortalData", () => {
  const data = buildCampaignPortalData("Radiant Citadel");
  it("uses the native subtype and the MEJ interop flag", () => {
    expect(data.type).toBe(CAMPAIGN_DOCUMENT_TYPE);
    expect(data.flags["monks-enhanced-journal"].type).toBe(CAMPAIGN_TYPE);
  });
  it("names the page after the campaign and marks it a portal", () => {
    expect(data.name).toBe("Radiant Citadel");
    expect(data.flags[MODULE_ID].campaignPortal).toBe(true);
  });
});

describe("renameSyncPlan", () => {
  it("no-op when names already match", () => {
    expect(renameSyncPlan({ folderName: "A", portalName: "A", changedSide: "folder" })).toBe(null);
  });
  it("folder change renames the portal", () => {
    expect(renameSyncPlan({ folderName: "New", portalName: "Old", changedSide: "folder" }))
      .toEqual({ target: "portal", name: "New" });
  });
  it("portal change renames the folder", () => {
    expect(renameSyncPlan({ folderName: "Old", portalName: "New", changedSide: "portal" }))
      .toEqual({ target: "folder", name: "New" });
  });
  it("is loop-safe: applying its own output yields a no-op", () => {
    const first = renameSyncPlan({ folderName: "New", portalName: "Old", changedSide: "folder" });
    expect(renameSyncPlan({ folderName: "New", portalName: first.name, changedSide: "portal" })).toBe(null);
  });
});

describe("missingPortalPlan", () => {
  const c1 = { id: "c1" }, c2 = { id: "c2" };
  it("lists campaigns lacking a portal, idempotently", () => {
    const portalOf = (c) => (c.id === "c1" ? { id: "p1" } : null);
    expect(missingPortalPlan([c1, c2], portalOf)).toEqual([c2]);
    expect(missingPortalPlan([c1, c2], () => ({ id: "p" }))).toEqual([]);
  });
});

describe("isCampaignPortal", () => {
  const portalPage = { documentName: "JournalEntryPage", type: CAMPAIGN_DOCUMENT_TYPE };
  it("detects a portal page directly", () => {
    expect(isCampaignPortal(portalPage)).toBe(true);
  });
  it("detects an entry via its pages", () => {
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [portalPage] } })).toBe(true);
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [{ type: "text" }] } })).toBe(false);
  });
  it("is false for null and plain docs", () => {
    expect(isCampaignPortal(null)).toBe(false);
    expect(isCampaignPortal({ documentName: "JournalEntry", pages: { contents: [] } })).toBe(false);
  });
});
```

(That is 2 + 4 + 1 + 3 = 10 `it` blocks here, plus the 2 exclusion tests added to `test/campaigns.test.js` in Step 5 = 12 new tests.)

- [ ] **Step 3: Run to verify they fail**

Run (worktree root): `npx vitest run test/campaign-portal-data.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `scripts/logic/campaign-portal-data.mjs`:

```js
// Pure campaign-portal payload + lifecycle planners (spec C §1). Same
// conventions as session-page-data.mjs (payload) and campaigns.mjs
// (doc-shaped inputs, no Foundry imports).
import { MODULE_ID, CAMPAIGN_TYPE, CAMPAIGN_DOCUMENT_TYPE } from "../constants.mjs";

/**
 * The pages[] payload for a campaign portal. Sets BOTH the native
 * module-declared subtype (a bare "campaign" is rejected by
 * DocumentTypeField at create time) and the MEJ interop flag that
 * search/Hub/auto-link machinery gates on - exactly the Session pattern
 * (see session-page-data.mjs's doc comment for the full citation trail).
 * The companion's own campaignPortal flag is the cheap identity marker
 * lifecycle hooks match on without re-deriving from the type string.
 */
export function buildCampaignPortalData(name) {
  return {
    name,
    type: CAMPAIGN_DOCUMENT_TYPE,
    flags: {
      [MODULE_ID]: { campaignPortal: true },
      "monks-enhanced-journal": { type: CAMPAIGN_TYPE }
    }
  };
}

/**
 * Two-way rename reconciliation (spec C §1): the side that CHANGED wins,
 * the other side follows. Equal names -> null (the loop guard: applying a
 * plan's own output always converges to null on the next event).
 */
export function renameSyncPlan({ folderName, portalName, changedSide }) {
  if (folderName === portalName) return null;
  return changedSide === "folder"
    ? { target: "portal", name: folderName }
    : { target: "folder", name: portalName };
}

/** Migration planner (spec C §1): campaigns lacking a portal, in input order. Idempotent by construction. */
export function missingPortalPlan(campaigns, portalOf) {
  return (campaigns ?? []).filter((c) => !portalOf(c));
}
```

In `scripts/logic/campaigns.mjs`, add (imports `CAMPAIGN_DOCUMENT_TYPE` from `../constants.mjs` alongside the existing constants import):

```js
/** Is this a campaign portal (spec C): the entry/page whose sheet IS the scoped Hub. Accepts a JournalEntry (any page matches) or a JournalEntryPage. */
export function isCampaignPortal(doc) {
  if (!doc) return false;
  if (doc.documentName === "JournalEntryPage") return doc.type === CAMPAIGN_DOCUMENT_TYPE;
  return (doc.pages?.contents ?? []).some((p) => p.type === CAMPAIGN_DOCUMENT_TYPE);
}
```

- [ ] **Step 5: Membership-exclusion tests**

In `test/campaigns.test.js`, extend the existing suite with 2 tests (import `isCampaignPortal` in the file's dynamic import list; the file's `entry()` helper builds flag-based fixtures — add a local portal-entry helper):

```js
  describe("isCampaignPortal exclusion shape", () => {
    const portalEntry = {
      id: "pe", documentName: "JournalEntry", folder: null,
      pages: { contents: [{ documentName: "JournalEntryPage", type: "mej-campaign-companion.campaign" }] },
      flags: {}
    };
    it("marks portal entries", () => {
      expect(isCampaignPortal(portalEntry)).toBe(true);
    });
    it("does not mark timeline journals or plain entries", () => {
      expect(isCampaignPortal(entry("t1", { timeline: true }))).toBe(false);
      expect(isCampaignPortal(entry("e1"))).toBe(false);
    });
  });
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run` — Expected: 564 passed.

- [ ] **Step 7: Commit**

```bash
git add module.json scripts/constants.mjs scripts/logic/campaign-portal-data.mjs scripts/logic/campaigns.mjs test/campaign-portal-data.test.js test/campaigns.test.js
git commit -m "feat: campaign portal subtype, pure payload + lifecycle planners"
```

---

### Task 2: Store lifecycle, rename sync, migration, listing/export exclusion

**Files:**
- Modify: `scripts/data/campaign-store.mjs` (createCampaign + new helpers + listing exclusion)
- Create: `scripts/hooks/portal-sync.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (`registerCore`: one new step registering portal-sync)
- Modify: `scripts/constants.mjs:72` (`CURRENT_DATA_VERSION = 2`), `scripts/campaign-companion.mjs:215-221` (migration step)
- Modify: `scripts/logic/doc-export.mjs` (exclude the campaign kind from export eligibility)
- Test: `test/doc-export.test.js` (or `doc-export-snapshot.test.js` — whichever holds the eligibility tests; add there)

**Interfaces:**
- Consumes: Task 1's `buildCampaignPortalData`, `renameSyncPlan`, `missingPortalPlan`, `isCampaignPortal`, `CAMPAIGN_TYPE`, `CAMPAIGN_DOCUMENT_TYPE`; existing `getCampaigns`, `baselineOwnership`, `ownershipLevelFor`.
- Produces: `campaignPortal(campaign) -> JournalEntry|null` and `ensureCampaignPortal(campaign) -> JournalEntry|null` exported from `campaign-store.mjs` (Task 3's restore control and the migration both call `ensureCampaignPortal`); `registerPortalSync()` from `hooks/portal-sync.mjs`.

- [ ] **Step 1: Store helpers + create-together**

In `scripts/data/campaign-store.mjs` (extend the existing imports with the Task 1 names):

```js
/** The campaign's portal entry (spec C §1), or null. Direct children only - portals live at the folder root. */
export function campaignPortal(campaign) {
  return (campaign?.contents ?? []).find((e) => isCampaignPortal(e)) ?? null;
}

/**
 * GM-only. Create the portal when missing (createCampaign, the settings
 * dialog's restore control, and the dataVersion-2 migration all funnel
 * here). Ownership = the campaign baseline, like any companion creation.
 */
export async function ensureCampaignPortal(campaign) {
  if (!game.user.isGM || !campaign) return null;
  const existing = campaignPortal(campaign);
  if (existing) return existing;
  return JournalEntry.create({
    name: campaign.name,
    folder: campaign.id,
    ownership: { default: baselineOwnership(campaign) },
    pages: [buildCampaignPortalData(campaign.name)]
  });
}
```

In `createCampaign()`, after the auto-capture seeding block and before `return folder;`, add:

```js
  if (folder) await ensureCampaignPortal(folder);
```

In `campaignEntries` and `unfiledEntries`, extend the filters with `&& !isCampaignPortal(e)` (beside the existing `!isTimelineJournal(e)` term in each).

- [ ] **Step 2: Rename sync hooks**

Create `scripts/hooks/portal-sync.mjs`:

```js
// Two-way campaign<->portal rename sync (spec C §1). The pure planner
// (renameSyncPlan) owns the decision; these hooks only detect which side
// changed and apply at most one write. Equal names plan to null, so the
// echo write each sync causes converges immediately - no loop-breaker
// flag is needed. GM-side only: players cannot rename either object.
import { MODULE_ID } from "../constants.mjs";
import { renameSyncPlan } from "../logic/campaign-portal-data.mjs";
import { isCampaignFolder, isCampaignPortal } from "../logic/campaigns.mjs";
import { campaignPortal } from "../data/campaign-store.mjs";

export function registerPortalSync() {
  Hooks.on("updateFolder", async (folder, changes) => {
    try {
      if (!game.user.isGM || changes?.name === undefined) return;
      if (!isCampaignFolder(folder)) return;
      const portal = campaignPortal(folder);
      if (!portal) return;
      const plan = renameSyncPlan({ folderName: folder.name, portalName: portal.name, changedSide: "folder" });
      if (plan?.target === "portal") {
        // Keep the page name in step too - the portal is a single-page entry.
        const page = portal.pages.contents[0];
        await portal.update({ name: plan.name, ...(page ? { pages: [{ _id: page.id, name: plan.name }] } : {}) });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | portal rename sync (folder) failed`, err);
    }
  });

  Hooks.on("updateJournalEntry", async (entry, changes) => {
    try {
      if (!game.user.isGM || changes?.name === undefined) return;
      if (!isCampaignPortal(entry)) return;
      const folder = entry.folder;
      if (!folder || !isCampaignFolder(folder)) return;
      const plan = renameSyncPlan({ folderName: folder.name, portalName: entry.name, changedSide: "portal" });
      if (plan?.target === "folder") await folder.update({ name: plan.name });
    } catch (err) {
      console.error(`${MODULE_ID} | portal rename sync (portal) failed`, err);
    }
  });
}
```

In `scripts/integrations/mej-adapter.mjs`'s `registerCore()`, add alongside the other steps:

```js
  await step("portal rename sync", async () => {
    const { registerPortalSync } = await import("../hooks/portal-sync.mjs");
    registerPortalSync();
  });
```

- [ ] **Step 3: Migration**

`scripts/constants.mjs:72`: `export const CURRENT_DATA_VERSION = 2;`

In `scripts/campaign-companion.mjs`, replace the version-bump block (lines ~215-221) so version 2 does real work (adapt to the file's existing imports — `getCampaigns`, `campaignPortal`, `ensureCampaignPortal` and `missingPortalPlan` need importing):

```js
  // Spec §6 (campaign-container) + spec C §1: versioned migrations.
  if (game.user.isGM && game.settings.get(MODULE_ID, DATA_VERSION_SETTING) < CURRENT_DATA_VERSION) {
    // v2: every campaign gets its portal entry (idempotent - the planner
    // returns only campaigns lacking one).
    for (const campaign of missingPortalPlan(getCampaigns(), campaignPortal)) {
      await ensureCampaignPortal(campaign);
    }
    await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);
  }
```

- [ ] **Step 4: Export exclusion + tests**

In `scripts/logic/doc-export.mjs`, find the entry-eligibility site (the code that derives each entry's `kind` from the MEJ type — grep `kind`) and exclude the campaign kind: entries whose kind is `"campaign"` never enter the export snapshot (mirror however timeline journals are excluded; if they're excluded upstream by the caller, apply the same treatment — the EXPORTED DOCUMENT must never contain a portal section either way).

Add 3 tests to the doc-export test file that owns eligibility/snapshot coverage:

```js
  it("excludes campaign portals from export eligibility", () => { /* build a portal-shaped entry via the file's fixture helpers (kind "campaign") and assert it is filtered out of the eligible/snapshot set */ });
  it("still exports ordinary typed entries alongside an excluded portal", () => { /* one person + one portal -> only the person present */ });
  it("round-trip snapshot never emits a campaign kind", () => { /* whatever structure the snapshot test uses: assert no section/kind === "campaign" */ });
```

These three MUST be real assertions against the module's actual fixture helpers — open the existing tests in that file first and follow their construction pattern exactly; the comments above describe intent, not literal code, because the fixture helpers' shapes live in that file.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run` — Expected: 567 passed.
Run: `node --input-type=module --check < scripts/hooks/portal-sync.mjs && node --input-type=module --check < scripts/data/campaign-store.mjs && echo OK` — Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add scripts/data/campaign-store.mjs scripts/hooks/portal-sync.mjs scripts/integrations/mej-adapter.mjs scripts/constants.mjs scripts/campaign-companion.mjs scripts/logic/doc-export.mjs test/
git commit -m "feat: portal lifecycle - create-together, rename sync, dataVersion 2 migration, listing/export exclusion"
```

---

### Task 3: Routing — the portal's sheet IS the Hub

**Files:**
- Modify: `scripts/integrations/mej-adapter.mjs` (register the campaign type/sheet in BOTH modes; extend `ensureSheetRegistrations`)
- Modify: `scripts/apps/CampaignHubPage.mjs` (mount scope shim; "Restore campaign entry" in onEditCampaign)
- Modify: `lang/en.json` (`sheettype.campaign`, `hub.restorePortal`)

**Interfaces:**
- Consumes: Task 1's `CAMPAIGN_TYPE`/`CAMPAIGN_DOCUMENT_TYPE`/`isCampaignPortal`; Task 2's `ensureCampaignPortal`, `campaignPortal`; existing `campaignOf`, `HUB_CAMPAIGN_SCOPE_SETTING`, `api.registerSheetType` (Session precedent at mej-adapter.mjs:123-130), `registerHubSheetClass` / `DocumentSheetConfig.registerSheet` precedent.
- Produces: opening a portal (sidebar, search hit, @UUID link, MEJ shell) mounts `CampaignHubPage` scoped to the portal's campaign, in both api and native modes. Task 5 asserts this live.

- [ ] **Step 1: api-mode registration**

In `wireApiMode` (mej-adapter.mjs), after the Session `registerSheetType` call, add (mirror the Session block exactly, adjusting fields):

```js
  api.registerSheetType({
    key: CAMPAIGN_TYPE,
    moduleId: MODULE_ID,
    sheetClass: CampaignHubPage,
    label: `${I18N}.sheettype.campaign`,
    icon: "fa-flag",
    relationships: []
  });
```

(Import `CAMPAIGN_TYPE` in the file's constants import. If `registerSheetType` requires a `documentType`-style field the Session block doesn't show, read MEJ's extension-api implementation — `game.MonksEnhancedJournal`'s API from the 14.07 extension-API merge — and match what Session actually passes end-to-end.)

- [ ] **Step 2: Native-mode / core registration**

Extend `registerHubSheetClass` (or add a sibling call beside its invocation) so the campaign subtype ALSO resolves to the Hub, and make it the default for that type so a core sidebar click opens it directly:

```js
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CampaignHubPage, {
    types: [CAMPAIGN_DOCUMENT_TYPE],
    makeDefault: true,
    canBeDefault: true,
    canConfigure: false,
    label: `${I18N}.sheettype.campaign`
  });
```

Extend `ensureSheetRegistrations`/`missingSheetRegistrations` to also repair the campaign registration (read `missingSheetRegistrations`' implementation — logic/, unit-tested — and extend it plus its test the same way session/hub are covered; keep its existing tests passing, adding assertions for the campaign key).

- [ ] **Step 3: Mount scope shim in `CampaignHubPage.mjs`**

Add an instance field `#portalScopedFor = null;` beside the other private fields, and at the TOP of `_prepareBodyContext` (before `const { campaign, unfiled } = this.#scope();`):

```js
    // Spec C §2: a portal mount scopes the Hub to its campaign - once per
    // mount, so the user can re-scope with the picker afterwards without
    // the portal fighting them. The shell's synthetic hub page and the
    // native window's synthetic document never have the campaign subtype,
    // so plain Hub opens are untouched.
    if (this.document?.type === CAMPAIGN_DOCUMENT_TYPE && this.#portalScopedFor !== this.document.uuid) {
      this.#portalScopedFor = this.document.uuid;
      const portalCampaign = campaignOf(this.document);
      if (portalCampaign) {
        this.state.campaignId = portalCampaign.id;
        await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, portalCampaign.id);
      }
    }
```

(`campaignOf` accepts a JournalEntryPage and resolves via `.parent` — already imported in this file. `CAMPAIGN_DOCUMENT_TYPE` needs importing. NOTE: the mounted document may be the portal PAGE (shell subsheet routing) — if live testing in Task 5 shows the shell hands the ENTRY instead, extend the condition with `|| isCampaignPortal(this.document)`; start with the page-type check alone.)

- [ ] **Step 4: Restore control**

In `onEditCampaign` (CampaignHubPage.mjs:831): read the method; it builds a DialogV2 for name/baseline edits. Add, GM-only, when `campaignPortal(campaign)` is null, an extra button/action "Restore campaign entry" whose callback awaits `ensureCampaignPortal(campaign)` and re-renders the Hub. Follow the dialog's existing button/action idiom exactly (do not restructure the dialog); when the portal exists, the control is absent.

- [ ] **Step 5: i18n**

`lang/en.json`: in the `sheettype` block add `"campaign": "Campaign",`; in the `hub` block add `"restorePortal": "Restore campaign entry",`.

- [ ] **Step 6: Verify**

Run: `npx vitest run` — Expected: 567 passed (extend `missingSheetRegistrations`' unit tests per Step 2 — if that adds tests, state the new exact total in your report and carry it forward).
Run: `node --input-type=module --check < scripts/apps/CampaignHubPage.mjs && node --input-type=module --check < scripts/integrations/mej-adapter.mjs && echo OK` — Expected: OK.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('ok')"` — Expected: ok.

- [ ] **Step 7: Commit**

```bash
git add scripts/integrations/mej-adapter.mjs scripts/apps/CampaignHubPage.mjs lang/en.json scripts/logic/ test/
git commit -m "feat: portal sheet routes to the scoped Hub in both modes; restore control"
```

---

### Task 4: Folder context menu

**Files:**
- Create: `scripts/hooks/folder-context.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (`registerCore`: one new step)
- Modify: `lang/en.json` (`hub.openCampaignHub`)

**Interfaces:**
- Consumes: `isCampaignFolder` (logic/campaigns.mjs), `openHub` (integrations/mej-adapter.mjs), `HUB_CAMPAIGN_SCOPE_SETTING`, module-level `HUB_STATE` via a small exported setter — add `export function setHubScope(campaignId)` to `CampaignHubPage.mjs` that sets `HUB_STATE.campaignId = campaignId` (dynamic-imported here to avoid load-order issues).
- Produces: an "Open Campaign Hub" context-menu entry on campaign folders in BOTH the core journal sidebar and MEJ's shell sidebar.

- [ ] **Step 1: Implement**

Create `scripts/hooks/folder-context.mjs`:

```js
// "Open Campaign Hub" on campaign folders (spec C §2). Two hook names,
// one handler: Foundry v13/v14's core JournalDirectory fires the
// class-suffixed "getFolderContextOptions{Class}" chain
// (ApplicationV2.#callHooks appends "{}" when parentClassHooks is true -
// verified against client/applications/api/application.mjs and
// client/applications/sidebar/document-directory.mjs), while MEJ's shell
// sidebar recreates the menu with hookName "getFolderContextOptions" and
// parentClassHooks: false, which fires the BARE name once
// (enhanced-journal.js's activateListeners). Registering both covers both
// surfaces; they never fire for the same menu instance.
import { MODULE_ID, I18N, HUB_CAMPAIGN_SCOPE_SETTING } from "../constants.mjs";
import { isCampaignFolder } from "../logic/campaigns.mjs";

function folderFromHeader(header) {
  const el = header instanceof HTMLElement ? header : header?.[0];
  const id = el?.closest("[data-folder-id]")?.dataset.folderId
    ?? el?.closest("[data-uuid]")?.dataset.uuid?.split(".").pop();
  return id ? game.folders.get(id) ?? null : null;
}

function addOption(options) {
  if (options.some((o) => o?.name === `${I18N}.hub.openCampaignHub`)) return;
  options.push({
    name: `${I18N}.hub.openCampaignHub`,
    icon: '<i class="fa-solid fa-timeline"></i>',
    condition: (header) => isCampaignFolder(folderFromHeader(header)),
    callback: async (header) => {
      const folder = folderFromHeader(header);
      if (!folder) return;
      const [{ setHubScope }, { openHub }] = await Promise.all([
        import("../apps/CampaignHubPage.mjs"),
        import("../integrations/mej-adapter.mjs")
      ]);
      setHubScope(folder.id);
      await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, folder.id);
      await openHub();
    }
  });
}

export function registerFolderContext() {
  Hooks.on("getFolderContextOptions", (app, options) => addOption(options));
  Hooks.on("getFolderContextOptionsJournalDirectory", (app, options) => addOption(options));
}
```

Add to `CampaignHubPage.mjs` (module level, beside `showGraphFor`):

```js
/** Set the Hub's campaign scope without opening it (folder context menu, spec C §2). */
export function setHubScope(campaignId) {
  HUB_STATE.campaignId = campaignId;
}
```

Register in `registerCore()`:

```js
  await step("folder context menu", async () => {
    const { registerFolderContext } = await import("../hooks/folder-context.mjs");
    registerFolderContext();
  });
```

`lang/en.json` `hub` block: `"openCampaignHub": "Open Campaign Hub",`.

- [ ] **Step 2: Verify**

Run: `npx vitest run` — Expected: same count as Task 3's end state.
Run: `node --input-type=module --check < scripts/hooks/folder-context.mjs && echo OK` — Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add scripts/hooks/folder-context.mjs scripts/apps/CampaignHubPage.mjs scripts/integrations/mej-adapter.mjs lang/en.json
git commit -m "feat: Open Campaign Hub folder context-menu entry (core + shell sidebars)"
```

---

### Task 5: E2E — live verification

**Files:**
- Create: `tests/e2e/15-campaign-portal.spec.mjs`
- Modify: `tests/e2e/14-campaigns.spec.mjs` (fixtures/cleanup that now see portals; assertions counting campaign-folder contents)
- Possibly modify: other suites whose campaign fixtures assert folder contents — grep and sweep.

**Interfaces:**
- Consumes: Tasks 1-4 live behavior; the harness auto-pins the module symlink per run (global-setup) — still verify with readlink at the end.
- Produces: the live gate for the branch.

- [ ] **Step 1: Sweep existing suites**

Portals are now auto-created by `createCampaign` and by campaign-flagged `Folder.create` fixtures? NO — fixtures that create flagged folders via raw `Folder.create` get NO portal (only `createCampaign()` and the migration create portals). Grep `tests/e2e/*.spec.mjs` for both patterns: (a) UI-driven "New Campaign" flows now produce a folder + portal — any assertion counting the folder's contents or the world's journal count must account for the portal, and id-tracked cleanup must delete it (folder-cascade cleanup already does; entry-list cleanups must add it); (b) raw `Folder.create`-flagged fixtures are unchanged (no portal) — leave them. Run the four campaign-touching suites after the sweep (Step 4) to prove it.

- [ ] **Step 2: New spec `tests/e2e/15-campaign-portal.spec.mjs`**

Follow 14-campaigns.spec.mjs's imports/helpers (login, TT_PREFIX, settle, trackConsoleErrors, cleanup patterns, its hub-open helper). Scenarios (each with id-tracked cleanup and scope reset to `""`):

```js
  test("1. creating a campaign creates its portal; opening the portal lands on the scoped Hub", async ({ page }) => {
    // GM: create TT-PortalCamp via the picker "__new" flow (or createCampaign API - use the API for determinism):
    //   const folderId = await page.evaluate(async (p) => (await game.modules.get("mej-campaign-companion") , (await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs")).createCampaign(`${p}PortalCamp`)).then(f => f.id), TT_PREFIX);
    // Assert: exactly one portal entry named TT-PortalCamp in the folder, page type "mej-campaign-companion.campaign", ownership.default === OBSERVER (the default baseline).
    // Open it: await page.evaluate((id) => game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)), portalId);
    // Assert: the Hub renders (.mej-cc-hub-header visible) and select[name="campaign-scope"] value === folderId.
  });

  test("2. rename syncs both ways", async ({ page }) => {
    // Rename the folder via API -> settle -> portal entry name follows (and its page name).
    // Rename the portal entry via API -> settle -> folder name follows.
  });

  test("3. deleting the portal leaves the campaign; restore recreates it", async ({ page }) => {
    // Delete portal entry by id -> campaign folder still flagged, Hub still scopes to it.
    // Open campaign settings (editCampaign) -> click the restore control -> portal exists again.
  });

  test("4. folder context menu opens the scoped Hub", async ({ page }) => {
    // In the core journal sidebar (ui.sidebar journal tab), right-click the TT campaign folder header,
    // click "Open Campaign Hub", assert Hub open + scope select === folder id.
  });

  test("5. portals are absent from Hub index rows in every scope", async ({ page }) => {
    // With the campaign scoped: no li.mej-cc-index-row with the portal's name-as-portal (the campaign name
    // will match the folder-derived rows only if other members share it - create a distinctly named member
    // to keep the assertion crisp: assert row count for the campaign name === 0 while the member's row === 1).
    // In All and Unfiled scopes: same absence.
  });

  test("6. migration backfills a portal for a legacy campaign", async ({ page }) => {
    // Seed a flagged folder WITHOUT a portal via raw Folder.create; set the dataVersion setting back to 1
    //   await page.evaluate(() => game.settings.set("mej-campaign-companion", "dataVersion", 1));
    // Reload the page (await page.reload() + login-session persists) so the ready hook runs the migration;
    // assert the portal now exists; assert dataVersion === 2. Restore: delete fixtures, dataVersion stays 2.
  });
```

Write these as REAL tests — the comments above are the scenario contract; every assertion named in them must exist in code. Where a UI affordance is awkward (context menu invocation), drive the DOM directly (`page.locator(...).click({ button: "right" })` on the folder header, then click the menu entry by its localized text "Open Campaign Hub").

- [ ] **Step 3: Player-seat scenario**

```js
  test("7. player seat: portal opens the scoped read view; no restore control", async ({ browser }) => {
    // Second context, login "User 1" (pattern from 14-campaigns scenario 8).
    // GM pre-creates a campaign (baseline observer) via API in a GM context first.
    // Player opens the portal entry -> Hub renders scoped; no .mej-cc-edit-campaign pencil; Tools shows only the Guide.
    // Cleanup from the GM context.
  });
```

- [ ] **Step 4: Run**

```bash
npx playwright test tests/e2e/15-campaign-portal.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/05-docx-import.spec.mjs tests/e2e/08-query-graph.spec.mjs --trace off --reporter=line
```

Expected: all passed (the harness pins the symlink to this worktree per-run). If scenario 1's portal-open lands somewhere other than the Hub, that is a routing bug (Task 3), not a test problem — report BLOCKED with the DOM evidence rather than weakening.
Afterward: `readlink ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion` — Expected: the MAIN checkout path (harness teardown restored it).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/
git commit -m "test: e2e for campaign portals - lifecycle, routing, context menu, migration, player seat"
```
