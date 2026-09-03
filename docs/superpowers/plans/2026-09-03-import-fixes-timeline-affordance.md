# Import Fixes + Timeline Journal Affordance (0.16.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the docx import wizard's redundant subfolder and dropped standalone pictures, and make a campaign's "— Timeline" journal open the Hub's Timeline tab (with a distinct sidebar icon) instead of an empty generic editor.

**Architecture:** Two pure-logic fixes (`subfolderApplies`, media-aware `splitSections`) with the wizard/UI following them; then a registered-but-not-default `JournalEntry` sheet class that never draws and hands off to the Hub, stamped onto timeline journals via `flags.core.sheetClass` (creation paths + a dataVersion-5 migration), an `openJournalEntry` hook so MEJ falls through to that sheet, and a `renderJournalDirectory`/`renderEnhancedJournal` hook that swaps the row icon.

**Tech Stack:** Foundry VTT 13/14 (ApplicationV2, DocumentSheetConfig, Hooks), Monk's Enhanced Journal 13.06+ (api + native modes), vitest + jsdom (unit), Playwright (e2e against `~/FoundryVTT-14` World A, port 30000).

**Spec:** `docs/superpowers/specs/2026-09-03-import-fixes-timeline-affordance-design.md` (commit 331497c)

## Global Constraints

- Companion-only: no file under `monks-enhanced-journal` changes. MEJ line numbers below are read-only references to `/Users/danbularzik/Claude/Projects/monks-enhanced-journal/monks-enhanced-journal.js`.
- Work in `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/import-fixes`, branch `feat/import-fixes`, base `main` @ f7cc911. Never push to `main`, never force-push, never merge.
- `TIMELINE_SHEET_CLASS` is exactly `"mej-campaign-companion.TimelineJournalSheet"`; `CURRENT_DATA_VERSION` becomes exactly `5`; `module.json` version becomes exactly `0.16.0`.
- New i18n key `MEJCampaignCompanion.sheettype.timelineJournal` = `"Campaign Timeline (opens the Hub)"`.
- `scripts/sheets/TimelineJournalSheet.mjs` and `scripts/hooks/*.mjs` must NOT statically import `scripts/apps/CampaignHubPage.mjs` (it statically imports MEJ's `EnhancedJournalSheet.js`, which must not load before MEJ's own script — see `campaign-companion.mjs` header). Use `await import("../apps/CampaignHubPage.mjs")` inside the function body.
- E2E: World A on `~/FoundryVTT-14` is the user's REAL world. Every fixture name starts with `TT-`; delete only ids the test itself created (never by name); restore every setting the test changes. Run with `--trace off`. Respect the e2e lock (`<FOUNDRY_DATA>/.claude-e2e-lock`: wait if held; never `npm run e2e:unlock`). No `retries`, no bare `page.waitForTimeout` in new test code (`settle()` from the helpers only where existing specs already use it, i.e. right after `reloadGame`).
- Foundry must be running for e2e: `curl -s localhost:30000/api/status` returns JSON; if not, `bash ~/FoundryVTT-14/start-foundry.command` and wait for it.
- Commit after every task with a conventional message; never commit `.DS_Store` or screenshots.

---

### Task 1: Subfolder only for existing campaigns

**Files:**
- Modify: `scripts/logic/campaigns.mjs` (after `resolveDestinationId`, ~line 82)
- Modify: `scripts/apps/import-wizard.mjs:19` (import), `:210-236` (`_onRender`), `:506-534` (`#onCreate` destination block)
- Modify: `docs/gm-guide.md:255`
- Modify: `tests/e2e/05-docx-import.spec.mjs:177-192`
- Test: `test/campaigns.test.js`

**Interfaces:**
- Produces: `subfolderApplies(destinationId: string) => boolean` exported from `scripts/logic/campaigns.mjs`.

- [ ] **Step 1: Write the failing unit test**

Append to `test/campaigns.test.js`, inside the outer `describe("campaigns module", ...)` block (before its closing `});`):

```js
  describe("subfolderApplies", () => {
    it("is false for the New Campaign… sentinel and true for any folder id", async () => {
      const { subfolderApplies } = await import("../scripts/logic/campaigns.mjs");
      expect(subfolderApplies("__new")).toBe(false);
      expect(subfolderApplies("abc123")).toBe(true);
      expect(subfolderApplies("")).toBe(true);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/campaigns.test.js -t subfolderApplies`
Expected: FAIL — `subfolderApplies is not a function`.

- [ ] **Step 3: Add the helper**

In `scripts/logic/campaigns.mjs`, directly after `resolveDestinationId` (ends ~line 81):

```js
/**
 * The import wizard's "Create a subfolder named after the document" option
 * applies only when filing into an EXISTING folder. On the "__new" path the
 * freshly created campaign folder is already named after the document, so a
 * subfolder would just nest a second identically named folder inside it.
 */
export function subfolderApplies(destinationId) {
  return destinationId !== "__new";
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run test/campaigns.test.js`
Expected: PASS (all).

- [ ] **Step 5: Wire the wizard**

`scripts/apps/import-wizard.mjs` line 19 becomes:

```js
import { campaignOfFolder, destinationFolderOptions, resolveDestinationId, subfolderApplies } from "../logic/campaigns.mjs";
```

In `_onRender`, replace the `if (form) { ... }` block (lines 225-235) with:

```js
    if (form) {
      // The subfolder option only applies to an existing destination: on
      // "__new" the campaign folder created below is already named after the
      // document (logic/campaigns.mjs subfolderApplies). Disable, don't
      // uncheck, so the GM's choice survives switching back to a real folder.
      const syncSubfolder = () => {
        if (form.elements.subfolder && form.elements.destination) {
          form.elements.subfolder.disabled = !subfolderApplies(form.elements.destination.value);
        }
      };
      form.elements.destination?.addEventListener("change", () => {
        this.state.destination = form.elements.destination.value;
        syncSubfolder();
      });
      form.elements.subfolder?.addEventListener("change", () => {
        this.state.subfolder = form.elements.subfolder.checked;
      });
      form.elements.audience?.addEventListener("change", () => {
        this.state.audience = form.elements.audience.value;
      });
      syncSubfolder();
    }
```

In `#onCreate`, replace the comment + `target.disabled = true;` (lines 506-512) and the subfolder branch (531-534) so the block reads:

```js
    // Disabled up front, not just around the create loop further down: the
    // destination resolution immediately below is itself a single-shot side
    // effect (it can create a campaign Folder and, for an existing
    // destination with "subfolder" checked, a Folder inside it) - a second
    // click landing mid-await here would otherwise create duplicate
    // campaigns/subfolders rather than just duplicate pages.
    target.disabled = true;

    let campaign, targetFolderId;
    try {
      const dest = this.#formDestination();
      // The chosen option may be a campaign folder or a subfolder inside one
      // (see #destinationOptions); the governing campaign - which decides the
      // timeline journal and the "Campaign default" audience baseline below -
      // is the nearest flagged ancestor. A stale/non-campaign pick (folder
      // deleted or re-parented mid-wizard) degrades to the "__new" path
      // rather than filing entries outside any campaign.
      let chosen = dest.folderId !== "__new" ? game.folders.get(dest.folderId) ?? null : null;
      campaign = campaignOfFolder(chosen);
      if (!campaign) {
        chosen = null;
        campaign = await createCampaign(this.state.docTitle || game.i18n.localize(`${I18N}.import.title`));
      }
      if (!campaign) throw new Error("createCampaign returned null (not GM?)");
      targetFolderId = chosen?.id ?? campaign.id;
      // Only an EXISTING destination gets the subfolder: a campaign created
      // just above is itself the folder named after the document (spec A).
      if (dest.subfolder && chosen) {
        const sub = await Folder.create({ name: this.state.docTitle || campaign.name, type: "JournalEntry", folder: targetFolderId });
        targetFolderId = sub.id;
      }
    } catch (error) {
```

Note `#formDestination` (line ~301) reads `form?.elements.subfolder?.checked !== false` — a disabled checkbox still reports `checked`, which is why the `chosen` guard is the authority, not the form.

- [ ] **Step 6: Update the GM guide**

`docs/gm-guide.md` line 255 becomes:

```markdown
   - **Create a subfolder named after the document**, checked by default. It only applies when importing into an existing campaign — with **New Campaign…** selected it's greyed out, because the new campaign's folder is already named after the document.
```

- [ ] **Step 7: Update the e2e expectations**

In `tests/e2e/05-docx-import.spec.mjs`, after line 177 (`selectOption("__new")`) add:

```js
    // Spec 2026-09-03 A: the subfolder option is inapplicable for a new
    // campaign (its folder is already named after the document) - greyed
    // out here, re-enabled the moment an existing folder is picked.
    await expect(wizard.locator('input[name="subfolder"]')).toBeDisabled();
    const existingOption = await wizard.locator('select[name="destination"] option:not([value="__new"])').first().getAttribute("value");
    if (existingOption) {
      await wizard.locator('select[name="destination"]').selectOption(existingOption);
      await expect(wizard.locator('input[name="subfolder"]')).toBeEnabled();
      await wizard.locator('select[name="destination"]').selectOption("__new");
      await expect(wizard.locator('input[name="subfolder"]')).toBeDisabled();
    }
```

After line 192 (the `createdCampaignFolderIds = ...` assignment) add:

```js
    // No nested subfolder for a "__new" import: the campaign folder IS the
    // document folder, so it has no child folders and the imported entries
    // sit directly inside it.
    const folderShape = await page.evaluate((ids) => ({
      childFolders: game.folders.filter((f) => ids.includes(f.folder?.id)).length,
      directEntries: game.journal.filter((j) => ids.includes(j.folder?.id)).length
    }), createdCampaignFolderIds);
    expect(createdCampaignFolderIds).toHaveLength(1);
    expect(folderShape.childFolders).toBe(0);
    expect(folderShape.directEntries).toBeGreaterThan(10);
```

And in the `summary` evaluate (line ~223-225) the `intro` lookup no longer needs the grandparent clause; leave it — it still matches (`j.folder?.id`), and the extra clause is harmless.

- [ ] **Step 8: Commit** (the e2e run happens in Task 2 together with the image assertion)

```bash
git add scripts/logic/campaigns.mjs scripts/apps/import-wizard.mjs docs/gm-guide.md test/campaigns.test.js tests/e2e/05-docx-import.spec.mjs
git commit -m "fix(import): create the subfolder only for an existing destination; grey it out for New Campaign…"
```

---

### Task 2: Keep picture-only paragraphs through section splitting

**Files:**
- Modify: `scripts/logic/doc-import.mjs:68-72` (helpers) and `:157` (`splitSections` filter)
- Modify: `tests/e2e/05-docx-import.spec.mjs` (summary evaluate, ~line 227-238 and the expects after it)
- Test: `test/doc-import.test.js`

**Interfaces:**
- Consumes: nothing new. `uploadInlineImages` (`scripts/apps/import-upload.mjs`) already uploads any `img[src^="data:"]` it is handed.

- [ ] **Step 1: Write the failing unit test**

Append to the `describe("splitSections", ...)` block in `test/doc-import.test.js`:

```js
  it("keeps picture-only paragraphs (mammoth emits standalone images as <p><img></p>) and still drops empty ones", () => {
    const { sections } = splitSections(body(`
      <h1>Doc</h1>
      <h2>Gallery</h2>
      <p><img src="data:image/png;base64,AA==" alt="map"></p>
      <p>   </p>
      <p>Caption text.</p>`));
    expect(sections).toHaveLength(1);
    expect(sections[0].blocks).toHaveLength(2);
    expect(sections[0].blocks[0]).toContain('<img src="data:image/png;base64,AA=="');
    expect(sections[0].html).toContain("<img");
    expect(sections[0].wordCount).toBe(2);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/doc-import.test.js -t "picture-only"`
Expected: FAIL — `expected 1 to be 2` on `blocks` length (the image paragraph was filtered out).

- [ ] **Step 3: Make `splitSections` media-aware**

In `scripts/logic/doc-import.mjs`, directly after `isWhitespaceOnly` (line 72) add:

```js
/** Elements that carry content even with no text: tables, and anything holding inline media (mammoth emits each standalone picture as <p><img></p>). */
const MEDIA_SELECTOR = "img, video, audio";
function keepsMedia(el) {
  return el.tagName === "TABLE" || !!el.querySelector(MEDIA_SELECTOR);
}
```

and change line 157 to:

```js
  const nodes = [...root.children].filter((el) => !isWhitespaceOnly(el) || keepsMedia(el));
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `npx vitest run test/doc-import.test.js`
Expected: PASS (all; the pre-existing whitespace/table cases still hold).

- [ ] **Step 5: Add the e2e image assertion**

In `tests/e2e/05-docx-import.spec.mjs`, inside the `summary` evaluate's returned object (after `timepointLabels: ...`, line ~236) add:

```js
        // Spec 2026-09-03 B: standalone pictures survive splitting and are
        // uploaded under worlds/<id>/mej-campaign-companion/ by the wizard.
        pagesWithUploadedImages: game.journal
          .filter((j) => campaignFolderIds.includes(j.folder?.id))
          .flatMap((j) => j.pages.contents)
          .filter((p) => /<img [^>]*src="worlds\//.test(p.text?.content ?? "")).length,
        pagesWithDataUriImages: game.journal
          .filter((j) => campaignFolderIds.includes(j.folder?.id))
          .flatMap((j) => j.pages.contents)
          .filter((p) => /<img [^>]*src="data:/.test(p.text?.content ?? "")).length
```

and after `expect(summary.timepointLabels.some(...)).toBe(true);` (line ~251) add:

```js
    // Radiant Citadel.docx carries 27 inline pictures, 17 of them in
    // picture-only paragraphs that used to be dropped before upload.
    expect(summary.pagesWithUploadedImages).toBeGreaterThan(0);
    expect(summary.pagesWithDataUriImages).toBe(0);
```

- [ ] **Step 6: Run the import e2e**

Check the lock first: `ls ~/FoundryVTT-14/Data/.claude-e2e-lock 2>/dev/null` — if present, wait and re-check; never unlock. Then:

Run: `npx playwright test tests/e2e/05-docx-import.spec.mjs --trace off`
Expected: PASS. If `pagesWithUploadedImages` is 0 while `pagesWithDataUriImages` is 0 too, the images are being removed by `uploadInlineImages` on upload failure — read the browser console line `inline image upload failed` in the Playwright output and fix the upload path (`IMPORT_MEDIA_DIR()` must be creatable under `worlds/<world-id>/`), don't loosen the assertion.

Note the uploaded files land in `~/FoundryVTT-14/Data/Data/worlds/world-a/mej-campaign-companion/import-*.{png,jpg}`; they are small, but list them at the end so the user can delete them if desired (the test's cleanup deletes documents, not files).

- [ ] **Step 7: Commit**

```bash
git add scripts/logic/doc-import.mjs test/doc-import.test.js tests/e2e/05-docx-import.spec.mjs
git commit -m "fix(import): keep picture-only paragraphs so standalone images reach the upload pass"
```

---

### Task 3: Hub hand-off — `openTimelineInHub` + `pendingTimelineId`

**Files:**
- Modify: `scripts/apps/CampaignHubPage.mjs:70-93` (`HUB_STATE`), `:403-416` (`#timelineSelection`), after `showGraphFor` (~line 1885)

**Interfaces:**
- Consumes: `HUB_STATE`, `openHub()` from `../integrations/mej-adapter.mjs`, `campaignIdOf`/`isTimelineJournal` (already imported at line 21), `HUB_CAMPAIGN_SCOPE_SETTING`/`HUB_TIMELINE_SELECTION_SETTING` (already imported at line 18).
- Produces: `export async function openTimelineInHub(journal: JournalEntry): Promise<void>` from `scripts/apps/CampaignHubPage.mjs`. Task 4's sheet calls it via dynamic import.

No pure unit is extractable here (every line touches `game`/`HUB_STATE`); Task 4's e2e is the test for this task.

- [ ] **Step 1: Add the pending field**

In `HUB_STATE` (line ~81), after `pendingTab: null,` add:

```js
  // Timeline id handed over by openTimelineInHub (sidebar/link open of a
  // timeline journal). Consumed by #timelineSelection on the next render,
  // so an ALREADY-OPEN Hub whose state.timelineId was seeded earlier
  // switches too, instead of only a fresh instance reading the setting.
  pendingTimelineId: null,
```

- [ ] **Step 2: Consume it in `#timelineSelection`**

Replace the method (lines ~403-416) with:

```js
  /** Lazily seeded from the client setting; a stale/invisible id resets to "" (same discipline as #scope). A pending hand-off (openTimelineInHub) wins over both. */
  #timelineSelection() {
    if (HUB_STATE.pendingTimelineId) {
      this.state.timelineId = HUB_STATE.pendingTimelineId;
      HUB_STATE.pendingTimelineId = null;
    }
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
```

(`isVisibleToUser` is already imported at line 31 from `../logic/hub-index.mjs`.)

- [ ] **Step 3: Add the entry point**

Directly after `showGraphFor` (the function that ends with `HUB_STATE.pendingTab = "graph"; ... await openHub();` — read it to find its closing brace) add:

```js
/**
 * Sidebar/link entry point (spec 2026-09-03 §C): open the Hub on the
 * Timeline tab showing `journal`. A campaign timeline re-scopes the Hub to
 * its campaign first (same persistence as showGraphFor); a world timeline
 * leaves the scope alone - the explicit selection setting names it.
 */
export async function openTimelineInHub(journal) {
  if (!journal || !isTimelineJournal(journal)) return;
  const cid = campaignIdOf(journal);
  if (cid) {
    HUB_STATE.campaignId = cid;
    await game.settings.set(MODULE_ID, HUB_CAMPAIGN_SCOPE_SETTING, cid);
  }
  await game.settings.set(MODULE_ID, HUB_TIMELINE_SELECTION_SETTING, journal.id);
  HUB_STATE.pendingTimelineId = journal.id;
  HUB_STATE.pendingTab = "timeline";
  await openHub();
}
```

`openHub` is already statically imported at line 45 (`import { mejType, openHub } from "../integrations/mej-adapter.mjs";`), the same way `showGraphFor` uses it.

- [ ] **Step 4: Syntax check and unit suite**

Run: `node --check scripts/apps/CampaignHubPage.mjs && npx vitest run`
Expected: `node --check` exits 0 (the `/modules/...` import is only resolved in the browser, `--check` parses only); vitest all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/CampaignHubPage.mjs
git commit -m "feat(hub): openTimelineInHub hand-off with a pending timeline selection"
```

---

### Task 4: Redirect sheet, registration, stamping, MEJ fall-through, e2e

**Files:**
- Modify: `scripts/constants.mjs` (after `HUB_PAGE_ID`, line 28)
- Modify: `lang/en.json:32-36` (`sheettype`)
- Create: `scripts/sheets/TimelineJournalSheet.mjs`
- Create: `scripts/hooks/timeline-open.mjs`
- Modify: `scripts/integrations/mej-adapter.mjs` (`registerCore`, after the "portal rename sync" step, ~line 118)
- Modify: `scripts/data/timeline-journal.mjs:1` (import), `:60-70` (`createTimeline`), `:85-89` (legacy branch)
- Modify: `scripts/campaign-companion.mjs` (`Hooks.once("init")`, next to `registerFolderContext()` line 134, and its import block)
- Create: `tests/e2e/20-timeline-journal-open.spec.mjs`

**Interfaces:**
- Consumes: `openTimelineInHub(journal)` from Task 3.
- Produces: `TIMELINE_SHEET_CLASS` constant; `TimelineJournalSheet` class; `registerTimelineOpen()`; timeline journals created from now on carry `flags.core.sheetClass === TIMELINE_SHEET_CLASS`. Task 5 (migration) and Task 6 (icon) build on these.

- [ ] **Step 1: Write the failing e2e (api mode, GM + player)**

Create `tests/e2e/20-timeline-journal-open.spec.mjs`:

```js
// Timeline journal affordance (spec 2026-09-03 §C/§D): opening a campaign's
// "<name> — Timeline" journal - sidebar click, sheet.render(), player or GM,
// api or native mode - opens the Hub on its Timeline tab with that timeline
// selected and never shows the generic JournalEntry editor. Fixtures are a
// single TT- campaign created by createCampaign() and deleted by id in
// afterAll (folder cascade covers the portal and the timeline journal).
import { test, expect } from "@playwright/test";
import {
  login, settle, reloadGame, withGmPage, trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const RUN = Date.now().toString(36).slice(-5);
const CAMPAIGN_NAME = `TT-TLOPEN ${RUN}`;
const CAMPAIGN_STORE_MOD = "/modules/mej-campaign-companion/scripts/data/campaign-store.mjs";
const TIMELINE_JOURNAL_MOD = "/modules/mej-campaign-companion/scripts/data/timeline-journal.mjs";
const SHEET_CLASS = "mej-campaign-companion.TimelineJournalSheet";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

let campaignId = null;
let timelineId = null;

async function createFixture(page) {
  const created = await page.evaluate(async ({ storeMod, tlMod, name }) => {
    const { createCampaign } = await import(storeMod);
    const { ensureTimelineJournal } = await import(tlMod);
    const campaign = await createCampaign(name, { ownershipDefault: "observer" });
    const timeline = await ensureTimelineJournal(campaign);
    return { campaignId: campaign.id, timelineId: timeline.id, sheetClass: timeline.getFlag("core", "sheetClass") };
  }, { storeMod: CAMPAIGN_STORE_MOD, tlMod: TIMELINE_JOURNAL_MOD, name: CAMPAIGN_NAME });
  campaignId = created.campaignId;
  timelineId = created.timelineId;
  return created;
}

/** Click the real sidebar row's action anchor in-page (see 13-stock-smoke for why not locator.click()). */
async function clickSidebarRow(page, id) {
  await page.evaluate(async () => { await ui.journal.activate(); });
  const row = page.locator(`#journal .directory-item[data-entry-id="${id}"]`).first();
  await expect(row).toHaveCount(1);
  await row.evaluate((el) => el.querySelector("a.entry-name").click());
}

/** Where the Hub is (shell subsheet in api mode, standalone window in native), which tab is active, what the picker shows, and whether any sheet for `id` rendered. */
async function hubState(page, id) {
  return page.evaluate((journalId) => {
    const shell = game.MonksEnhancedJournal?.journal;
    const shellHub = shell?.rendered && shell.subsheet?.constructor?.name === "CampaignHubPage" ? shell.element : null;
    const root = shellHub ?? document.querySelector('[id^="CampaignHubPage-"]');
    const hub = root?.querySelector(".mej-cc-hub") ?? null;
    const journalSheets = [...foundry.applications.instances.values()]
      .filter((a) => a.rendered && a.document?.id === journalId)
      .map((a) => a.constructor.name);
    return {
      hubOpen: !!hub,
      viaShell: !!shellHub,
      activeTab: hub?.querySelector("div.tab.active")?.dataset?.tab ?? null,
      picker: hub?.querySelector("select.mej-cc-timeline-select")?.value ?? null,
      journalSheets
    };
  }, id);
}

async function expectHubOnTimeline(page, id) {
  await expect.poll(async () => (await hubState(page, id)).activeTab, { timeout: 15_000 }).toBe("timeline");
  const state = await hubState(page, id);
  expect(state.hubOpen).toBe(true);
  expect(state.picker).toBe(id);
  expect(state.journalSheets).toEqual([]);
  return state;
}

test.describe("20 timeline journal open", () => {
  test.describe.configure({ mode: "serial" });

  let scopeBefore = null;
  let selectionBefore = null;

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (page) => {
      await page.evaluate(async ({ cid, scope, selection }) => {
        await game.settings.set("mej-campaign-companion", "forceNativeMode", false);
        if (scope !== null) await game.settings.set("mej-campaign-companion", "hubCampaignScope", scope);
        if (selection !== null) await game.settings.set("mej-campaign-companion", "hubTimelineSelection", selection);
        const f = cid ? game.folders.get(cid) : null;
        if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
      }, { cid: campaignId, scope: scopeBefore, selection: selectionBefore });
    });
  });

  test("1. a new timeline journal is stamped with the redirect sheet class", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    [scopeBefore, selectionBefore] = await page.evaluate(() => [
      game.settings.get("mej-campaign-companion", "hubCampaignScope"),
      game.settings.get("mej-campaign-companion", "hubTimelineSelection")
    ]);
    const created = await createFixture(page);
    expect(created.sheetClass).toBe(SHEET_CLASS);
    assertNoConsoleErrors(errors);
  });

  test("2. api mode: sidebar click opens the Hub on that timeline, no journal editor", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await clickSidebarRow(page, timelineId);
    const state = await expectHubOnTimeline(page, timelineId);
    expect(state.viaShell).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("3. api mode: sheet.render(true) (content links, fromUuid) takes the same route", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await page.evaluate(async (id) => {
      const journal = game.journal.get(id);
      await journal.sheet.render(true);
    }, timelineId);
    await expectHubOnTimeline(page, timelineId);
    assertNoConsoleErrors(errors);
  });

  test("4. a player who can see the journal gets the Hub too", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    await clickSidebarRow(page, timelineId);
    await expectHubOnTimeline(page, timelineId);
    assertNoConsoleErrors(errors);
  });
});
```

`hubCampaignScope` / `hubTimelineSelection` / `forceNativeMode` are the setting keys behind `HUB_CAMPAIGN_SCOPE_SETTING` (constants.mjs:86) / `HUB_TIMELINE_SELECTION_SETTING` (:92) / `FORCE_NATIVE_MODE_SETTING` (:47).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off`
Expected: test 1 FAILS (`sheetClass` is `undefined`); the rest fail on `activeTab` (the shell opens the journal, not the Hub).

- [ ] **Step 3: Constant and i18n**

`scripts/constants.mjs`, after line 28 (`HUB_PAGE_ID`):

```js
/** flags.core.sheetClass value that routes a timeline journal's open to the Hub (scope.ClassName, DocumentSheetConfig's key format). */
export const TIMELINE_SHEET_CLASS = "mej-campaign-companion.TimelineJournalSheet";
```

`lang/en.json` `sheettype` block becomes:

```json
    "sheettype": {
      "session": "Session",
      "campaign": "Campaign",
      "media": "Media (Enhanced Journal)",
      "timelineJournal": "Campaign Timeline (opens the Hub)"
    },
```

- [ ] **Step 4: The redirect sheet**

Create `scripts/sheets/TimelineJournalSheet.mjs`:

```js
// The JournalEntry sheet a timeline journal is stamped with
// (flags.core.sheetClass = TIMELINE_SHEET_CLASS, constants.mjs). It never
// draws: a timeline journal is a page-less data holder, and the thing to
// LOOK at is the Hub's Timeline tab - so every open (sidebar row, @UUID
// link, entry.sheet.render(true), MEJ's fall-through after
// hooks/timeline-open.mjs returns false) hands off there. `rendered` stays
// false, so Foundry's open handlers treat every click as a fresh open.
//
// CampaignHubPage.mjs statically imports MEJ's EnhancedJournalSheet.js, so
// it is imported lazily here (same reason as hooks/folder-context.mjs).
const { ApplicationV2 } = foundry.applications.api;

export class TimelineJournalSheet extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "mej-cc-timeline-redirect-{id}",
    window: { frame: false }
  };

  constructor(options = {}) {
    super(options);
    this.document = options.document;
  }

  async render() {
    const { openTimelineInHub } = await import("../apps/CampaignHubPage.mjs");
    await openTimelineInHub(this.document);
    return this;
  }

  async close() {
    return this;
  }
}
```

- [ ] **Step 5: Register it in both modes**

`scripts/integrations/mej-adapter.mjs`, inside `registerCore()` after the `"portal rename sync"` step:

```js
  // Timeline journals open the Hub (spec 2026-09-03 §C). Registered but
  // never default: only documents carrying flags.core.sheetClass ===
  // TIMELINE_SHEET_CLASS resolve to it (data/timeline-journal.mjs stamps
  // creations; campaign-companion.mjs's v5 migration stamps older ones).
  await step("timeline redirect sheet", async () => {
    const { TimelineJournalSheet } = await import("../sheets/TimelineJournalSheet.mjs");
    foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntry, MODULE_ID, TimelineJournalSheet, {
      types: ["base"], makeDefault: false, label: `${I18N}.sheettype.timelineJournal`
    });
  });
```

`I18N` and `MODULE_ID` are already imported from `../constants.mjs` at lines 6-10 of this file.

- [ ] **Step 6: Stamp new timeline journals**

`scripts/data/timeline-journal.mjs` line 1 becomes:

```js
import { MODULE_ID, TIMELINE_JOURNAL_SETTING, CAMPAIGN_FLAG, DEFAULT_TIMELINE_KEY, TIMELINE_SHEET_CLASS } from "../constants.mjs";
```

`createTimeline` becomes:

```js
export async function createTimeline({ campaign = null, name }) {
  if (!game.user.isGM) return null;
  return JournalEntry.create({
    name,
    ...(campaign ? { folder: campaign.id } : {}),
    flags: {
      [MODULE_ID]: { timeline: { timepoints: [] } },
      core: { sheetClass: TIMELINE_SHEET_CLASS }
    },
    ownership: {
      default: campaign ? baselineOwnership(campaign) : CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    }
  });
}
```

and the legacy branch of `ensureTimelineJournal`:

```js
  const created = await JournalEntry.create({
    name: "Campaign Timeline",
    flags: {
      [MODULE_ID]: { timeline: { timepoints: [] } },
      core: { sheetClass: TIMELINE_SHEET_CLASS }
    },
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
  });
```

- [ ] **Step 7: MEJ fall-through hook**

Create `scripts/hooks/timeline-open.mjs`:

```js
// MEJ's openJournalEntry (monks-enhanced-journal.js ~2527) runs
// Hooks.call("openJournalEntry", doc, options, userId) and treats a `false`
// return as "don't open this in the shell"; its callers then fall back to
// entry.sheet.render(true, options) (~580) - which, for a timeline journal,
// is sheets/TimelineJournalSheet.mjs. Registered at init so it is in place
// before any user click, in api AND native mode (native mode still has MEJ
// installed; it just lacks the extension API).
import { isTimelineJournal } from "../logic/campaigns.mjs";

export function registerTimelineOpen() {
  Hooks.on("openJournalEntry", (doc) => (isTimelineJournal(doc) ? false : undefined));
}
```

`scripts/campaign-companion.mjs`: add `import { registerTimelineOpen } from "./hooks/timeline-open.mjs";` next to the `registerFolderContext` import, and inside `Hooks.once("init", ...)` directly after `registerFolderContext();`:

```js
  // Timeline journals never open in MEJ's shell (spec 2026-09-03 §C) -
  // pure-logic import only, safe at init like registerFolderContext above.
  registerTimelineOpen();
```

- [ ] **Step 8: Run the e2e to verify it passes**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off`
Expected: 4/4 PASS. If test 2 shows `journalSheets: ["JournalEntrySheet"]`, the hook did not fire before MEJ's own handler — confirm `registerTimelineOpen()` is in `init`, not `registerCore`. If `picker` is `null`, the Hub rendered the Index tab: check `pendingTab` consumption in `_prepareTabs` (line ~245) still runs for `group === "primary"`.

- [ ] **Step 9: Regression run of the specs that touch timeline journals**

Run: `npx playwright test tests/e2e/02-hub-timeline.spec.mjs tests/e2e/16-multi-timeline.spec.mjs --trace off`
Expected: PASS (creation payload changed shape; these prove nothing else reads it).

- [ ] **Step 10: Commit**

```bash
git add scripts/constants.mjs lang/en.json scripts/sheets/TimelineJournalSheet.mjs scripts/hooks/timeline-open.mjs scripts/integrations/mej-adapter.mjs scripts/data/timeline-journal.mjs scripts/campaign-companion.mjs tests/e2e/20-timeline-journal-open.spec.mjs
git commit -m "feat(timeline): timeline journals open the Hub's Timeline tab via a redirect sheet class"
```

---

### Task 5: dataVersion 5 migration for existing timeline journals

**Files:**
- Modify: `scripts/constants.mjs:80` (`CURRENT_DATA_VERSION`)
- Modify: `scripts/campaign-companion.mjs` (migration block, before `await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);` ~line 327; import block)
- Modify: `tests/e2e/20-timeline-journal-open.spec.mjs` (new test 5)

**Interfaces:**
- Consumes: `TIMELINE_SHEET_CLASS`, `isTimelineJournal` (Task 4).

- [ ] **Step 1: Write the failing e2e**

Append to the describe in `tests/e2e/20-timeline-journal-open.spec.mjs`, after test 4:

```js
  test("5. v5 migration stamps a pre-existing timeline journal lacking the sheet class", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const versionBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "dataVersion"));
    expect(versionBefore).toBe(5);
    await page.evaluate(async (id) => {
      await game.journal.get(id).unsetFlag("core", "sheetClass");
      await game.settings.set("mej-campaign-companion", "dataVersion", 4);
    }, timelineId);
    await reloadGame(page);
    await page.waitForFunction(() => game.settings.get("mej-campaign-companion", "dataVersion") === 5, null, { timeout: 60_000 });
    const stamped = await page.evaluate((id) => game.journal.get(id).getFlag("core", "sheetClass"), timelineId);
    expect(stamped).toBe(SHEET_CLASS);
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off -g "v5 migration"`
Expected: FAIL at `expect(versionBefore).toBe(5)` (still 4). (Running with `-g` is fine here: tests 1-4 are skipped but afterAll still deletes the fixture — test 5 creates nothing extra. If `timelineId` is null because test 1 was skipped, run the whole file instead.)

- [ ] **Step 3: Bump the version constant**

`scripts/constants.mjs` line 80: `export const CURRENT_DATA_VERSION = 5;`

- [ ] **Step 4: Add the v5 step**

In `scripts/campaign-companion.mjs`, add `TIMELINE_SHEET_CLASS` to the `./constants.mjs` import list (lines 1-6) and add a new line `import { isTimelineJournal } from "./logic/campaigns.mjs";` after the `./hooks/folder-context.mjs` import (this file does not import `logic/campaigns.mjs` yet). Then, directly before `await game.settings.set(MODULE_ID, DATA_VERSION_SETTING, CURRENT_DATA_VERSION);` inside the migration block:

```js
    // v5: timeline journals carry the redirect sheet class so opening one
    // lands in the Hub (spec 2026-09-03 §C). Creation paths stamp it from
    // 0.16.0 on; this covers everything created earlier. Idempotent: only
    // journals whose flag differs are written.
    let stamped = 0;
    for (const entry of game.journal.contents) {
      if (!isTimelineJournal(entry) || entry.getFlag("core", "sheetClass") === TIMELINE_SHEET_CLASS) continue;
      try {
        await entry.update({ "flags.core.sheetClass": TIMELINE_SHEET_CLASS });
        stamped += 1;
      } catch (err) {
        console.error(`${MODULE_ID} | timeline sheet-class migration failed for ${entry.uuid}`, err);
      }
    }
    if (stamped) console.log(`${MODULE_ID} | stamped the timeline redirect sheet on ${stamped} timeline journal(s)`);
```

- [ ] **Step 5: Run the e2e file to verify it passes**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off`
Expected: 5/5 PASS. Then update `tests/e2e/19-reveal-migration.spec.mjs` lines 39 and 57 — both read `game.settings.get("mej-campaign-companion", "dataVersion") === 4` inside `waitForFunction` — to `=== 5` (the v4 step is idempotent and still runs on the 3→5 reload), and run `npx playwright test tests/e2e/19-reveal-migration.spec.mjs --trace off`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/constants.mjs scripts/campaign-companion.mjs tests/e2e/20-timeline-journal-open.spec.mjs tests/e2e/19-reveal-migration.spec.mjs
git commit -m "feat(migration): dataVersion 5 stamps the timeline redirect sheet on existing timeline journals"
```

---

### Task 6: Distinct sidebar icon + native-mode coverage

**Files:**
- Create: `scripts/hooks/timeline-directory.mjs`
- Modify: `scripts/campaign-companion.mjs` (`init`, after `registerTimelineOpen();`)
- Modify: `tests/e2e/20-timeline-journal-open.spec.mjs` (tests 6-7)

**Interfaces:**
- Consumes: `isTimelineJournal`.
- Produces: `registerTimelineDirectory()`, `decorateTimelineRows(root: HTMLElement)`.

- [ ] **Step 1: Write the failing e2e**

Append after test 5:

```js
  /** fa-timeline class on the row icon inside `root` (core sidebar or MEJ shell sidebar). */
  async function rowIconClass(page, id, root) {
    return page.evaluate(({ journalId, which }) => {
      const scope = which === "shell" ? game.MonksEnhancedJournal?.journal?.element : document.querySelector("#journal");
      return scope?.querySelector(`[data-entry-id="${journalId}"] .entry-name .journal-type`)?.className ?? null;
    }, { journalId: id, which: root });
  }

  test("6. the row carries the timeline icon on both sidebars (api mode)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await page.evaluate(async () => { await ui.journal.activate(); });
    await expect.poll(() => rowIconClass(page, timelineId, "core"), { timeout: 15_000 }).toContain("fa-timeline");
    await clickSidebarRow(page, timelineId);
    await expectHubOnTimeline(page, timelineId);
    await expect.poll(() => rowIconClass(page, timelineId, "shell"), { timeout: 15_000 }).toContain("fa-timeline");
    assertNoConsoleErrors(errors);
  });

  test("7. native mode: sidebar click opens the standalone Hub window on the timeline; icon present", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await page.evaluate(async () => { await game.settings.set("mej-campaign-companion", "forceNativeMode", true); });
    await reloadGame(page);
    // Foundry rebuilds CONFIG.*.sheetClasses asynchronously after ready (see 12-native-mode.spec.mjs).
    await settle(page, 2500);
    try {
      await page.evaluate(async () => { await ui.journal.activate(); });
      await expect.poll(() => rowIconClass(page, timelineId, "core"), { timeout: 15_000 }).toContain("fa-timeline");
      await clickSidebarRow(page, timelineId);
      const state = await expectHubOnTimeline(page, timelineId);
      expect(state.viaShell).toBe(false);
    } finally {
      await page.evaluate(async () => { await game.settings.set("mej-campaign-companion", "forceNativeMode", false); });
    }
    assertNoConsoleErrors(errors);
  });
```

- [ ] **Step 2: Run to verify tests 6-7 fail**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off`
Expected: 5 pass, test 6 fails on the icon (`fa-book`), test 7 fails on the icon.

- [ ] **Step 3: The directory hook**

Create `scripts/hooks/timeline-directory.mjs`:

```js
// Timeline journals get a timeline icon in the journal sidebar (spec
// 2026-09-03 §D). MEJ's updateDirectory (monks-enhanced-journal.js ~3383)
// gives every page-less entry `.journal-type fas fa-fw fa-book`; it runs
// from MEJ's module-level renderJournalDirectory hook for the core sidebar
// and from EnhancedJournal#_onRender for the shell's own sidebar copy. Both
// of ours run after those: module scripts evaluate before any init hook,
// and AppV2 fires renderEnhancedJournal after _onRender.
import { isTimelineJournal } from "../logic/campaigns.mjs";

const ICON_CLASS = "journal-type fas fa-fw fa-timeline";

/** Swap the row icon for every timeline journal row under `root`. Exported for tests; idempotent. */
export function decorateTimelineRows(root) {
  if (!root?.querySelectorAll) return;
  for (const li of root.querySelectorAll("[data-entry-id]")) {
    const entry = game.journal.get(li.dataset.entryId);
    if (!entry || !isTimelineJournal(entry)) continue;
    const icon = li.querySelector(".entry-name .journal-type") ?? li.querySelector(".entry-name i");
    if (icon) icon.className = ICON_CLASS;
  }
}

function rootOf(html) {
  return html instanceof HTMLElement ? html : html?.[0] ?? null;
}

export function registerTimelineDirectory() {
  Hooks.on("renderJournalDirectory", (app, html) => decorateTimelineRows(rootOf(html)));
  Hooks.on("renderEnhancedJournal", (app) => decorateTimelineRows(app?.element ?? null));
}
```

`scripts/campaign-companion.mjs`: import `registerTimelineDirectory` from `./hooks/timeline-directory.mjs` and call it in `init` right after `registerTimelineOpen();`:

```js
  registerTimelineDirectory();
```

- [ ] **Step 4: Run the e2e file to verify it passes**

Run: `npx playwright test tests/e2e/20-timeline-journal-open.spec.mjs --trace off`
Expected: 7/7 PASS. If test 6's shell check fails while the core one passes, log `game.MonksEnhancedJournal.journal.element.querySelector('[data-entry-id="…"]')?.outerHTML` from the test — the shell may keep the row icon under a different selector; adjust `decorateTimelineRows`' fallback selector, not the assertion. If the core check fails, MEJ's hook ran after ours: move the registration from `init` to `ready` (`Hooks.once("ready", registerTimelineDirectory)`) and re-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks/timeline-directory.mjs scripts/campaign-companion.mjs tests/e2e/20-timeline-journal-open.spec.mjs
git commit -m "feat(sidebar): timeline journals carry a timeline icon on the core and shell sidebars"
```

---

### Task 7: Version, changelog, guide, full verification

**Files:**
- Modify: `module.json:5`
- Modify: `CHANGELOG.md` (top)
- Modify: `docs/gm-guide.md:122`
- Modify: `docs/superpowers/specs/2026-09-03-import-fixes-timeline-affordance-design.md` (only if a deviation was made during Tasks 1-6 — record it under a "## Deviations" heading)

- [ ] **Step 1: Version**

`module.json` line 5: `"version": "0.16.0",`. That is the only place the version string appears (`grep -n "0.15.0" module.json README.md` matches line 5 alone); the `download`/`manifest` URLs are version-less.

- [ ] **Step 2: Changelog**

Insert at the top of `CHANGELOG.md`, under `# Changelog`:

```markdown
## 0.16.0 (2026-09-03)

Import fixes and a timeline-journal affordance. Data migration: dataVersion
5 stamps `flags.core.sheetClass` on every existing timeline journal (active
GM, on first load).

- **Import into New Campaign… no longer creates a second, identically named
  folder inside the new campaign.** The *Create a subfolder named after the
  document* option now applies only to an existing destination and is greyed
  out while **New Campaign…** is selected.
- **Standalone pictures survive import.** A paragraph holding only an image
  (how Word/Google Docs exports every non-inline picture) was discarded
  before the upload pass; it is now kept, uploaded under
  `worlds/<world>/mej-campaign-companion/` and shown in the created page.
- **Opening a "<campaign> — Timeline" journal opens the Hub on its Timeline
  tab** with that timeline selected — from the sidebar, a content link, or
  `sheet.render()`, in api and native mode, for GMs and players — instead
  of an empty generic journal editor. Timeline journals also carry a
  timeline icon in the journal sidebar (core and MEJ shell) so they're easy
  to tell apart from the campaign's portal entry.
```

- [ ] **Step 3: GM guide timelines paragraph**

`docs/gm-guide.md` line 122: append to the end of the paragraph (after the sentence ending "…then every world timeline under its own name."):

```markdown
 A timeline journal has no pages of its own — it's where the timepoints are stored — so opening it from the journal sidebar (or from a link) opens the Hub on the Timeline tab showing that timeline, and it carries a timeline icon in the sidebar so it's easy to tell apart from the campaign's portal entry, which shares the campaign's name.
```

- [ ] **Step 4: Full verification**

Run, in order, and record the counts:

```bash
npx vitest run
npm run check:links
npm run check:vendor
npx playwright test --trace off
```

Expected: vitest all PASS (was 741 + 2 new); both checks OK; e2e 0 failures (skips are normal — the v13 stock-gate specs skip on the v14 target). Any failure in a spec this branch did not touch: read the failure, re-run that spec alone once; if it fails again, investigate before finishing — do not mark flaky.

- [ ] **Step 5: Commit**

```bash
git add module.json CHANGELOG.md docs/gm-guide.md docs/superpowers/specs/2026-09-03-import-fixes-timeline-affordance-design.md
git commit -m "chore: release notes, guide and version for 0.16.0"
```

Then hand back to the controller for the finishing workflow (branch → PR against `main`; the release/tag ceremony is the user's call).
