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
// What the stock phase asserts since the native shell shim (spec 2026-09-19
// §4): on a stock MEJ the companion no longer settles for standalone
// windows — it installs the shim and hosts the Hub, the Session sheet and a
// campaign portal as MEJ shell subsheets, exactly as api mode does. So the
// gate reads adapter.currentHosting() === "shell", looks for the Hub and the
// session inside game.MonksEnhancedJournal.journal.element rather than by a
// standalone window id, and requires MEJ's JournalEntry page wrapper
// (.journal-entry-pages) to be absent around a hosted session or portal. Standalone
// windows remain a supported fallback and have a test of their own, which
// turns the shellHosting client setting off and asserts the window path.
// (The Hub's DOM selector is .mej-cc-hub-container: hub.hbs's outer
// .mej-cc-hub is the root PART element, which Foundry flattens into the
// application root, so it never reaches the DOM in EITHER hosting.)
//
// The gate also measures WCAG contrast of session and Hub text against the
// nearest ancestor that actually paints, under BOTH colour schemes
// (scripts/logic/contrast.mjs): hosting our templates inside MEJ's own
// wrappers is exactly the change that can leave dark-on-dark text behind.
//
// The two stock targets run against different worlds, and the gate must
// hold on both: world-b (v13) has no campaigns and no folders of its own,
// World A (v14) has both. (The campaign-portal test creates its own campaign
// and removes it again, restoring the auto-capture target it seeds on a world
// whose first campaign it is.) That is why New Session confirms a destination-campaign
// prompt when one appears, and why sidebar rows are matched on
// [data-entry-id] instead of a bare .directory-item.
//
// v13 gate (Foundry 13.351 + stock MEJ 13.06 at ~/FoundryVTT, world-b; no
// symlink swap needed because that MEJ is stock already):
//   npm run e2e:stock:v13            (FOUNDRY_TARGET=v13 STOCK_PHASE=stock)
//   npm run e2e:stock:v13:cleanup    (FOUNDRY_TARGET=v13 STOCK_PHASE=cleanup)
// Global setup starts the v13 server on port 30013 itself if it is not up.
//
// v14 stock gate (point the MEJ module worktree at a stock build):
//
// The MEJ install at ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
// is a git worktree of the MEJ repo. Stock = tag 14.01; API build = the fork
// line (integration-14.08) or upstream PR #823's head. Foundry must be
// stopped and the pack skip-worktree flags cleared before a checkout that
// crosses between a 14.01-based and a fork-based commit (the pack
// bookkeeping files differ) — see tests/e2e/README.md for the exact
// commands. Procedure:
//   1. Stop Foundry:  ~/FoundryVTT-14/stop-foundry.command
//   2. Back up World A:
//      mkdir -p ~/FoundryVTT-14/backups
//      cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a \
//            ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-<date>
//   3. Check out tag 14.01 in the module worktree (flags cleared, then
//      re-set) and relaunch Foundry on world-a.
//   4. STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs
//      (global setup boots World A itself if needed; the file argument keeps
//      the rest of the suite, written for the API build, from running
//      against stock)
//   5. Stop Foundry; check out the API build in the module worktree the
//      same way; relaunch.
//   6. STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs
//   7. Delete the World A backup once the run is judged clean.
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
// The campaign fixture (folder + portal entry + timeline journal) is created
// and removed inside a single test, but it is named here because every phase's
// teardown has to be able to sweep it if that test died mid-way.
const CAMPAIGN_FIXTURE = "TT-STOCKSMOKE Campaign";
const ADAPTER = `/modules/${MODULE_ID}/scripts/integrations/mej-adapter.mjs`;
const CONTRAST = `/modules/${MODULE_ID}/scripts/logic/contrast.mjs`;

const stockDescribe = PHASE === "stock" ? test.describe : test.describe.skip;
const returnDescribe = PHASE === "return" ? test.describe : test.describe.skip;

/**
 * Contrast of an element's text against the nearest ancestor that actually
 * paints something behind it.
 *
 * "Paints" has to include background IMAGES, not just background colours:
 * MEJ's shell puts Foundry's parchment on .window-content and leaves every
 * wrapper between it and our text transparent, so a colour-only walk sails
 * straight past the surface the reader sees and measures the text against
 * the window chrome far above it (a false 1.24:1 on 13.06, where the real
 * rendering is dark ink on parchment). An image surface is resolved to the
 * average of its pixels — same origin, so the canvas stays untainted — and
 * an image that fails to load paints nothing, so the walk continues.
 */
async function textContrast(page, selector) {
  return page.evaluate(async ({ selector, contrastPath }) => {
    const { contrastRatio, parseCssColor } = await import(contrastPath);
    const el = document.querySelector(selector);
    if (!el) return { ratio: NaN, fg: null, bg: null, surface: "no element matched" };
    const fg = getComputedStyle(el).color;

    const averageImageColor = (url) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = Math.min(img.naturalWidth, 64);
          c.height = Math.min(img.naturalHeight, 64);
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
          }
          resolve(n ? `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})` : null);
        } catch (err) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });

    let n = el; let bg = null; let surface = "nothing painted below the text";
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      // Image first: where an element has both, the image paints over the colour.
      const url = /^url\("?(.+?)"?\)$/.exec(cs.backgroundImage)?.[1];
      if (url) {
        const avg = await averageImageColor(url);
        if (avg) { bg = avg; surface = `image average (${url.split("/").pop()}) on ${n.tagName}.${String(n.className).split(" ")[0]}`; break; }
      }
      const c = parseCssColor(cs.backgroundColor);
      if (c && c.a > 0) {
        bg = cs.backgroundColor;
        surface = `colour on ${n.tagName}.${String(n.className).split(" ")[0]}`;
        break;
      }
      n = n.parentElement;
    }
    return { ratio: contrastRatio(fg, bg), fg, bg, surface };
  }, { selector, contrastPath: CONTRAST });
}

/**
 * Remove the gate's own shell tabs from the GM's MEJ tab flag.
 *
 * The Hub is a synthetic shell page, so a tab pointing at it survives in
 * `monks-enhanced-journal.tabs` after the run and would be re-resolved on the
 * user's next real shell open — a leftover this gate has no business leaving
 * behind. Only entries whose entityId is one of OUR shell pages are dropped;
 * the user's real journal tabs are untouched.
 */
async function removeShellTabs(page) {
  return page.evaluate(async () => {
    const tabs = game.user.getFlag("monks-enhanced-journal", "tabs") ?? [];
    const kept = tabs.filter((t) => !String(t?.entityId ?? "").startsWith("shellpage:"));
    if (kept.length !== tabs.length) await game.user.setFlag("monks-enhanced-journal", "tabs", kept);
    return { before: tabs.length, after: kept.length };
  });
}

/**
 * Remove the campaign fixture: everything inside the folder (portal entry and
 * timeline journal) and then the folder itself. Idempotent, so it doubles as
 * the phases' leftover sweep. `restoreAutoCapture` (when not undefined) puts
 * the world's auto-capture target back — createCampaign seeds it to the new
 * folder when the world had no campaign before, which world-b does not.
 */
async function deleteCampaignFixture(page, restoreAutoCapture) {
  return page.evaluate(async ({ name, id, restore }) => {
    const folders = game.folders.filter((f) => f.type === "JournalEntry" && f.name === name);
    let entries = 0;
    for (const f of folders) {
      for (const e of [...f.contents]) { await e.delete(); entries++; }
      await f.delete();
    }
    // A portal that somehow ended up outside the folder still has the name.
    for (const e of game.journal.filter((e) => e.name === name)) { await e.delete(); entries++; }
    let autoCapture = null;
    if (restore !== undefined && game.settings.get(id, "autoCaptureCampaign") !== restore) {
      await game.settings.set(id, "autoCaptureCampaign", restore);
      autoCapture = restore;
    }
    return { folders: folders.length, entries, autoCaptureRestoredTo: autoCapture };
  }, { name: CAMPAIGN_FIXTURE, id: MODULE_ID, restore: restoreAutoCapture });
}

/** Set the client colour scheme (client-scoped, so only this test browser sees it) and re-boot. */
async function setColorScheme(page, scheme) {
  await page.evaluate(async (scheme) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    cfg.colorScheme = { applications: scheme, interface: scheme };
    await game.settings.set("core", "uiConfig", cfg);
  }, scheme);
  await reloadGame(page);
  await settle(page, 2500);
}

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
    // …and the campaign fixture, whose folder a crashed run would otherwise
    // leave behind as a real campaign on the test world (which would then
    // change what the New Session test below asserts).
    await deleteCampaignFixture(page);
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
        // suite is that THIS build must not have it. `getApi`/`externalTypes`,
        // NOT `registerSheetType`: that name lives on the object getApi()
        // RETURNS and is handed to the setupMonksEnhancedJournal hook, never on
        // game.MonksEnhancedJournal — so the old check read false on the fork
        // too and this assertion was passing vacuously (caught 2026-09-19 when
        // the same wrong predicate, copied into three specs' skip gates, made
        // them skip on the v14 fork line).
        apiPresent: typeof game.MonksEnhancedJournal?.getApi === "function"
          || !!game.MonksEnhancedJournal?.externalTypes,
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

    await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });
    const opened = await page.evaluate(async (p) => {
      const a = await import(p);
      const shell = game.MonksEnhancedJournal?.journal;
      const el = shell?.element?.querySelector(".mej-cc-hub-container") ?? document.querySelector('[id^="CampaignHubPage-"]');
      const navs = Array.from(el?.querySelectorAll("[data-tab]") ?? []).filter((n) => n.tagName !== "DIV");
      const current = el?.querySelector("div.tab.active")?.dataset?.tab ?? null;
      const target = navs.find((n) => n.dataset.tab !== current);
      target?.click();
      await new Promise((r) => setTimeout(r, 400));
      return {
        hosting: a.currentHosting(),
        rendered: !!el,
        clicked: target?.dataset.tab ?? null,
        active: el?.querySelector("div.tab.active")?.dataset?.tab ?? null,
        shellOpen: !!shell?.rendered,
        subsheet: shell?.subsheet?.constructor?.name ?? null
      };
    }, ADAPTER);
    expect(opened.hosting).toBe("shell");
    expect(opened.rendered).toBe(true);
    expect(opened.clicked).not.toBeNull();
    expect(opened.active).toBe(opened.clicked);
    expect(opened.shellOpen).toBe(true);
    expect(opened.subsheet).toBe("CampaignHubPage");

    // Wrap 4 of the shim: MEJ's shell header still carries its "configure
    // sheet" control, and the Hub's document is a synthetic in-memory page
    // with no sheet to configure — invoking the action while the Hub is the
    // subsheet must open nothing at all (it threw before the wrap existed).
    //
    // Counted as "did ANY new application appear", not "did a
    // DocumentSheetConfig appear": the two stock builds open DIFFERENT config
    // apps (14.01 builds core's `DocumentSheetConfig`, 13.06 MEJ's own
    // `ApplicationSheetConfig`), so a constructor-name filter on
    // "DocumentSheetConfig" could never fail on 13.06 — the test was vacuous
    // there. V1 and V2 apps live in different registries, so both are counted.
    const appCount = async (page) => page.evaluate(() => ({
      v2: foundry.applications.instances.size,
      v1: Object.keys(ui.windows ?? {}).length
    }));
    const beforeCounts = await appCount(page);
    const configured = await page.evaluate(async () => {
      const shell = game.MonksEnhancedJournal.journal;
      let threw = null;
      try {
        await shell.options.actions.configureSheet.call(shell, new Event("click"), shell.element);
      } catch (err) {
        threw = String(err?.message ?? err);
      }
      await new Promise((r) => setTimeout(r, 400));
      return { threw };
    });
    const afterCounts = await appCount(page);
    expect(configured.threw).toBeNull();
    expect(afterCounts, "no application of any kind may open for the Hub's synthetic document")
      .toEqual(beforeCounts);

    // Control: the same action on a NORMAL journal tab must still open exactly
    // one configure app — otherwise "nothing opened" above would also pass if
    // the wrap had swallowed the action for every document, which would be a
    // regression against stock MEJ's own behaviour rather than a fix.
    const normalEntry = await page.evaluate(async () => {
      const entry = game.journal.find((e) => e.pages.size > 0
        && !e.pages.contents.some((p) => p.type?.startsWith("mej-campaign-companion.")));
      if (!entry) return null;
      await game.MonksEnhancedJournal.openJournalEntry(entry);
      await new Promise((r) => setTimeout(r, 800));
      return entry.name;
    });
    test.info().annotations.push({
      type: "configure-sheet-control-entry",
      description: normalEntry ?? "(no plain journal entry on this world — control skipped)"
    });
    if (normalEntry) {
      const beforeNormal = await appCount(page);
      const normalThrew = await page.evaluate(async () => {
        const shell = game.MonksEnhancedJournal.journal;
        let threw = null;
        try {
          await shell.options.actions.configureSheet.call(shell, new Event("click"), shell.element);
        } catch (err) {
          threw = String(err?.message ?? err);
        }
        await new Promise((r) => setTimeout(r, 600));
        return threw;
      });
      const afterNormal = await appCount(page);
      const opened = (afterNormal.v1 - beforeNormal.v1) + (afterNormal.v2 - beforeNormal.v2);
      test.info().annotations.push({
        type: "configure-sheet-normal-tab",
        description: JSON.stringify({ beforeNormal, afterNormal, threw: normalThrew })
      });
      expect(normalThrew).toBeNull();
      expect(opened, "a normal journal tab still opens exactly one configure app").toBe(1);
      // Close whatever it opened so it cannot leak into a later test.
      await page.evaluate(async () => {
        for (const app of foundry.applications.instances.values()) {
          if (/SheetConfig/.test(app.constructor?.name ?? "")) await app.close().catch(() => {});
        }
        for (const app of Object.values(ui.windows ?? {})) {
          if (/SheetConfig/.test(app.constructor?.name ?? "")) await app.close?.();
        }
      });
    }
  });

  // Regression net for the Hub-open race fixed 2026-09-19 (see openHub()'s
  // comment in mej-adapter.mjs). Deliberately NO settle: Foundry registers
  // the scene-controls Hub button from getSceneControlButtons, fired during
  // initializeUI() — before game.ready flips, and well before our ready hook
  // has awaited registerCore() and the mode wiring. A GM clicking in that
  // window used to reach openHubWindow() before registerHubSheetClass() had
  // run, and Foundry 13's DocumentSheetV2 constructor threw on the missing
  // CONFIG.JournalEntryPage.sheetClasses["campaign-hub"] entry; the click was
  // lost with nothing but a console error. Whether the race window is open on
  // any given boot is timing-dependent (recorded as an annotation), but the
  // assertion holds either way.
  test("the Hub opens when clicked before the ready wiring has finished", async ({ page }) => {
    await login(page, "Gamemaster");
    await page.waitForFunction(() => game?.ready === true, null, { timeout: 60_000 });

    const raced = await page.evaluate(async (p) => {
      const adapter = await import(p);
      // Read before openHub() so the annotation reports the state the click
      // actually landed in, not the repaired one.
      const hubTypeRegistered = !!CONFIG.JournalEntryPage.sheetClasses["campaign-hub"];
      await adapter.openHub();
      return { hubTypeRegistered, toolPresent: !!ui.controls?.controls?.notes?.tools?.["campaign-hub"] };
    }, ADAPTER);
    test.info().annotations.push({
      type: "race-window",
      description: raced.hubTypeRegistered
        ? "wiring had already landed before the click (race window closed on this boot)"
        : "clicked before registerHubSheetClass ran (the regression's exact conditions)"
    });

    expect(raced.toolPresent).toBe(true);
    // Hosting-agnostic: the assertion is that the click produced a rendered
    // Hub, wherever this build hosts it (shell subsheet or standalone window).
    await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });
  });

  test("New Session creates the fixture and auto-opens it as the shell's SessionSheet", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });

    // On a world that has campaigns, onNewSession ALWAYS prompts for the
    // destination campaign before creating anything (a deliberate RULING —
    // see CampaignHubPage.onNewSession); a zero-campaign world creates
    // straight away. Both stock targets run this file (world-b on v13 has no
    // campaigns, World A on v14 does), so which shape appears is asserted
    // against the world, not merely recorded.
    const worldHasCampaigns = await page.evaluate(async (id) => {
      const { getCampaigns } = await import(`/modules/${id}/scripts/data/campaign-store.mjs`);
      return getCampaigns().length > 0;
    }, MODULE_ID);

    await page.locator('.mej-cc-hub-container button[data-action="newSession"]').click();

    const campaignPrompt = page.locator('dialog button[data-action="ok"]').first();
    const prompted = await campaignPrompt
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true, () => false);
    test.info().annotations.push({
      type: "new-session-campaign-prompt",
      description: `world has campaigns: ${worldHasCampaigns}; prompted: ${prompted}`
    });
    expect(prompted, "New Session prompts for a destination campaign iff the world has campaigns")
      .toBe(worldHasCampaigns);
    // Confirming takes the dialog's own default selection, which is what a GM
    // pressing Enter would get.
    if (prompted) await campaignPrompt.click();

    // The creation handler opens the page itself (CampaignHubPage.onNewSession
    // -> adapter.openSessionPage) — with the shim installed that routes
    // through MEJ's own open path and lands in the shell.
    await page.waitForSelector(".session-container", { timeout: 15_000 });

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
      out.shellSubsheet = game.MonksEnhancedJournal?.journal?.subsheet?.constructor?.name ?? null;
      // Rename to the fixed cross-phase fixture name. The recap text is
      // fixture setup, not decoration: New Session leaves the recap empty,
      // and the contrast checks below (and in the later scheme test) need a
      // rendered run of session text to measure. Written through the
      // document rather than typed into ProseMirror so the fixture does not
      // depend on the collaborative editor joining.
      if (entry) await entry.update({ name: fixture });
      if (pageDoc) await pageDoc.update({ name: fixture, "system.recap": "<p>Readable session text.</p>" });
      return out;
    }, FIXTURE);

    test.info().annotations.push({ type: "mej-flag-after-create", description: String(result.mejFlagNow) });
    expect(result.created).toBe(true);
    expect(result.nativeType).toBe("mej-campaign-companion.session");
    expect(result.sheetCtor).toBe("SessionSheet");
    expect(result.shellSubsheet).toBe("SessionSheet");

    // Controls responsive: switch to a non-active tab inside the sheet.
    const tabs = await page.evaluate(async () => {
      const el = game.MonksEnhancedJournal.journal.element.querySelector(".session-container");
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
    await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });

    await page.evaluate(async () => {
      const el = document.querySelector(".mej-cc-hub-container");
      const nav = Array.from(el?.querySelectorAll('[data-tab="search"]') ?? [])
        .find((n) => n.tagName !== "DIV");
      nav?.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    await page.locator(".mej-cc-hub-container input.mej-cc-search-input").fill("STOCKSMOKE");
    await settle(page, 1200); // debounce + render

    await expect(
      page.locator(".mej-cc-hub-container .mej-cc-search-row .mej-cc-search-name", { hasText: FIXTURE })
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
    // [data-entry-id] excludes FOLDERS: a folder's <li> is also a
    // .directory-item and its textContent includes every entry inside it, so
    // on a world where the fixture lives in a campaign folder (World A does;
    // onNewSession files it there) a bare .directory-item + hasText matches
    // two rows, and .first() is the folder — clicking inside it opens some
    // unrelated entry. Only document rows carry data-entry-id, which is also
    // what MEJ's own _onClickEntry reads.
    const row = page.locator("#journal .directory-item[data-entry-id]", { hasText: FIXTURE }).first();
    await expect(page.locator("#journal .directory-item[data-entry-id]", { hasText: FIXTURE })).toHaveCount(1);
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

    // Shell hosting: the SessionSheet IS the subsheet; MEJ's JournalEntry
    // page wrapper (the left-hand page index) must be absent.
    const host = await page.evaluate(() => ({
      subsheet: game.MonksEnhancedJournal?.journal?.subsheet?.constructor?.name ?? null,
      wrapper: !!game.MonksEnhancedJournal?.journal?.element?.querySelector(".journal-entry-pages")
    }));
    expect(host.subsheet).toBe("SessionSheet");
    expect(host.wrapper).toBe(false);
    const dark = await textContrast(page, ".session-container .editor-content, .session-container p");
    test.info().annotations.push({ type: "session-contrast-current-scheme", description: JSON.stringify(dark) });
    expect(dark.ratio).toBeGreaterThanOrEqual(4.5);

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

  // A campaign portal is the OTHER document the shell has to host, and it
  // needed its own entry in the shim's `additions` map: a portal entry holds
  // exactly one page whose MEJ flag type is "campaign", and without
  // "campaign" in MEJ's type registry that entry fails the shell's
  // single-page demotion gate — the Hub then renders inside MEJ's
  // JournalEntrySheet page wrapper instead of as the subsheet. api mode has
  // always had this (registerSheetType for "campaign"); native mode did not.
  test("a campaign portal opened from the sidebar hosts the Hub as the shell's subsheet", async ({ page }) => {
    const errors = trackConsoleErrors(page, {
      ignore: [KNOWN_MEJ_SESSION_ICON_404, EXPECTED_INVALID_TYPE_WHILE_DISABLED]
    });
    await bootAsRealUser(page);

    // Through the real entry point: createCampaign builds the folder, the
    // portal entry and the timeline journal together.
    const created = await page.evaluate(async ({ id, name }) => {
      const { createCampaign } = await import(`/modules/${id}/scripts/data/campaign-store.mjs`);
      const autoCaptureBefore = game.settings.get(id, "autoCaptureCampaign");
      const folder = await createCampaign(name, { ownershipDefault: "observer" });
      const portal = (folder?.contents ?? [])
        .find((e) => e.pages.contents.some((p) => p.type === `${id}.campaign`)) ?? null;
      return {
        folderId: folder?.id ?? null,
        portalId: portal?.id ?? null,
        portalPageType: portal?.pages?.contents?.[0]?.type ?? null,
        portalFlagType: portal?.pages?.contents?.[0]?.getFlag("monks-enhanced-journal", "type") ?? null,
        autoCaptureBefore
      };
    }, { id: MODULE_ID, name: CAMPAIGN_FIXTURE });

    try {
      expect(created.folderId).not.toBeNull();
      expect(created.portalId).not.toBeNull();
      expect(created.portalPageType).toBe("mej-campaign-companion.campaign");

      // Spec §9's widening: what MEJ now "knows" once wrap 1 adds our three
      // keys. Recorded, not asserted — these are stock MEJ's surfaces.
      const widening = await page.evaluate(() => {
        const MEJ = game.MonksEnhancedJournal;
        const types = Object.keys(MEJ.getDocumentTypes());
        const labels = Object.keys(MEJ.getTypeLabels?.() ?? {});
        return {
          documentTypes: types.filter((t) => ["session", "campaign", "campaign-hub"].includes(t)),
          // MEJ's create-page dialog is built from getTypeLabels(), which the
          // shim does NOT wrap — so our keys must NOT appear as MEJ page types
          // there. getDocumentTypes is only used in that handler to FILTER core
          // types, and our keys are module-prefixed so no filtering changes.
          inTypeLabels: labels.filter((t) => ["session", "campaign", "campaign-hub"].includes(t)),
          // MEJ.getIcon is a hard-coded switch with a default, so the new
          // keys simply fall through to it — no new asset request.
          icons: {
            session: MEJ.getIcon?.("session") ?? null,
            campaign: MEJ.getIcon?.("campaign") ?? null,
            knownType: MEJ.getIcon?.("person") ?? null
          }
        };
      });
      test.info().annotations.push({ type: "shim-widening", description: JSON.stringify(widening) });

      const row = page.locator(`#journal .directory-item[data-entry-id="${created.portalId}"]`);
      await expect(row).toHaveCount(1, { timeout: 15_000 });
      // Same in-page click the session test uses: the row can sit inside a
      // collapsed folder or outside the headless viewport.
      await row.evaluate((el) => el.querySelector("a.entry-name").click());

      await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });
      const host = await page.evaluate(() => {
        const shell = game.MonksEnhancedJournal?.journal;
        return {
          shellRendered: !!shell?.rendered,
          subsheet: shell?.subsheet?.constructor?.name ?? null,
          hubInShell: !!shell?.element?.querySelector(".mej-cc-hub-container"),
          wrapper: !!shell?.element?.querySelector(".journal-entry-pages")
        };
      });
      test.info().annotations.push({ type: "campaign-portal-host", description: JSON.stringify(host) });
      expect(host.shellRendered).toBe(true);
      expect(host.subsheet).toBe("CampaignHubPage");
      expect(host.hubInShell).toBe(true);
      expect(host.wrapper).toBe(false);

      const companionErrors = errors.filter((t) => t.includes(MODULE_ID));
      expect(companionErrors).toEqual([]);
    } finally {
      // The fixture leaves nothing behind: the portal, the timeline journal,
      // the folder, and (on a world whose first campaign this was) the
      // auto-capture target createCampaign seeded to it.
      await page.evaluate(async (id) => {
        try { await game.MonksEnhancedJournal.journal?.close(); } catch { /* not open */ }
      }, MODULE_ID);
      const removed = await deleteCampaignFixture(page, created.autoCaptureBefore);
      test.info().annotations.push({ type: "campaign-fixture-removed", description: JSON.stringify(removed) });
    }
  });

  test("session and Hub text stay readable under both colour schemes", async ({ page }) => {
    await bootAsRealUser(page);
    try {
      for (const scheme of ["light", "dark"]) {
        await setColorScheme(page, scheme);
        // Opened through the adapter rather than a sidebar click: this test is
        // about what the hosted session LOOKS like, and the sidebar row is not
        // reliably clickable here — MEJ collapses Foundry's directory when its
        // shell opens and that collapse persists across the reload above, so a
        // row click waits forever on a zero-width sidebar. openSessionPage is
        // the same call the sidebar path ends in.
        await page.waitForFunction((f) => !!game.journal.getName(f), FIXTURE, { timeout: 15_000 });
        await page.evaluate(async ({ p, fixture }) => {
          const a = await import(p);
          const entry = game.journal.getName(fixture);
          await a.openSessionPage(entry.pages.contents[0]);
        }, { p: ADAPTER, fixture: FIXTURE });
        await expect(page.locator(".session-container").first()).toBeAttached({ timeout: 15_000 });
        const session = await textContrast(page, ".session-container .editor-content, .session-container p");

        await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
        // The ROW, never the container: querySelector with a selector list
        // returns the first element in DOCUMENT ORDER matching any of them,
        // and the container is an ancestor of every row, so a
        // "row, container" list would always measure the container and never
        // the row's own .theme-dark styling. Wait for a row (the fixture
        // session is in the index) so a missing row fails here rather than
        // silently degrading the measurement.
        await page.waitForSelector(".mej-cc-hub-container .mej-cc-index-row", { timeout: 15_000 });
        const hub = await textContrast(page, ".mej-cc-hub-container .mej-cc-index-row");

        test.info().annotations.push({ type: `contrast-${scheme}`, description: JSON.stringify({ session, hub }) });
        // NaN means nothing was measured (no element, or no painted surface
        // found); reject it explicitly rather than leaning on NaN comparisons.
        expect(Number.isNaN(session.ratio), `session text unmeasurable, ${scheme}: ${session.surface}`).toBe(false);
        expect(Number.isNaN(hub.ratio), `hub row unmeasurable, ${scheme}: ${hub.surface}`).toBe(false);
        expect(session.ratio, `session text, ${scheme}`).toBeGreaterThanOrEqual(4.5);
        expect(hub.ratio, `hub row text, ${scheme}`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await setColorScheme(page, "");
    }
  });

  test("the Hub tab survives a reload and re-resolves to the Hub", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
    await page.waitForSelector(".mej-cc-hub-container", { timeout: 15_000 });
    await reloadGame(page);
    await settle(page, 3000);

    // Stock MEJ does not re-instantiate its shell at ready, so first check
    // the Hub tab is still in the persisted tab list a cold boot restores from.
    const persisted = await page.evaluate(() => {
      const tabs = game.user.getFlag("monks-enhanced-journal", "tabs") ?? [];
      return {
        shellLive: !!game.MonksEnhancedJournal?.journal,
        hubTabs: tabs.filter((t) => t.entityId === "shellpage:campaign-hub").length,
        active: tabs.some((t) => t.entityId === "shellpage:campaign-hub" && t.active)
      };
    });
    expect(persisted.hubTabs).toBe(1);

    // Then render the shell WITHOUT asking for the Hub. MEJ restores the tab
    // list and resolves the ACTIVE tab's entityId through findEntity
    // (13.06 apps/enhanced-journal.js:419-421) — and for the Hub's synthetic
    // "shellpage:campaign-hub" id, wrap 3 of the shim is the only thing that
    // can resolve it. If that wrap regresses the restored tab resolves to
    // nothing and the shell comes up on some other document, so these
    // assertions are unconditional. openHub() is deliberately NOT used here:
    // it would hand MEJ the Hub document itself and prove nothing about the
    // persisted id.
    const after = await page.evaluate(async () => {
      const { EnhancedJournal } = await import("/modules/monks-enhanced-journal/apps/enhanced-journal.js");
      const shell = new EnhancedJournal();
      await shell.render(true);
      game.MonksEnhancedJournal.journal = shell;
      await new Promise((r) => setTimeout(r, 1000));
      return {
        rendered: !!shell.rendered,
        subsheet: shell.subsheet?.constructor?.name ?? null,
        hubTabs: shell.tabs.filter((t) => t.entityId === "shellpage:campaign-hub").length,
        hubInDom: !!shell.element?.querySelector(".mej-cc-hub-container")
      };
    });
    test.info().annotations.push({
      type: "hub-tab-after-reload",
      description: JSON.stringify({ persisted, after })
    });
    expect(after.rendered).toBe(true);
    expect(after.hubTabs).toBe(1);
    expect(after.subsheet).toBe("CampaignHubPage");
    expect(after.hubInDom).toBe(true);
  });

  test("with shell hosting off the standalone windows still work", async ({ page }) => {
    await bootAsRealUser(page);
    await page.evaluate(async (id) => { await game.settings.set(id, "shellHosting", false); }, MODULE_ID);
    await reloadGame(page);
    await settle(page, 2500);
    try {
      const hosting = await page.evaluate(async (p) => (await import(p)).currentHosting(), ADAPTER);
      expect(hosting).toBe("window");
      await page.evaluate(async (p) => { const a = await import(p); await a.openHub(); }, ADAPTER);
      await page.waitForSelector('[id^="CampaignHubPage-"]', { timeout: 15_000 });
      const shellOpen = await page.evaluate(() => !!game.MonksEnhancedJournal?.journal?.rendered);
      expect(shellOpen).toBe(false);
    } finally {
      await page.evaluate(async (id) => { await game.settings.set(id, "shellHosting", true); }, MODULE_ID);
    }
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

    // The run is complete — remove the cross-phase fixture and the shell
    // tabs the stock phase left in the GM's MEJ tab flag.
    await page.evaluate(async () => {
      const doomed = game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE"));
      for (const e of doomed) await e.delete();
    });
    const campaign = await deleteCampaignFixture(page);
    test.info().annotations.push({ type: "campaign-fixture-swept", description: JSON.stringify(campaign) });
    const tabs = await removeShellTabs(page);
    test.info().annotations.push({ type: "shell-tabs-removed", description: JSON.stringify(tabs) });
  });
});

// STOCK_PHASE=cleanup — for a target with no API-carrying MEJ to return to
// (the v13 install: MEJ 13.06 is stock, full stop), the return phase cannot
// run, so this phase removes the cross-phase fixture instead. global-setup's
// TT- sweep also runs for this phase (it only skips for "return").
const cleanupDescribe = PHASE === "cleanup" ? test.describe : test.describe.skip;

cleanupDescribe("stock smoke cleanup — remove the fixture", () => {
  test("no TT-STOCKSMOKE journal, campaign folder or companion shell tab remains", async ({ page }) => {
    await login(page, "Gamemaster");
    const campaign = await deleteCampaignFixture(page);
    test.info().annotations.push({ type: "campaign-fixture-swept", description: JSON.stringify(campaign) });
    const remaining = await page.evaluate(async () => {
      const doomed = game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE"));
      for (const e of doomed) await e.delete();
      return [
        ...game.journal.filter((e) => e.name.includes("TT-STOCKSMOKE")).map((e) => e.id),
        ...game.folders.filter((f) => f.name.includes("TT-STOCKSMOKE")).map((f) => f.id)
      ];
    });
    expect(remaining).toEqual([]);

    const tabs = await removeShellTabs(page);
    test.info().annotations.push({ type: "shell-tabs-removed", description: JSON.stringify(tabs) });
    const leftover = await page.evaluate(() =>
      (game.user.getFlag("monks-enhanced-journal", "tabs") ?? [])
        .filter((t) => String(t?.entityId ?? "").startsWith("shellpage:")).length);
    expect(leftover).toBe(0);
  });
});
