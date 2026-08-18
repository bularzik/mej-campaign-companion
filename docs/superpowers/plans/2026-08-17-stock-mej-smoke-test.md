# Stock-MEJ Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permanent two-phase Playwright spec that verifies the companion against a genuinely stock (no extension API) Monk's Enhanced Journal, plus one executed swap→restore run against `maint/14.00-sync`.

**Architecture:** One new spec file, `tests/e2e/13-stock-smoke.spec.mjs`, whose two describe blocks are hard-gated on the `STOCK_PHASE` env var (`stock` / `return`) and skipped entirely otherwise. The environment swap (symlink to a temp MEJ worktree, World A backup) stays a documented manual procedure outside Playwright; the harness's `ensureTestWorld()` global setup boots the world after each swap. A fixed-name fixture (`TT-STOCKSMOKE Session`) bridges the two separately-invoked phases.

**Tech Stack:** Playwright (existing e2e harness: `login`, `settle`, `trackConsoleErrors` from `tests/e2e/helpers/foundry.mjs`), Foundry VTT v14 local install, git worktrees.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-17-stock-mej-smoke-test-design.md` — read it before implementing; it governs.
- Stock stand-in is MEJ branch `maint/14.00-sync` (tip `7f4e8d7`), verified to contain zero `setupMonksEnhancedJournal` occurrences.
- Fixture name is exactly `TT-STOCKSMOKE Session` (fixed literal — phases are separate invocations; the `TT-` prefix keeps it inside the harness cleanup convention).
- With `STOCK_PHASE` unset, the whole file must be skipped; a normal suite run must be unaffected.
- Phase 2 must OBSERVE the automatic GM ready heal — it must never call `adapter.healSessionFlags()` itself.
- Companion-owned claims are asserted; stock-MEJ-owned behaviors (what stock MEJ does when *it* opens an unknown-typed entry; stock MEJ's own console noise) are RECORDED as `test.info().annotations`, never asserted.
- The published 0.5.0 release assets are never modified; any real companion defect found ships as 0.5.1 from a new branch.
- The main MEJ checkout (`~/Claude/Projects/monks-enhanced-journal`, on `integration-14.07`) is never touched; the stock build lives in a temp detached worktree.
- Work on companion branch `feature/stock-smoke-test`.

---

### Task 1: The gated two-phase spec file + harness docs

**Files:**
- Create: `tests/e2e/13-stock-smoke.spec.mjs`
- Modify: `tests/e2e/README.md` (append a "Stock-MEJ smoke test" section)

**Interfaces:**
- Consumes: `login(page, userName)`, `settle(page, ms)`, `trackConsoleErrors(page, {ignore})`, `KNOWN_MEJ_SESSION_ICON_404`, `EXPECTED_INVALID_TYPE_WHILE_DISABLED`, `MODULE_ID`, `MEJ_MODULE_ID` — all from `./helpers/foundry.mjs`. Adapter via dynamic `import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs")` inside `page.evaluate` (exports used: `currentMode()`, `wiringFailed()`, `openHub()`). Search via `scripts/search/live-index.mjs` (`ensureIndex()`, `searchAll(q)`). Hub selectors: window `[id^="CampaignHubPage-"]`, `button[data-action="newSession"]`, `input.mej-cc-search-input`, rows `.mej-cc-search-row` / `.mej-cc-search-name`. Session sheet window `[id^="SessionSheet-"]`. Scene-controls tool: group `notes`, tool name `campaign-hub` (from `HUB_PAGE_ID`). Shell subsheet check: `game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name` (pattern from `01-session.spec.mjs:69`). i18n: `MEJCampaignCompanion.errors.mej-missing`, `.errors.init-failed`, `.hub.newSession`.
- Produces: the file Task 2 executes; no code interfaces.

- [ ] **Step 1: Write the spec file**

The full file. Notes for the implementer: (a) tests within each phase are order-dependent (the suite runs `workers: 1`, `fullyParallel: false`, so file order is execution order); (b) selectors above were verified against the current templates — if a scene-controls selector doesn't match the live v14 DOM, adjust the selector, not the assertion; (c) the API build leaves `forceNativeMode` possibly `true` from earlier suite runs — both phases normalize it to `false` and re-boot so assertions reflect a real user's configuration.

```js
// Stock-MEJ smoke test — the only suite that runs the companion against a
// genuinely stock Monk's Enhanced Journal (one that never fires the
// setupMonksEnhancedJournal handshake). 12-native-mode.spec.mjs reaches
// native mode via forceNativeMode on the API-carrying fork; this file is
// the real thing, and is a manual pre-release gate, not part of normal runs.
//
// A normal suite run skips this file entirely (STOCK_PHASE unset).
//
// Procedure (also in tests/e2e/README.md). From the MEJ repo:
//   1. git worktree add --detach /tmp/mej-stock-smoke maint/14.00-sync
//   2. Stop Foundry:  kill $(lsof -ti :30000 -sTCP:LISTEN)
//   3. Back up World A:
//      mkdir -p ~/FoundryVTT-14/backups
//      cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a \
//            ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-<date>
//   4. Repoint the module symlink (rm + ln -s; never ln -sfn onto a dir symlink):
//      rm ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
//      ln -s /tmp/mej-stock-smoke ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
//   5. STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs
//      (global setup boots World A itself; the file argument keeps the rest
//      of the suite, written for the API build, from running against stock)
//   6. Stop Foundry again; repoint the symlink back:
//      rm ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
//      ln -s ~/Claude/Projects/monks-enhanced-journal \
//            ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
//   7. STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs
//   8. git worktree remove --force /tmp/mej-stock-smoke   (pack churn dirties it)
//   9. Delete the World A backup once the run is judged clean.
import { test, expect } from "@playwright/test";
import {
  login,
  settle,
  trackConsoleErrors,
  KNOWN_MEJ_SESSION_ICON_404,
  EXPECTED_INVALID_TYPE_WHILE_DISABLED,
  MODULE_ID,
  MEJ_MODULE_ID
} from "./helpers/foundry.mjs";

const PHASE = process.env.STOCK_PHASE ?? "";
// Fixed literal, not a per-run suffix: the two phases are separate Playwright
// invocations, so the return phase could never reconstruct a random name.
const FIXTURE = "TT-STOCKSMOKE Session";
const ADAPTER = `/modules/${MODULE_ID}/scripts/integrations/mej-adapter.mjs`;

const stockDescribe = PHASE === "stock" ? test.describe : test.describe.skip;
const returnDescribe = PHASE === "return" ? test.describe : test.describe.skip;

/** Normalize forceNativeMode to false (a real user's config) and re-boot. */
async function bootAsRealUser(page) {
  await login(page, "Gamemaster");
  const wasForced = await page.evaluate(async (id) => {
    const forced = game.settings.get(id, "forceNativeMode");
    if (forced) await game.settings.set(id, "forceNativeMode", false);
    return forced;
  }, MODULE_ID);
  if (wasForced) {
    await page.reload();
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  }
  // Same post-ready settle 12-native-mode uses: sheetClasses and the ready
  // sweeps finish asynchronously after game.ready flips.
  await settle(page, 2500);
}

stockDescribe("stock smoke phase 1 — genuinely stock MEJ", () => {
  test.beforeAll(async ({ browser }) => {
    // Idempotency: clear leftovers from an aborted earlier run — the fixture
    // itself and any un-renamed "New Session" entries a crashed run left.
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await page.evaluate(async (fixture) => {
      const defName = game.i18n.localize("MEJCampaignCompanion.hub.newSession");
      const doomed = game.journal.filter((e) => e.name === fixture || e.name === defName);
      for (const e of doomed) await e.delete();
    }, FIXTURE);
    await context.close();
  });

  test("clean boot: MEJ active without the API, native mode, no companion errors", async ({ page }) => {
    const errors = trackConsoleErrors(page, {
      ignore: [KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED]
    });
    await bootAsRealUser(page);

    const state = await page.evaluate(async ({ mejId, adapterPath }) => {
      const adapter = await import(adapterPath);
      const errorStrings = [
        game.i18n.localize("MEJCampaignCompanion.errors.mej-missing"),
        game.i18n.localize("MEJCampaignCompanion.errors.init-failed")
      ];
      const notifications = Array.from(document.querySelectorAll("#notifications .notification"))
        .map((n) => n.textContent.trim());
      return {
        mejActive: game.modules.get(mejId)?.active === true,
        mejVersion: game.modules.get(mejId)?.version ?? null,
        // Present only on the API-carrying fork — the whole point of this
        // suite is that THIS build must not have it.
        apiPresent: typeof game.MonksEnhancedJournal?.registerSheetType === "function",
        mode: adapter.currentMode(),
        wiringFailed: adapter.wiringFailed(),
        companionErrorNotifications: notifications.filter((t) =>
          errorStrings.some((s) => s && t.includes(s)))
      };
    }, { mejId: MEJ_MODULE_ID, adapterPath: ADAPTER });

    test.info().annotations.push({ type: "stock-mej-version", description: String(state.mejVersion) });
    expect(state.mejActive).toBe(true);
    expect(state.apiPresent).toBe(false);
    expect(state.mode).toBe("native");
    expect(state.wiringFailed).toBe(false);
    expect(state.companionErrorNotifications).toEqual([]);

    // Companion console errors fail the test; stock MEJ's own noise is the
    // run report's business, not an assertion (we don't own stock MEJ).
    const companionErrors = errors.filter((t) => t.includes(MODULE_ID));
    const otherErrors = errors.filter((t) => !t.includes(MODULE_ID));
    test.info().annotations.push({
      type: "stock-boot-non-companion-console-errors",
      description: otherErrors.length ? otherErrors.join(" | ") : "(none)"
    });
    expect(companionErrors).toEqual([]);
  });

  test("Hub opens from the scene-controls button with working tabs", async ({ page }) => {
    await bootAsRealUser(page);

    // Real-UI path when the canvas (and thus scene controls) is up;
    // canvas-off worlds have no scene-controls DOM at all, so fall back to
    // the same openHub() the tool's onChange invokes, and record which path
    // ran. Registration itself is asserted in both paths.
    const toolRegistered = await page.evaluate(() =>
      !!ui.controls?.controls?.notes?.tools?.["campaign-hub"]);
    const notesButton = page.locator('[data-control="notes"]');
    let path;
    if (await notesButton.count()) {
      path = "scene-controls click";
      expect(toolRegistered).toBe(true);
      await notesButton.first().click();
      await settle(page, 500);
      await page.locator('[data-tool="campaign-hub"]').first().click();
    } else {
      path = "canvas disabled — adapter.openHub() (same call the tool's onChange makes)";
      await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    }
    test.info().annotations.push({ type: "hub-open-path", description: path });

    await page.waitForSelector('[id^="CampaignHubPage-"]', { timeout: 15_000 });
    const opened = await page.evaluate(async () => {
      const el = document.querySelector('[id^="CampaignHubPage-"]');
      const navs = Array.from(el?.querySelectorAll("[data-tab]") ?? [])
        .filter((n) => n.tagName !== "DIV"); // nav links, not tab panels
      const current = el?.querySelector("div.tab.active")?.dataset?.tab ?? null;
      const target = navs.find((n) => n.dataset.tab !== current);
      target?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        rendered: !!el,
        clicked: target?.dataset.tab ?? null,
        active: el?.querySelector("div.tab.active")?.dataset?.tab ?? null,
        shellOpen: !!game.MonksEnhancedJournal?.journal?.rendered
      };
    });
    expect(opened.rendered).toBe(true);
    expect(opened.clicked).not.toBeNull();
    expect(opened.active).toBe(opened.clicked);
    // Standalone window, not a stock-MEJ shell tab.
    expect(opened.shellOpen).toBe(false);
  });

  test("New Session creates the fixture and auto-opens the standalone SessionSheet", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    await page.waitForSelector('[id^="CampaignHubPage-"]', { timeout: 15_000 });

    await page.locator('[id^="CampaignHubPage-"] button[data-action="newSession"]').click();
    // The creation handler opens the page's sheet itself (CampaignHubPage.
    // onNewSession -> page.sheet.render(true)) — the native-mode creation UX.
    await page.waitForSelector('[id^="SessionSheet-"]', { timeout: 15_000 });

    const result = await page.evaluate(async (fixture) => {
      const defName = game.i18n.localize("MEJCampaignCompanion.hub.newSession");
      const entry = game.journal.find((e) => e.name === defName) ?? null;
      const pageDoc = entry?.pages?.contents?.[0] ?? null;
      const out = {
        created: !!pageDoc,
        nativeType: pageDoc?.type ?? null,
        sheetCtor: pageDoc?.sheet?.constructor?.name ?? null,
        // Observation for the run report: whether stock MEJ has already
        // stripped the interop flag at this point (fixType timing is stock
        // MEJ's business — recorded, not asserted).
        mejFlagNow: pageDoc?.getFlag("monks-enhanced-journal", "type") ?? null
      };
      // Rename to the fixed cross-phase fixture name.
      if (entry) await entry.update({ name: fixture });
      if (pageDoc) await pageDoc.update({ name: fixture });
      return out;
    }, FIXTURE);

    test.info().annotations.push({ type: "mej-flag-after-create", description: String(result.mejFlagNow) });
    expect(result.created).toBe(true);
    expect(result.nativeType).toBe("mej-campaign-companion.session");
    expect(result.sheetCtor).toBe("SessionSheet");

    // Controls responsive: switch to a non-active tab inside the sheet.
    const tabs = await page.evaluate(async () => {
      const el = document.querySelector('[id^="SessionSheet-"]');
      const current = el?.querySelector("div.tab.active")?.dataset?.tab ?? null;
      const nav = Array.from(el?.querySelectorAll("[data-tab]") ?? [])
        .filter((n) => n.tagName !== "DIV")
        .find((n) => n.dataset.tab !== current);
      nav?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        clicked: nav?.dataset.tab ?? null,
        active: el?.querySelector("div.tab.active")?.dataset?.tab ?? null
      };
    });
    expect(tabs.clicked).not.toBeNull();
    expect(tabs.active).toBe(tabs.clicked);
  });

  test("Hub search finds the stock-created session", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    await page.waitForSelector('[id^="CampaignHubPage-"]', { timeout: 15_000 });

    await page.evaluate(async () => {
      const el = document.querySelector('[id^="CampaignHubPage-"]');
      const nav = Array.from(el?.querySelectorAll('[data-tab="search"]') ?? [])
        .find((n) => n.tagName !== "DIV");
      nav?.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    await page.locator('[id^="CampaignHubPage-"] input.mej-cc-search-input').fill("STOCKSMOKE");
    await settle(page, 1200); // debounce + render

    await expect(
      page.locator('[id^="CampaignHubPage-"] .mej-cc-search-row .mej-cc-search-name', { hasText: FIXTURE })
    ).toHaveCount(1);
  });

  test("recorded observation: stock MEJ opening the session itself (never asserted)", async ({ page }) => {
    await bootAsRealUser(page);
    // Both a sidebar directory click and the Hub index row route through
    // game.MonksEnhancedJournal.openJournalEntry — under stock MEJ that is
    // STOCK's behavior with a type it doesn't know. The run report needs to
    // know what a user would see there; the suite must not fail on it.
    const observed = await page.evaluate(async (fixture) => {
      const entry = game.journal.getName(fixture);
      const out = { threw: null, shellRendered: null, subsheet: null, mejFlagAfter: null };
      try {
        await game.MonksEnhancedJournal.openJournalEntry(entry);
        await new Promise((r) => setTimeout(r, 1500));
        out.shellRendered = !!game.MonksEnhancedJournal.journal?.rendered;
        out.subsheet = game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name ?? null;
      } catch (err) {
        out.threw = String(err);
      }
      out.mejFlagAfter = entry?.pages?.contents?.[0]?.getFlag("monks-enhanced-journal", "type") ?? null;
      try { await game.MonksEnhancedJournal.journal?.close(); } catch { /* observation only */ }
      return out;
    }, FIXTURE);
    test.info().annotations.push({
      type: "stock-mej-opens-session",
      description: JSON.stringify(observed)
    });
    expect(observed).toBeTruthy(); // the observation itself is the deliverable
  });
});

returnDescribe("stock smoke phase 2 — back on the API-carrying MEJ", () => {
  test("api mode resolves and the automatic heal re-stamped the flag", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
    await bootAsRealUser(page);

    const mode = await page.evaluate(async (p) => (await import(p)).currentMode(), ADAPTER);
    expect(mode).toBe("api");

    // Observe, never trigger: the claim under test is the automatic GM
    // ready-sweep. Poll for its (async) result; calling healSessionFlags()
    // here would make the assertion vacuous.
    await page.waitForFunction((fixture) => {
      const entry = game.journal.getName(fixture);
      const pageDoc = entry?.pages?.contents?.[0];
      return pageDoc?.getFlag("monks-enhanced-journal", "type") === "session";
    }, FIXTURE, { timeout: 15_000 });

    const companionErrors = errors.filter((t) => t.includes(MODULE_ID));
    expect(companionErrors).toEqual([]);
  });

  test("the session opens in the MEJ shell as SessionSheet", async ({ page }) => {
    await bootAsRealUser(page);
    const result = await page.evaluate(async (fixture) => {
      const entry = game.journal.getName(fixture);
      await game.MonksEnhancedJournal.openJournalEntry(entry);
      await new Promise((r) => setTimeout(r, 1500));
      return {
        shellRendered: !!game.MonksEnhancedJournal.journal?.rendered,
        subsheet: game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name ?? null
      };
    }, FIXTURE);
    expect(result.shellRendered).toBe(true);
    expect(result.subsheet).toBe("SessionSheet");
  });

  test("search still finds the roundtripped session; cleanup", async ({ page }) => {
    await bootAsRealUser(page);
    const found = await page.evaluate(async ({ fixture, id }) => {
      const search = await import(`/modules/${id}/scripts/search/live-index.mjs`);
      search.ensureIndex();
      const entry = game.journal.getName(fixture);
      return search.searchAll("STOCKSMOKE").some((h) => (h.uuid ?? "").includes(entry?.id));
    }, { fixture: FIXTURE, id: MODULE_ID });
    expect(found).toBe(true);

    // The run is complete — remove the cross-phase fixture.
    await page.evaluate(async () => {
      const doomed = game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE"));
      for (const e of doomed) await e.delete();
    });
  });
});
```

- [ ] **Step 2: Verify the gate — normal runs skip the file**

Run: `cd /Users/danbularzik/Claude/Projects/mej-campaign-companion && npx playwright test tests/e2e/13-stock-smoke.spec.mjs --list`
Expected: the 8 tests are listed (auth setup project may also list). Then:
Run: `npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
Expected: all tests reported **skipped** (STOCK_PHASE unset), 0 failures. This runs against whatever the symlink currently points at and must not touch the world.

- [ ] **Step 3: Verify the suite is otherwise unaffected**

Run: `npm test` (unit suite; no Foundry needed)
Expected: 503/503 pass, no new failures.

- [ ] **Step 4: Append the procedure to `tests/e2e/README.md`**

Add a section titled `## Stock-MEJ smoke test (manual pre-release gate)` containing: one paragraph on what it proves (real stock vs `forceNativeMode` simulation), the 9-step procedure verbatim from the spec-file header comment, and the failure policy line ("companion defects ship as a new patch release from a new branch; published release assets are never modified; stock-MEJ-own breakage is documented in the mode table, not fixed here").

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/13-stock-smoke.spec.mjs tests/e2e/README.md
git commit -m "test: add gated two-phase stock-MEJ smoke spec (STOCK_PHASE)"
```

### Task 2: Execute the swap→restore run and report

This task is environment orchestration plus judgment about live results — run it from the controlling session (it holds the env lock and the MEJ repo), not a fresh implementer subagent.

**Files:**
- No repo files change unless findings do; results go in the task report / PR body.

**Interfaces:**
- Consumes: the spec file from Task 1; MEJ repo branch `maint/14.00-sync`; the Foundry v14 env (`~/FoundryVTT-14`, World A, port 30000).

- [ ] **Step 1: Create the stock worktree** — from the MEJ repo: `git worktree add --detach /tmp/mej-stock-smoke maint/14.00-sync`; verify `grep -c setupMonksEnhancedJournal /tmp/mej-stock-smoke/monks-enhanced-journal.js` prints `0`.
- [ ] **Step 2: Stop the server and back up World A** — `kill $(lsof -ti :30000 -sTCP:LISTEN)`; `mkdir -p ~/FoundryVTT-14/backups`; `cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-2026-08-17`; verify the copy exists and is non-empty.
- [ ] **Step 3: Swap the symlink** — `rm` the module symlink, `ln -s /tmp/mej-stock-smoke ...` per the header comment; verify with `readlink`.
- [ ] **Step 4: Run phase 1** — `STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs` from the companion repo. Expected: 6 tests pass (incl. the observation test). Capture the annotations (MEJ version, hub-open path, flag-after-create, non-companion console errors, stock-open observation) from the reporter output for the report.
- [ ] **Step 5: Restore the symlink** — stop the server again; `rm` + `ln -s ~/Claude/Projects/monks-enhanced-journal ...`; verify with `readlink`.
- [ ] **Step 6: Run phase 2** — `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs`. Expected: 3 tests pass; the heal assertion proves the roundtrip.
- [ ] **Step 7: Confirm World A healthy** — run one ordinary spec as a canary: `npx playwright test tests/e2e/01-session.spec.mjs`. Expected: passes as before the swap.
- [ ] **Step 8: Teardown** — `git worktree remove --force /tmp/mej-stock-smoke`. Keep the World A backup until the user has seen the report.
- [ ] **Step 9: Report** — summarize pass/fail per check plus every annotation (especially what stock MEJ did when it opened the session, and whether/when the flag was stripped). If a companion defect surfaced: stop, report it — the fix is a 0.5.1 decision for the user, not part of this plan.
- [ ] **Step 10: Raise the PR** — push `feature/stock-smoke-test`; open a draft PR to companion `main` titled "Stock-MEJ smoke test (manual pre-release gate)" whose body carries the run report.

## Self-Review

- **Spec coverage:** environment orchestration → Task 2 steps 1–8 + spec-file header; gated spec file with both phases → Task 1; observe-don't-trigger heal → phase 2 test 1 (poll, no `healSessionFlags()` call); recorded-not-asserted stock-MEJ behaviors → boot test's error split + observation test; failure policy → Task 2 step 9 + README section; World A healthy again → Task 2 step 7 canary.
- **Placeholder scan:** clean — full code present; README section content enumerated.
- **Type consistency:** `FIXTURE`, `ADAPTER`, phase gating names used consistently; helper names match `helpers/foundry.mjs` exports verified in-repo.
