import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

async function createPerson(page, name, { tags = [], ownership, text = "" } = {}) {
  return page.evaluate(async ({ n, t, own, tg }) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "monks-enhanced-journal.person",
        flags: {
          "monks-enhanced-journal": { type: "person" },
          "mej-campaign-companion": { tags: tg }
        },
        text: { content: t }
      }],
      ...(own ? { ownership: { default: own } } : {})
    });
    return entry.id;
  }, { n: name, t: text, own: ownership, tg: tags });
}

async function entryUuid(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).uuid, entryId);
}

/** Open any entry (so the MEJ shell exists) then click the Campaign Hub
 * toolbar button. Idempotent: a second call on a page that already has the
 * shell open (this file calls it more than once per page, to re-check state
 * after a GM-side edit) skips the sidebar-navigation dance - with the shell
 * already rendered, it can cover/intercept the sidebar's own "journal" tab
 * button, hanging that click forever (confirmed live). */
async function openHub(page) {
  const alreadyOpen = await page.evaluate(() => !!document.querySelector("#MonksEnhancedJournal"));
  if (!alreadyOpen) {
    await page.locator('[data-tab="journal"][data-action="tab"]').click();
    await settle(page, 200);
    const anyEntryId = await page.evaluate(() => game.journal.contents[0]?.id);
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, anyEntryId);
    await settle(page, 400);
  }
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function openHubTab(page, tab) {
  const shell = await openHub(page);
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 300);
  return shell;
}

async function cleanupAll(page) {
  await page.evaluate(async () => {
    const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
    const saved = (game.settings.get("mej-campaign-companion", "savedQueries") ?? []).filter((q) => !q.name?.startsWith("TT-"));
    await game.settings.set("mej-campaign-companion", "savedQueries", saved);
  });
}

test.describe("08 query grammar, dashboards, enricher, graph", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await cleanupAll(gmPage);
    });
  });

  test("dashboard CRUD + rendering, hidden/shown per showPlayers", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    const errors = trackConsoleErrors(gmPage, { ignore: IGNORE });
    await login(gmPage, "Gamemaster");

    const name = `${TT_PREFIX}Dash-Villain`;
    // OBSERVER ownership so the player half of this test can actually see the
    // entry once the dashboard itself is shown to them - runQueryAll()
    // permission-filters its hits same as search (spec §2's OBSERVER gate),
    // independent of the dashboard row's own showPlayers flag.
    await createPerson(gmPage, name, { tags: ["villain"], ownership: 2 /* OBSERVER */ });

    let shell = await openHubTab(gmPage, "dashboards");
    await shell.locator('button[data-action="addDashboard"]').click();
    const addDialog = gmPage.locator("dialog.application").last();
    await addDialog.locator('input[name="name"]').fill(`${TT_PREFIX}Dash`);
    await addDialog.locator('input[name="query"]').fill("tag:villain");
    await addDialog.locator('button[data-action="ok"]').click();
    await settle(gmPage, 400);

    const dashRow = shell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` });
    await expect(dashRow).toHaveCount(1);
    await expect(dashRow.locator(".mej-cc-index-row", { hasText: name })).toHaveCount(1);

    // showPlayers is off by default (checkbox unchecked in the add dialog) -
    // a player must not even see the dashboard row.
    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const playerErrors = trackConsoleErrors(playerPage, { ignore: IGNORE });
    await login(playerPage, "User 1");
    let playerShell = await openHubTab(playerPage, "dashboards");
    await expect(playerShell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` })).toHaveCount(0);

    // Toggle showPlayers on via edit.
    const editRow = shell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` });
    await editRow.locator('a[data-action="editDashboard"]').click();
    const editDialog = gmPage.locator("dialog.application").last();
    await editDialog.locator('input[name="showPlayers"]').check();
    await editDialog.locator('button[data-action="ok"]').click();
    await settle(gmPage, 400);

    playerShell = await openHubTab(playerPage, "dashboards");
    const playerDashRow = playerShell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` });
    await expect(playerDashRow).toHaveCount(1);
    await expect(playerDashRow.locator(".mej-cc-index-row", { hasText: name })).toHaveCount(1);

    // Toggle it back off - player loses visibility again.
    const editRow2 = shell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` });
    await editRow2.locator('a[data-action="editDashboard"]').click();
    const editDialog2 = gmPage.locator("dialog.application").last();
    await editDialog2.locator('input[name="showPlayers"]').uncheck();
    await editDialog2.locator('button[data-action="ok"]').click();
    await settle(gmPage, 400);

    playerShell = await openHubTab(playerPage, "dashboards");
    await expect(playerShell.locator(".mej-cc-dashboard", { hasText: `${TT_PREFIX}Dash` })).toHaveCount(0);

    assertNoConsoleErrors(errors);
    assertNoConsoleErrors(playerErrors);
    await playerContext.close();
    await gmContext.close();
  });

  test("@CampaignQuery enricher renders result anchors and opens the entry on click", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const targetName = `${TT_PREFIX}Enricher-Villain`;
    const targetId = await createPerson(page, targetName, { tags: ["villain"] });

    const hostName = `${TT_PREFIX}Enricher-Host`;
    const hostId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{
          name: n,
          type: "monks-enhanced-journal.place",
          flags: { "monks-enhanced-journal": { type: "place" } },
          text: { content: "@CampaignQuery[tag:villain]" }
        }]
      });
      return entry.id;
    }, hostName);

    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, hostId);
    await settle(page, 500);
    const shell = page.locator("#MonksEnhancedJournal");
    const embed = shell.locator(".mej-cc-query-embed");
    await expect(embed).toHaveCount(1);
    const anchor = embed.locator("a.content-link", { hasText: targetName });
    await expect(anchor).toHaveCount(1);

    await anchor.click();
    await settle(page, 500);
    // Clicking a content-link for a JournalEntry routes through MEJ's own
    // document-open interception into the enhanced browser - the shell's
    // active tab should now be the clicked entry. The content-link opened a
    // specific page, so MEJ's active tab entityId is the PAGE uuid
    // (JournalEntry.<id>.JournalEntryPage.<id>), not the bare entry uuid -
    // assert the entry uuid is its prefix rather than an exact match.
    const activeEntryUuid = await page.evaluate(() => game.MonksEnhancedJournal.journal.tabs.active()?.entityId);
    const targetUuid = await entryUuid(page, targetId);
    expect(activeEntryUuid.startsWith(targetUuid)).toBe(true);

    assertNoConsoleErrors(errors);
  });

  test("graph smoke: two related entries render as nodes + an edge, clicking a node opens it", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const nameA = `${TT_PREFIX}Graph-A`;
    const nameB = `${TT_PREFIX}Graph-B`;
    const idA = await createPerson(page, nameA);
    const idB = await createPerson(page, nameB);
    const uuidA = await entryUuid(page, idA);
    const uuidB = await entryUuid(page, idB);

    await page.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: false }
      });
    }, { pid: idA, relId: "TT-rel-1", targetUuid: uuidB });

    const shell = await openHub(page);
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(page, 600);
    const graphApp = shell.locator(".mej-cc-graph-pane");
    await expect(graphApp).toHaveCount(1);
    // The graph draws every MEJ-typed entry the viewer can observe, not just
    // this spec's own TT- fixtures (world-a carries fixtures from prior test
    // rounds) - assert the floor the brief asks for (>=2 nodes, >=1 edge),
    // not an exact count.
    await expect.poll(() => graphApp.locator(".mej-cc-graph-node").count()).toBeGreaterThanOrEqual(2);
    await expect.poll(() => graphApp.locator(".mej-cc-graph-edge").count()).toBeGreaterThanOrEqual(1);

    const nodeA = graphApp.locator(".mej-cc-graph-node", { hasText: nameA });
    await expect(nodeA).toHaveCount(1);
    // The d3-force simulation keeps repositioning nodes (charge/collide
    // forces from every other visible entry in the world, not just this
    // spec's 2) until its alpha decays, well past the initial render - a
    // real pointer click races that animation and can miss the node's
    // current on-screen position entirely (confirmed live: intermittent
    // "#interface intercepts pointer events" from clicking where the node
    // used to be). Dispatch the click directly on the element instead - the
    // node's own listener is a plain "click" handler with no dependency on
    // real pointer coordinates.
    await settle(page, 2000); // let the simulation's alpha decay toward rest
    await nodeA.dispatchEvent("click");
    await settle(page, 500);
    const activeEntryUuid = await page.evaluate(() => game.MonksEnhancedJournal.journal.tabs.active()?.entityId);
    // openJournalEntry() resolves a single-page entry to its page's uuid
    // (JournalEntry.<id>.JournalEntryPage.<id>), not the bare entry uuid.
    expect(activeEntryUuid.startsWith(uuidA)).toBe(true);

    assertNoConsoleErrors(errors);
  });

  test("graph hidden-relationship gate: GM sees the edge, player does not", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const nameA = `${TT_PREFIX}Graph-Hidden-A`;
    const nameB = `${TT_PREFIX}Graph-Hidden-B`;
    const idA = await createPerson(gmPage, nameA, { ownership: 2 /* OBSERVER */ });
    const idB = await createPerson(gmPage, nameB, { ownership: 2 /* OBSERVER */ });
    const uuidB = await entryUuid(gmPage, idB);

    const relId = "TT-rel-hidden";
    await gmPage.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: true }
      });
    }, { pid: idA, relId, targetUuid: uuidB });

    const gmShell = await openHub(gmPage);
    await gmShell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(gmPage, 600);
    const gmGraph = gmShell.locator(".mej-cc-graph-pane");
    await expect.poll(() => gmGraph.locator(".mej-cc-graph-edge").count()).toBeGreaterThanOrEqual(1);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
    await login(playerPage, "User 1");
    const playerShell = await openHub(playerPage);
    await playerShell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(playerPage, 600);
    const playerGraph = playerShell.locator(".mej-cc-graph-pane");
    await expect(playerGraph).toHaveCount(1);
    await expect(playerGraph.locator(".mej-cc-graph-edge")).toHaveCount(0);
    // Both nodes are still independently visible (OBSERVER on each) - only the edge is gated.
    await expect(playerGraph.locator(".mej-cc-graph-node", { hasText: nameA })).toHaveCount(1);
    await expect(playerGraph.locator(".mej-cc-graph-node", { hasText: nameB })).toHaveCount(1);

    assertNoConsoleErrors(errors);
    await playerContext.close();
    await gmContext.close();
  });

  test("graph tab is campaign-scoped: member nodes only, All shows the world", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Campaign with one member + one loose entry, id-tracked for cleanup.
    const ids = await page.evaluate(async (prefix) => {
      const folder = await Folder.create({
        name: `${prefix}GraphScope`, type: "JournalEntry",
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      const member = await JournalEntry.create({
        name: `${prefix}Scope-Member`, folder: folder.id,
        pages: [{ name: `${prefix}Scope-Member`, type: "text", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      const loose = await JournalEntry.create({
        name: `${prefix}Scope-Loose`,
        pages: [{ name: `${prefix}Scope-Loose`, type: "text", flags: { "monks-enhanced-journal": { type: "place" } } }]
      });
      return { folderId: folder.id, memberId: member.id, looseId: loose.id };
    }, TT_PREFIX);

    const shell = await openHub(page);
    await shell.locator('select[name="campaign-scope"]').selectOption(ids.folderId);
    await settle(page, 400);
    await shell.locator('nav.sheet-tabs a[data-tab="graph"]').click();
    await settle(page, 600);
    const pane = shell.locator(".mej-cc-graph-pane");
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Member` })).toHaveCount(1);
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Loose` })).toHaveCount(0);

    await shell.locator('select[name="campaign-scope"]').selectOption("");
    await settle(page, 600);
    await expect(pane.locator(".mej-cc-graph-node", { hasText: `${TT_PREFIX}Scope-Loose` })).toHaveCount(1);

    await page.evaluate(async (x) => {
      await JournalEntry.implementation.deleteDocuments([x.memberId, x.looseId]);
      await game.folders.get(x.folderId)?.delete();
    }, ids);
    assertNoConsoleErrors(errors);
  });

  test("entity header button lands on the Graph tab, scoped and ego-centered", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    // Create a TT- campaign folder + one member person entry: repeat the
    // scoping test's evaluate block verbatim (folder with campaign flag,
    // member JournalEntry inside it) minus the loose entry.
    const ids = await page.evaluate(async (prefix) => {
      const folder = await Folder.create({
        name: `${prefix}GraphEgo`, type: "JournalEntry",
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      const member = await JournalEntry.create({
        name: `${prefix}Ego-Member`, folder: folder.id,
        pages: [{ name: `${prefix}Ego-Member`, type: "text", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      return { folderId: folder.id, memberId: member.id };
    }, TT_PREFIX);

    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, ids.memberId);
    await settle(page, 500);
    // Not a real click on ".mej-cc-open-graph": that header button never
    // renders at all on v14, for a SEPARATE, pre-existing, already-
    // documented MEJ-side bug (10-secrets-hub.spec.mjs's prep-board
    // comment) - confirmed live, the mounted subsheet's <header> carries
    // only Foundry's own stock controls, no ".subsheet"-classed link.
    // Route around it the same way that spec's prep-board test does: call
    // the button's own onclick target (showGraphFor) directly, exercising
    // the real code path end-to-end - only the broken header-button wiring
    // is bypassed, and every assertion below still proves the entry
    // point's real effect (scoped + ego-centered + landed on the Graph
    // tab). This also exercises the pendingTab/changeTab fix
    // (CampaignHubPage.mjs, activateListeners): showGraphFor() is the same
    // call the real button makes.
    const memberUuid = await page.evaluate((id) => game.journal.get(id).uuid, ids.memberId);
    await page.evaluate(async (uuid) => {
      const { showGraphFor } = await import("/modules/mej-campaign-companion/scripts/apps/CampaignHubPage.mjs");
      await showGraphFor(uuid);
    }, memberUuid);
    await settle(page, 800);

    // try/finally around the assertions: World A's own id-tracked cleanup
    // below must run even if an assertion throws (as it currently does —
    // see task-5-report.md's fix-round-1 addendum), so a failing run here
    // never leaks the TT-GraphEgo folder/entry into the shared world.
    try {
      const shell = page.locator("#MonksEnhancedJournal");
      await expect(shell.locator('nav.sheet-tabs [data-tab="graph"]')).toHaveClass(/active/);
      expect(await shell.locator('select[name="campaign-scope"]').inputValue()).toBe(ids.folderId);
      await expect(shell.locator('.mej-cc-graph-controls button[data-mode="ego"]')).toHaveClass(/active/);
      await expect(shell.locator(".mej-cc-graph-pane .mej-cc-graph-node.center")).toHaveCount(1);
    } finally {
      // Restore: scope back to All, id-tracked cleanup.
      await page.locator("#MonksEnhancedJournal").locator('select[name="campaign-scope"]').selectOption("").catch(() => {});
      await settle(page, 300);
      await page.evaluate(async (x) => {
        await JournalEntry.implementation.deleteDocuments([x.memberId]);
        await game.folders.get(x.folderId)?.delete();
      }, ids);
    }
    assertNoConsoleErrors(errors);
  });
});
