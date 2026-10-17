// Player-facing Hub (spec 2026-10-15 Plan A): a single-campaign player sees a
// title instead of a picker, Sessions first, no GM blocks on the Session tab,
// and an in-Hub help panel. Fixtures are TT- prefixed and swept.
import { test, expect } from "@playwright/test";
import {
  login, settle, TT_PREFIX, deleteJournalsByPrefix, cleanupStrandedTestFolders, withGmPage,
  trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404,
  hideOtherCampaignsFrom, restoreHidden
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const CAMPAIGN = `${TT_PREFIX}PH Campaign ${RUN}`;
const SESSION = `${TT_PREFIX}PH Session ${RUN}`;
const SESSION_RO = `${TT_PREFIX}PH View-only Session ${RUN}`;

async function seed(page) {
  return page.evaluate(async ({ campaignName, sessionName, roName }) => {
    const { createCampaign, campaignPortal } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
    const folder = await createCampaign(campaignName, { ownershipDefault: "observer" });
    const pageData = buildSessionPageData(sessionName, "<p>We met the duke.</p>", { year: 1497, month: 5, day: 14 }, 12);
    // Explicit default 2 inside an observer campaign: the preCreate ownership
    // hook raises the default to OWNER, so User 1 OWNS this session (that is
    // the product rule for campaign sessions; spec 2026-10-15 item 8).
    const session = await JournalEntry.create({ name: sessionName, folder: folder.id, ownership: { default: 2 }, pages: [pageData] });
    // A view-only session: default NONE (below observer, so the hook does not
    // raise it) with an explicit OBSERVER grant for User 1 alone.
    const user1 = game.users.getName("User 1");
    const ro = await JournalEntry.create({
      name: roName, folder: folder.id,
      ownership: { default: 0, [user1.id]: 2 },
      pages: [buildSessionPageData(roName, "<p>Read only.</p>", null, 11)]
    });
    return { folderId: folder.id, portalId: campaignPortal(folder)?.id ?? null, sessionId: session.id, roSessionId: ro.id };
  }, { campaignName: CAMPAIGN, sessionName: SESSION, roName: SESSION_RO });
}

/** Open a campaign portal entry directly (its page type routes MEJ to the Hub sheet). */
async function openPortal(page, portalId) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, portalId);
  await settle(page, 600);
  return page.locator("#MonksEnhancedJournal");
}

const tabIds = (shell) => shell.locator("nav.sheet-tabs a[data-tab]").evaluateAll((as) => as.map((a) => a.dataset.tab));

test.describe("34 player Hub", () => {
  let ids;

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      ids = await seed(gm);
      // A player counts a campaign when they can see any member entry or its
      // portal, so hide every member and the portal of every OTHER campaign
      // (default ownership only) to leave User 1 exactly one; restored in
      // afterAll (a partial hide is restored by the helper before it throws).
      ids.hidden = await hideOtherCampaignsFrom(gm, [ids.folderId]);
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      await restoreHidden(gm, ids?.hidden);
      await deleteJournalsByPrefix(gm);
      await cleanupStrandedTestFolders(gm);
    });
  });

  test("1. header shows the campaign title and no picker; tabs start with Sessions", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    await expect(shell.locator("[data-campaign-scope-title]")).toHaveText(CAMPAIGN);
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(0);
    const tabs = await tabIds(shell);
    expect(tabs.slice(0, 5)).toEqual(["sessions", "index", "timeline", "graph", "search"]);
    expect(tabs).not.toContain("secrets");
    await expect(shell.locator('nav.sheet-tabs a[data-tab="index"]')).toContainText("Entries");
    assertNoConsoleErrors(errors);
  });

  test("2. Sessions tab lists the session newest first with its preview", async ({ page }) => {
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    await shell.locator('nav.sheet-tabs a[data-tab="sessions"]').click();
    await settle(page, 300);
    const row = shell.locator(".mej-cc-session-row").first();
    await expect(row.locator(".mej-cc-session-number")).toHaveText("Session 12");
    await expect(row.locator(".mej-cc-session-name")).toHaveText(SESSION);
    await expect(row.locator(".mej-cc-session-preview")).toHaveText("We met the duke.");
  });

  async function openSessionTab(page, sessionId) {
    await login(page, "User 1");
    await page.locator('[data-tab="journal"][data-action="tab"]').click();
    await settle(page, 200);
    await page.evaluate(async (id) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id)); }, sessionId);
    await settle(page, 600);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 300);
    return shell;
  }

  test("3a. an owning player sees the attendee drag hint and no Secrets block", async ({ page }) => {
    const shell = await openSessionTab(page, ids.sessionId);
    await expect(shell.locator(".secrets-section")).toHaveCount(0);
    const hint = await page.evaluate(() => game.i18n.localize("MEJCampaignCompanion.session.dragActorHint"));
    await expect(shell.locator(".attendees-list .instruction")).toHaveText(hint);
  });

  test("3b. a view-only player sees 'No attendees recorded yet.' and no Secrets block", async ({ page }) => {
    const shell = await openSessionTab(page, ids.roSessionId);
    await expect(shell.locator(".secrets-section")).toHaveCount(0);
    await expect(shell.locator(".attendees-list .instruction")).toHaveText("No attendees recorded yet.");
  });

  test("4. the Help button opens the panel; the guide link is inside it", async ({ page }) => {
    await login(page, "User 1");
    const shell = await openPortal(page, ids.portalId);
    // The toggle beside the tabs (hub.hbs), not the close button inside the panel.
    await shell.locator("button.mej-cc-help-toggle").click();
    await settle(page, 300);
    await expect(shell.locator(".mej-cc-help li")).toHaveCount(5);
    await expect(shell.locator('.mej-cc-help button[data-action="openHelp"]')).toContainText("Open the full user guide");
    await shell.locator('.mej-cc-help button[data-action="toggleHelp"]').click();
    await settle(page, 300);
    await expect(shell.locator(".mej-cc-help")).toHaveCount(0);
  });

  test("5. GM still gets the picker, Index labelled Entries, Secrets tab present", async ({ page }) => {
    await login(page, "Gamemaster");
    const shell = await openPortal(page, ids.portalId);
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(1);
    expect(await tabIds(shell)).toEqual(["index", "sessions", "timeline", "graph", "search", "dashboards", "secrets"]);
    await expect(shell.locator('nav.sheet-tabs a[data-tab="index"]')).toContainText("Entries");
  });
});
