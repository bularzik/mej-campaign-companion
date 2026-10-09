// Readability guard (2026-10-08 readability sweep). Opens every surface the
// companion renders, in Foundry's light and dark colour schemes, as the GM
// and as a player, and requires WCAG AA text contrast (4.5:1, 3:1 for large
// text) on every companion-owned element - see helpers/contrast.mjs for how
// the effective background is resolved. MEJ's and Foundry's own chrome
// around a surface is out of scope: each check names companion roots only.
//
// A surface that fails to open is a failure too, so a broken opener cannot
// silently shrink the sweep. Every surface is screenshotted into the test's
// output dir; the full result is attached as readability.json.
import { test, expect } from "@playwright/test";
import {
  login, reloadGame, settle, cleanupAsGm, trackConsoleErrors, MODULE_ID,
  deleteJournalsByPrefix, deleteActorsByPrefix, cleanupStrandedTestFolders,
  timelineJournalIds, cleanupTimelineJournals, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";
import { scanContrast, formatFailures } from "./helpers/contrast.mjs";

const PREFIX = "TT-Rd";
const MOD_URL = "/modules/mej-campaign-companion/scripts";
const PDF_SRC = "scripts/pdfjs/web/compressed.tracemonkey-pldi-09.pdf";
const SCHEMES = ["light", "dark"];
// MEJ's client setting "background-image" paints the shell with one of these
// (apsjournal.css) and re-themes MEJ's own text per image; companion text in
// the shell has to stay readable on every one of them, in either scheme.
const MEJ_BACKGROUNDS = [
  "none", "darkParchment", "parchment", "marbleBlack", "marbleWhite", "metalBrushed", "paperCotton",
  "paperCrumpled", "paperCrumpledYellowed", "paperRecycled", "paperRice", "solidBlack", "solidGrey",
  "solidWhite", "woodAlpine", "woodPine"
];

// Seeded once in beforeAll; ids shared by every test in the file.
let seed = null;
let timelineSnapshot = null;
let capturePrior;

async function setColorScheme(page, scheme) {
  await page.evaluate(async (scheme) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "uiConfig"));
    cfg.colorScheme = { applications: scheme, interface: scheme };
    await game.settings.set("core", "uiConfig", cfg);
  }, scheme);
  await reloadGame(page);
  await settle(page, 1500);
}

async function closeShell(page) {
  await page.evaluate(async () => {
    try {
      await Promise.race([game.MonksEnhancedJournal?.journal?.close?.(), new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* nothing open */ }
  });
  await settle(page, 300);
}

async function positionShell(page) {
  await page.evaluate(() => {
    const app = game.MonksEnhancedJournal.journal;
    app?.setPosition({ left: 20, top: 20, width: 1060, height: 840 });
    if (app && !app._collapsed) app.collapseSidebar?.();
    game.tooltip?.deactivate();
    ui.notifications?.clear?.();
  });
  await settle(page, 300);
}

const shell = (page) => page.locator("#MonksEnhancedJournal");

async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  await positionShell(page);
}

async function openHub(page) {
  await page.evaluate(async (mod) => (await import(`${mod}/integrations/mej-adapter.mjs`)).openHub(), MOD_URL);
  await page.waitForSelector("#MonksEnhancedJournal .mej-cc-hub-container", { timeout: 15_000 });
  await positionShell(page);
}

async function hubTab(page, tab) {
  await shell(page).locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 400);
}

async function sheetTab(page, tab) {
  await shell(page).locator(`nav.sheet-tabs a[data-tab="${tab}"]`).first().click();
  await settle(page, 400);
}

/**
 * Call `fnName(arg)` from scripts/apps/`file` without awaiting it (DialogV2 promises resolve on
 * close), wait for it, and tag it so the scan can target exactly that one.
 */
async function openDialog(page, file, fnName, arg) {
  const before = await page.locator("dialog.application").count();
  await page.evaluate(({ url, fnName, arg }) => {
    import(url).then((m) => m[fnName](arg));
  }, { url: `${MOD_URL}/apps/${file}`, fnName, arg });
  await expect.poll(() => page.locator("dialog.application").count(), { timeout: 10_000 }).toBeGreaterThan(before);
  await settle(page, 300);
  await page.evaluate(() => {
    document.querySelectorAll("[data-rd-scan]").forEach((d) => delete d.dataset.rdScan);
    [...document.querySelectorAll("dialog.application")].pop().dataset.rdScan = "1";
  });
  return "[data-rd-scan]";
}

async function closeDialogs(page) {
  for (let i = 0; i < 3 && await page.locator("dialog.application[open]").count(); i++) {
    await page.keyboard.press("Escape");
    await settle(page, 250);
  }
  // Escape does not always reach a DialogV2 that lost focus; close any
  // survivor directly so the next surface's click is not intercepted.
  await page.evaluate(() => Promise.all([...foundry.applications.instances.values()]
    .filter((a) => a instanceof foundry.applications.api.DialogV2).map((a) => a.close())));
  await expect(page.locator("dialog.application[open]")).toHaveCount(0, { timeout: 5_000 });
}

/** Collects results across surfaces; each surface runs isolated. */
function sweeper(page, testInfo, label) {
  const results = [];
  const openFailures = [];
  let shotIndex = 0;
  const check = async (surface, open, roots) => {
    try {
      await open();
      const shotName = `${String(++shotIndex).padStart(2, "0")}-${surface.replace(/[^a-z0-9]+/gi, "-")}.png`;
      await page.screenshot({ path: testInfo.outputPath(shotName) });
      let checked = 0;
      let found = 0;
      for (const root of [].concat(roots)) {
        const r = await scanContrast(page, root);
        checked += r.checked;
        found += r.roots;
        for (const f of r.failures) results.push({ surface, root, ...f });
      }
      if (!found) openFailures.push(`${surface}: no element matched ${[].concat(roots).join(", ")}`);
      else if (!checked) openFailures.push(`${surface}: matched but no visible text in ${[].concat(roots).join(", ")}`);
    } catch (err) {
      if (process.env.RD_DEBUG) console.log("RDDEBUG", surface, err.message);
      openFailures.push(`${surface}: ${String(err.message ?? err).split("\n")[0]}`);
      await closeDialogs(page).catch(() => {});
    }
  };
  const finish = async () => {
    await testInfo.attach("readability.json", {
      body: JSON.stringify({ label, failures: results, openFailures }, null, 2), contentType: "application/json"
    });
    const msg = [
      ...openFailures.map((f) => `[${label}] could not check ${f}`),
      formatFailures(label, results.map((r) => ({ ...r, selector: `${r.surface} :: ${r.selector}` })))
    ].filter(Boolean).join("\n");
    expect(openFailures.length + results.length, msg).toBe(0);
  };
  return { check, finish };
}

test.describe("29 readability", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await login(page, "Gamemaster");
    await deleteJournalsByPrefix(page, PREFIX);
    await deleteActorsByPrefix(page, PREFIX);
    await cleanupStrandedTestFolders(page, { prefix: PREFIX });
    timelineSnapshot = await timelineJournalIds(page);
    capturePrior = await page.evaluate((m) => game.settings.get(m, "autoCaptureCampaign"), MODULE_ID);
    seed = await page.evaluate(async ({ P, mod, pdfSrc, MOD }) => {
      const { createCampaign } = await import(`${mod}/data/campaign-store.mjs`);
      const { ensureTimelineJournal } = await import(`${mod}/data/timeline-journal.mjs`);
      const { addTimepoint, addLink } = await import(`${mod}/data/timepoints.mjs`);
      const { buildSessionPageData } = await import(`${mod}/logic/session-page-data.mjs`);
      const campaign = await createCampaign(`${P} Campaign`, { ownershipDefault: "observer" });
      const mej = (name, type, html, flags = {}) => JournalEntry.create({
        name, folder: campaign.id, ownership: { default: 2 },
        pages: [{ name, type: "text", text: { content: html },
          flags: { "monks-enhanced-journal": { type }, [MOD]: flags } }]
      });
      const actor = await Actor.create({ name: `${P}Actor`, type: "npc", ownership: { default: 2 } });
      const ally = await mej(`${P}Ally`, "person", "<p>A loyal friend.</p>");
      const person = await mej(`${P}Person`, "person",
        `<p>Mentions @UUID[${ally.uuid}]{the ally}.</p>`
        + `<section class="secret" id="secret-rd1"><p>Hidden past.</p></section>`
        + `<p>@CampaignQuery[type:person]</p>`,
        { tags: ["ally", "noble"], attributes: [{ id: "a1", key: "trust", value: "high", playerHidden: false }] });
      // Backlink onto `person` and a relationship row with a revealed secret.
      await ally.pages.contents[0].update({ "text.content": `<p>Owes @UUID[${person.uuid}]{the person}.</p>` });
      await person.pages.contents[0].setFlag("monks-enhanced-journal", "relationships", {
        rdrel1: { id: "rdrel1", uuid: ally.uuid, hidden: false, relationship: "ally", secret: "owes a debt", revealed: true }
      });
      const user1 = game.users.getName("User 1");
      await person.pages.contents[0].update({
        [`flags.${MOD}.secretReveals.secret-rd1`]: { users: [user1.id], groups: [], all: false, revealedAt: Date.now() }
      });
      const sessionName = `${P}Session`;
      const sessionPage = buildSessionPageData(sessionName,
        `<p>We met @UUID[${person.uuid}]{the person}.</p><section class="secret" id="secret-rd2"><p>GM aside.</p></section>`,
        { year: 1497, month: 5, day: 14, hour: 19, minute: 30 }, 12);
      const session = await JournalEntry.create({
        name: sessionName, folder: campaign.id, ownership: { default: 2 }, pages: [sessionPage]
      });
      const media = await JournalEntry.create({
        name: `${P}Doc`, folder: campaign.id, ownership: { default: 2 },
        pages: [{ name: `${P}Doc`, type: "pdf", src: pdfSrc }]
      });
      const tl = await ensureTimelineJournal(campaign);
      const tp = await addTimepoint(tl, `${P}Point`, null, { year: 1497, month: 5, day: 14, hour: 19, minute: 0 });
      await addLink(tl, tp.id, { uuid: person.uuid, name: person.name, type: "JournalEntry" });
      return {
        campaignId: campaign.id, personId: person.id, personUuid: person.uuid, allyId: ally.id, allyUuid: ally.uuid,
        sessionId: session.id, sessionPageUuid: session.pages.contents[0].uuid, mediaId: media.id,
        mediaPageId: media.pages.contents[0].id, actorId: actor.id
      };
    }, { P: PREFIX, mod: MOD_URL, pdfSrc: PDF_SRC, MOD: MODULE_ID });
    await page.evaluate(async (m) => {
      await game.settings.set(m, "hubCampaignScope", "");
      await game.settings.set(m, "hubTimelineSelection", "");
      await game.settings.set(m, "knowledgePanelCollapsed", false);
    }, MODULE_ID);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, "Gamemaster");
    await closeShell(page);
    await page.evaluate(async ({ m, capturePrior }) => {
      await game.settings.set(m, "hubCampaignScope", "");
      await game.settings.set(m, "hubTimelineSelection", "");
      await game.settings.set(m, "autoCaptureCampaign", capturePrior ?? "");
    }, { m: MODULE_ID, capturePrior });
    if (seed?.campaignId) {
      await page.evaluate((id) => game.folders.get(id)?.delete({ deleteSubfolders: true, deleteContents: true }), seed.campaignId);
    }
    await deleteJournalsByPrefix(page, PREFIX);
    await deleteActorsByPrefix(page, PREFIX);
    await cleanupStrandedTestFolders(page, { prefix: PREFIX });
    if (timelineSnapshot) await cleanupTimelineJournals(page, timelineSnapshot, { prefix: PREFIX });
    await page.close();
  });

  for (const scheme of SCHEMES) {
    test(`GM surfaces are readable - ${scheme}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      trackConsoleErrors(page, { ignore: [KNOWN_MEJ_SESSION_ICON_404] });
      await login(page, "Gamemaster");
      await setColorScheme(page, scheme);
      const { check, finish } = sweeper(page, testInfo, `gm/${scheme}`);
      try {
        const S = "#MonksEnhancedJournal";

        // Campaign Hub, every pane and menu, scoped to the seeded campaign.
        await check("hub index", async () => {
          await openHub(page);
          await shell(page).locator('select[name="campaign-scope"]').selectOption(seed.campaignId);
          await settle(page, 600);
          await hubTab(page, "index");
        }, [`${S} .mej-cc-hub-header`, `${S} .mej-cc-index`]);
        await check("hub tools menu", async () => {
          const summary = shell(page).locator(".mej-cc-tools-summary");
          if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
          await settle(page, 300);
        }, `${S} .mej-cc-tools-menu`);
        await check("hub type menu", async () => {
          await page.keyboard.press("Escape");
          await shell(page).locator('button[data-action="toggleTypeMenu"]').click();
          await settle(page, 300);
        }, `${S} .mej-cc-doctype-menu`);
        await check("hub sort menu", async () => {
          await page.keyboard.press("Escape");
          await shell(page).locator('button[data-action="toggleSortMenu"]').click();
          await settle(page, 300);
        }, `${S} .mej-cc-sort-menu`);
        await check("hub timeline", async () => {
          await page.keyboard.press("Escape");
          await hubTab(page, "timeline");
        }, `${S} .mej-cc-timeline`);
        await check("hub search", async () => {
          await hubTab(page, "search");
          await shell(page).locator(".mej-cc-search-input").fill("Person");
          await settle(page, 800);
        }, `${S} .mej-cc-search`);
        await check("hub dashboards", () => hubTab(page, "dashboards"), `${S} .mej-cc-dashboards`);
        await check("hub secrets", () => hubTab(page, "secrets"), `${S} .mej-cc-secrets`);
        await check("hub graph", async () => {
          await hubTab(page, "graph");
          await shell(page).locator('button[data-action="setGraphMode"][data-mode="all"]').click();
          await settle(page, 300);
          await page.evaluate(() => game.MonksEnhancedJournal.journal?.subsheet?.render({ parts: ["main"] }));
          await expect.poll(() => shell(page).locator(".mej-cc-graph-pane .mej-cc-graph-node").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
          await settle(page, 2500);
        }, `${S} .mej-cc-graph-pane`);
        await check("hub add-timepoint dialog", async () => {
          await hubTab(page, "timeline");
          const before = await page.locator("dialog.application").count();
          await shell(page).locator("button.mej-cc-add-timepoint").first().click();
          await expect.poll(() => page.locator("dialog.application").count()).toBeGreaterThan(before);
          await settle(page, 300);
          await page.evaluate(() => { [...document.querySelectorAll("dialog.application")].pop().dataset.rdScan = "1"; });
        }, "[data-rd-scan]");
        await closeDialogs(page);
        await check("hub campaign settings dialog", async () => {
          // Closing the add-timepoint dialog can leave the shell on another
          // page; reopen the Hub (idempotent) rather than assume it is there.
          await openHub(page);
          await hubTab(page, "index");
          await shell(page).locator('select[name="campaign-scope"]').selectOption(seed.campaignId);
          await settle(page, 600);
          const before = await page.locator("dialog.application").count();
          await shell(page).locator("button.mej-cc-edit-campaign").click();
          await expect.poll(() => page.locator("dialog.application").count()).toBeGreaterThan(before);
          await settle(page, 300);
          await page.evaluate(() => {
            document.querySelectorAll("[data-rd-scan]").forEach((d) => delete d.dataset.rdScan);
            [...document.querySelectorAll("dialog.application")].pop().dataset.rdScan = "1";
          });
        }, "[data-rd-scan]");
        await closeDialogs(page);

        // Session sheet: every tab, the campaign-date fieldset included.
        await closeShell(page);
        await check("session recap", async () => {
          await openEntry(page, seed.sessionId);
          await page.waitForSelector(`${S} .session-container`, { timeout: 15_000 });
          await sheetTab(page, "description");
        }, `${S} .session-container`);
        await check("session details", () => sheetTab(page, "session"), `${S} .session-container .session-details`);

        // MEJ person page carrying every companion injection.
        await check("person page injections", async () => {
          await openEntry(page, seed.personId);
          await page.waitForSelector(`${S} .mej-cc-knowledge`, { timeout: 15_000 });
          await page.evaluate(() => {
            document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge").forEach((p) => p.classList.remove("collapsed"));
            document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge details").forEach((d) => { d.open = true; });
          });
          await settle(page, 400);
        }, [`${S} .mej-cc-knowledge`, `${S} .mej-cc-secret-audience`, `${S} .mej-cc-query-embed`, `${S} .mej-cc-actor-link`]);
        // The GM relationships tab carries no companion text: its audience
        // controls are icon-only and the row text is MEJ's own markup.

        await check("media page", async () => {
          await openEntry(page, seed.mediaId);
          await page.waitForSelector(`${S} .mej-cc-media-page`, { timeout: 15_000 });
        }, `${S} .mej-cc-knowledge`);

        // Standalone apps.
        await check("prep board", async () => {
          await page.evaluate(async ({ mod, uuid }) => (await import(`${mod}/apps/prep-board-app.mjs`)).openPrepBoard({ pageUuid: uuid }), { mod: MOD_URL, uuid: seed.sessionPageUuid });
          await page.waitForSelector(".mej-cc-prep-board .mej-cc-prep", { timeout: 15_000 });
          await settle(page, 400);
        }, ".mej-cc-prep-board .window-content");
        await page.evaluate(() => [...foundry.applications.instances.values()].filter((a) => a.element?.classList.contains("mej-cc-prep-board")).forEach((a) => a.close()));
        await check("import wizard", async () => {
          await page.evaluate(async (mod) => (await import(`${mod}/apps/import-wizard.mjs`)).ImportWizard.open(), MOD_URL);
          await page.waitForSelector("#mej-campaign-companion-import", { timeout: 15_000 });
          await settle(page, 400);
        }, "#mej-campaign-companion-import .window-content");
        await check("import wizard review", async () => {
          await page.locator("#mej-campaign-companion-import input[type=file][name=file]").setInputFiles("tests/e2e/fixtures/guide-demo-import.docx");
          await page.waitForSelector("#mej-campaign-companion-import .mej-cc-import-review", { timeout: 60_000 });
          await settle(page, 400);
        }, "#mej-campaign-companion-import .window-content");
        await page.evaluate(() => foundry.applications.instances.get("mej-campaign-companion-import")?.close({ force: true }));
        await settle(page, 300);

        // Dialogs.
        await check("export dialog", () => openDialog(page, "export-dialog.mjs", "openExportDialog"), "[data-rd-scan]");
        await closeDialogs(page);
        await check("audience dialog", () => openDialog(page, "audience-dialog.mjs", "promptAudience", { title: "Reveal", audience: null, groups: [] }), "[data-rd-scan]");
        await closeDialogs(page);
        await check("actor picker", () => openDialog(page, "actor-picker-dialog.mjs", "pickActor", {}), "[data-rd-scan]");
        await closeDialogs(page);
        await check("entity-from-selection dialog", () => openDialog(page, "entity-from-selection-dialog.mjs", "promptEntityFromSelection", { name: "Elowen", lastType: "person" }), "[data-rd-scan]");
        await closeDialogs(page);
        await check("link-to-entity dialog", () => openDialog(page, "link-to-entity-dialog.mjs", "promptLinkTarget",
          [{ uuid: seed.personUuid, name: `${PREFIX}Person`, type: "person", folder: `${PREFIX} Campaign` },
            { uuid: seed.allyUuid, name: `${PREFIX}Ally`, type: "person", folder: null }]), "[data-rd-scan]");
        await closeDialogs(page);
        await check("new campaign dialog", () => openDialog(page, "new-campaign-dialog.mjs", "promptNewCampaign", { name: "Rd" }), "[data-rd-scan]");
        await closeDialogs(page);

        // Foundry sidebar: campaign folder row, New Campaign button, folder menu.
        await closeShell(page);
        await check("journal sidebar", async () => {
          await page.evaluate(() => ui.journal.activate());
          await settle(page, 500);
          // The folder row itself is Foundry's default folder header (the
          // companion only bolds the name), so only the companion's own
          // button is ours to check here.
        }, "#journal .mej-cc-create-campaign");
        await check("folder context menu", async () => {
          // A module-rich world (v13's world-b) pushes the folder below the
          // fold of the sidebar; scroll it in, and if a pointer click is
          // still intercepted, fire the contextmenu event Foundry listens for.
          const header = page.locator(`#journal li.folder[data-folder-id="${seed.campaignId}"] > .folder-header`);
          await header.scrollIntoViewIfNeeded();
          try { await header.click({ button: "right", timeout: 5_000 }); }
          catch { await header.dispatchEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }); }
          await page.waitForSelector("#context-menu", { timeout: 5_000 });
        }, "#context-menu");
        await page.keyboard.press("Escape");
      } finally {
        await closeDialogs(page).catch(() => {});
        await closeShell(page).catch(() => {});
        await setColorScheme(page, "").catch(() => {});
      }
      await finish();
    });

    test(`in-shell surfaces are readable on every MEJ background - ${scheme}`, async ({ page }, testInfo) => {
      test.setTimeout(420_000);
      await login(page, "Gamemaster");
      await setColorScheme(page, scheme);
      const prior = await page.evaluate(() => game.settings.get("monks-enhanced-journal", "background-image"));
      const { check, finish } = sweeper(page, testInfo, `bg/${scheme}`);
      const S = "#MonksEnhancedJournal";
      try {
        for (const bg of MEJ_BACKGROUNDS) {
          await page.evaluate((bg) => game.settings.set("monks-enhanced-journal", "background-image", bg), bg);
          await closeShell(page);
          await check(`${bg}: session details`, async () => {
            await openEntry(page, seed.sessionId);
            await page.waitForSelector(`${S} .session-container`, { timeout: 15_000 });
            await sheetTab(page, "session");
          }, `${S} .session-container .session-details`);
          await check(`${bg}: session recap`, () => sheetTab(page, "description"), `${S} .session-container`);
          await check(`${bg}: person page`, async () => {
            await openEntry(page, seed.personId);
            await page.waitForSelector(`${S} .mej-cc-knowledge`, { timeout: 15_000 });
            await page.evaluate(() => {
              document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge").forEach((p) => p.classList.remove("collapsed"));
              document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge details").forEach((d) => { d.open = true; });
            });
            await settle(page, 300);
          }, [`${S} .mej-cc-knowledge`, `${S} .mej-cc-secret-audience`, `${S} .mej-cc-query-embed`]);
          await check(`${bg}: hub index`, async () => {
            await openHub(page);
            await hubTab(page, "index");
          }, [`${S} .mej-cc-hub-header`, `${S} .mej-cc-index`]);
          await check(`${bg}: hub timeline`, async () => {
            await shell(page).locator('select[name="campaign-scope"]').selectOption(seed.campaignId);
            await settle(page, 500);
            await hubTab(page, "timeline");
          }, `${S} .mej-cc-timeline`);
        }
      } finally {
        await page.evaluate((bg) => game.settings.set("monks-enhanced-journal", "background-image", bg), prior).catch(() => {});
        await page.evaluate((m) => game.settings.set(m, "hubCampaignScope", ""), MODULE_ID).catch(() => {});
        await closeShell(page).catch(() => {});
        await setColorScheme(page, "").catch(() => {});
      }
      await finish();
    });

    test(`player surfaces are readable - ${scheme}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await login(page, "User 1");
      await setColorScheme(page, scheme);
      const { check, finish } = sweeper(page, testInfo, `player/${scheme}`);
      try {
        const S = "#MonksEnhancedJournal";
        await check("player hub index", async () => {
          await openHub(page);
          await hubTab(page, "index");
        }, [`${S} .mej-cc-hub-header`, `${S} .mej-cc-index`]);
        await check("player hub timeline", () => hubTab(page, "timeline"), `${S} .mej-cc-timeline`);
        await closeShell(page);
        await check("player session", async () => {
          await openEntry(page, seed.sessionId);
          await page.waitForSelector(`${S} .session-container`, { timeout: 15_000 });
          await sheetTab(page, "session");
        }, `${S} .session-container .session-details`);
        await check("player person page", async () => {
          await openEntry(page, seed.personId);
          await page.waitForSelector(`${S} .mej-cc-knowledge`, { timeout: 15_000 });
          await page.evaluate(() => {
            document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge").forEach((p) => p.classList.remove("collapsed"));
            document.querySelectorAll("#MonksEnhancedJournal .mej-cc-knowledge details").forEach((d) => { d.open = true; });
          });
          await settle(page, 400);
        }, [`${S} .mej-cc-knowledge`, `${S} section.secret.mej-cc-revealed-to-you`]);
        await check("player relationships", () => sheetTab(page, "relationships"),
          [`${S} .mej-cc-rel-secret, ${S} .mej-cc-rel-revealed, ${S} .mej-cc-known-connections`]);
      } finally {
        await closeShell(page).catch(() => {});
        await setColorScheme(page, "").catch(() => {});
      }
      await finish();
    });
  }
});
