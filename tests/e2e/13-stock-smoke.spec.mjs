// Stock-MEJ smoke test — the only suite that runs the companion against a
// genuinely stock Monk's Enhanced Journal (one that never fires the
// setupMonksEnhancedJournal handshake). 12-native-mode.spec.mjs reaches
// native mode via forceNativeMode on the API-carrying fork; this file is
// the real thing, and is a manual pre-release gate, not part of normal runs.
//
// A normal suite run skips this file entirely (STOCK_PHASE unset). Phases:
// stock (asserts), return (v14 only — needs the API-carrying MEJ to come
// back to), cleanup (v13 — deletes the fixture instead of a return phase).
//
// v13 gate (Foundry 13.351 + stock MEJ 13.06 at ~/FoundryVTT, world-b; no
// symlink swap needed because that MEJ is stock already):
//   npm run e2e:stock:v13            (FOUNDRY_TARGET=v13 STOCK_PHASE=stock)
//   npm run e2e:stock:v13:cleanup    (FOUNDRY_TARGET=v13 STOCK_PHASE=cleanup)
// Global setup starts the v13 server on port 30013 itself if it is not up.
//
// v14 stock gate (swap the MEJ symlink to a stock build):
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
  reloadGame,
  trackConsoleErrors,
  KNOWN_MEJ_SESSION_ICON_404,
  EXPECTED_INVALID_TYPE_WHILE_DISABLED,
  MODULE_ID,
  MEJ_MODULE_ID
} from "./helpers/foundry.mjs";

const PHASE = process.env.STOCK_PHASE ?? "";
// Fixed literal, not a per-run suffix: the two phases are separate Playwright
// invocations, so the return phase could never reconstruct a random name.
// The TT- prefix keeps it reclaimable by the harness's normal-run sweep, but
// note global-setup.mjs deliberately SKIPS its journal sweep when
// STOCK_PHASE=return — the fixture must survive from the stock invocation
// into the return one (the first live run lost it to that sweep).
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
    await reloadGame(page);
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

    // Real-UI path only when a scene is actually viewed: with no active
    // scene the group buttons still render but activating any group crashes
    // inside Foundry itself (PlaceablesLayer#_activate touches the undrawn
    // layer's null `objects` — confirmed live), so the tool button never
    // appears regardless of the companion. Gate on canvas.ready and fall
    // back to the same openHub() the tool's onChange invokes, recording
    // which path ran. Registration itself is asserted in both paths.
    const toolRegistered = await page.evaluate(() =>
      !!ui.controls?.controls?.notes?.tools?.["campaign-hub"]);
    expect(toolRegistered).toBe(true);
    const canvasReady = await page.evaluate(() => canvas?.ready === true);
    let path;
    if (canvasReady) {
      path = "scene-controls click";
      await page.locator('[data-control="notes"]').first().click();
      await settle(page, 500);
      await page.locator('[data-tool="campaign-hub"]').first().click();
    } else {
      path = "no active scene (canvas not ready) — adapter.openHub() (same call the tool's onChange makes)";
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

  test("opening the session from the sidebar renders it without errors", async ({ page }) => {
    // The one companion defect stock MEJ exposed (spike 2026-09-02, MEJ 13.06):
    // a sidebar click routes through game.MonksEnhancedJournal.openJournalEntry
    // → JournalEntrySheet._renderPageView, which awaits sheet.render(). MEJ's
    // EnhancedJournalSheet.render() is not awaitable, so 13.06 threw
    // "Cannot read properties of undefined (reading 'removeAttribute')" and
    // the shell tab showed an empty page body. scripts/sheets/awaitable-render.mjs
    // is the fix; this test is its regression net (it fails on 0.14.0).
    const errors = trackConsoleErrors(page, {
      ignore: [KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED]
    });
    await bootAsRealUser(page);

    // Real sidebar row, clicked in-page (the row can sit outside the headless
    // viewport, which makes Playwright's own click() refuse it).
    const row = page.locator("#journal .directory-item", { hasText: FIXTURE }).first();
    await expect(row).toHaveCount(1);
    // v13/v14 core puts data-action="activateEntry" on the row's <a class="entry-name">,
    // not on the <li> — and ApplicationV2 dispatches actions by walking UP from
    // event.target, so clicking the <li> is a silent no-op. Click the anchor itself
    // (not a descendant): MEJ's _onClickEntry wrapper reads
    // event.target.parentElement.dataset.entryId (monks-enhanced-journal.js:358-360).
    await row.evaluate((el) => el.querySelector("a.entry-name").click());

    // Wherever stock MEJ mounted it — inside its shell tab or as a standalone
    // window — the Session template's root must be in the document with content.
    const container = page.locator(".session-container").first();
    await expect(container).toBeAttached({ timeout: 15_000 });
    await expect.poll(async () => container.evaluate((el) => el.childElementCount), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const where = await page.evaluate(() => {
      const inShell = !!game.MonksEnhancedJournal?.journal?.element?.querySelector?.(".session-container");
      return {
        shellRendered: !!game.MonksEnhancedJournal?.journal?.rendered,
        inShell,
        // A transplanted sheet keeps its SessionSheet-… id inside the shell, so
        // "standalone" only means anything when the shell does NOT hold it.
        standalone: !inShell && !!document.querySelector('[id^="SessionSheet-"] .session-container')
      };
    });
    // Recorded for the run report and for the spec's §2 addendum; both
    // mounts satisfy the requirement.
    test.info().annotations.push({ type: "stock-session-mount", description: JSON.stringify(where) });
    expect(where.inShell || where.standalone).toBe(true);

    // ALL errors, not just companion-tagged ones: the crash this guards
    // against is thrown from MEJ's own JournalEntrySheet code.
    expect(errors).toEqual([]);

    await page.evaluate(async () => {
      try { await game.MonksEnhancedJournal.journal?.close(); } catch { /* not open */ }
      for (const app of foundry.applications.instances.values()) {
        if (app.constructor?.name !== "SessionSheet") continue;
        try { await app.close(); } catch { /* already gone — cleanup must not fail a passed test */ }
      }
    });
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

// STOCK_PHASE=cleanup — for a target with no API-carrying MEJ to return to
// (the v13 install: MEJ 13.06 is stock, full stop), the return phase cannot
// run, so this phase removes the cross-phase fixture instead. global-setup's
// TT- sweep also runs for this phase (it only skips for "return").
const cleanupDescribe = PHASE === "cleanup" ? test.describe : test.describe.skip;

cleanupDescribe("stock smoke cleanup — remove the fixture", () => {
  test("no TT-STOCKSMOKE journal remains", async ({ page }) => {
    await login(page, "Gamemaster");
    const remaining = await page.evaluate(async () => {
      const doomed = game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE"));
      for (const e of doomed) await e.delete();
      return game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE")).map((e) => e.id);
    });
    expect(remaining).toEqual([]);
  });
});
