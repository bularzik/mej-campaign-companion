// Plan C (spec 2026-10-15 items 7, 8, 14, 15): campaign scoping of export and
// the party picker, one reveal control per checklist secret, delete confirms.
// Selectors follow the shipped templates; run live by the user only.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm, trackConsoleErrors, assertNoConsoleErrors,
  settle, deleteActorsByPrefix, KNOWN_MEJ_SESSION_ICON_404, cleanupStrandedTestFolders
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const M = "mej-campaign-companion";

async function openEntry(page, entryId, anchorText) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  await expect(shell).toBeVisible();
  await expect(shell).toContainText(anchorText);
  return shell;
}

/**
 * Two campaigns (TT- prefixed): A holds two Persons and a Session with one
 * checklist secret, B holds one Person. The Hub is scoped to A, and A lists
 * User 1 as a Contributor so its party notebook exists for the picker test.
 */
async function seed(page) {
  const ids = await page.evaluate(async ({ prefix, M }) => {
    const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
    const c1 = await createCampaign(`${prefix}Scope-A`, { ownershipDefault: "observer" });
    const c2 = await createCampaign(`${prefix}Scope-B`, { ownershipDefault: "observer" });
    const person = async (name, folder) => JournalEntry.create({
      name, folder: folder.id, ownership: { default: 2 },
      pages: [{ name, type: "text", text: { content: `<p>${name} body</p>` }, flags: { "monks-enhanced-journal": { type: "person" } } }]
    });
    const pa = await person(`${prefix}Scope-PersonA`, c1);
    const pa2 = await person(`${prefix}Scope-PersonA2`, c1);
    const pb = await person(`${prefix}Scope-PersonB`, c2);
    const session = await JournalEntry.create({
      name: `${prefix}Scope-Session`, folder: c1.id,
      pages: [{
        name: "s", type: `${M}.session`,
        flags: {
          [M]: { session: { sessionNumber: 1, campaignDate: null, attendees: [], secrets: [{ id: "k1", text: "scope-clue", revealed: false, revealedAt: null }] } },
          "monks-enhanced-journal": { type: "session" }
        }
      }]
    });
    const u1 = game.users.getName("User 1")?.id;
    if (u1) await c1.update({ [`flags.${M}.campaign.contributors`]: { userIds: [u1], groupIds: [] } });
    await game.settings.set(M, "hubCampaignScope", c1.id);
    return { c1: c1.id, c2: c2.id, pa: pa.id, pa2: pa2.id, pb: pb.id, session: session.id };
  }, { prefix: TT_PREFIX, M });
  // The GM client creates the party notebook on the contributors update.
  await page.waitForFunction(({ M, folder }) => game.journal.some((e) => e.flags?.[M]?.partyNotebook === true && e.folder?.id === folder),
    { M, folder: ids.c1 }, { timeout: 30_000 });
  return ids;
}

test.describe("36 scoping + GM consolidation", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await gmPage.evaluate(async () => {
        const ids = game.journal.filter((e) => e.name?.startsWith("TT-") || e.folder?.name?.startsWith("TT-")).map((e) => e.id);
        if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        await game.settings.set("mej-campaign-companion", "savedQueries", []);
        await game.settings.set("mej-campaign-companion", "hubCampaignScope", "");
        const chatIds = game.messages.filter((m) => m.content?.includes("scope-clue")).map((m) => m.id);
        if (chatIds.length) await ChatMessage.implementation.deleteDocuments(chatIds);
      });
      await cleanupStrandedTestFolders(gmPage);
      await deleteActorsByPrefix(gmPage);
    });
  });

  test("export dialog offers campaign scope and hides other campaigns' rows", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator('button[data-action="toggleToolsMenu"]').click();
    await shell.locator('[data-action="openExportDialog"]').click();
    const dialog = page.locator(".application.dialog", { hasText: "Export to Word" });
    await expect(dialog).toBeVisible();
    const scope = dialog.locator('select[name="scope"]');
    await expect(scope).toHaveValue("campaign");
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonA" }).first()).toBeVisible();
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonB" })).toBeHidden();
    await scope.selectOption("world");
    await expect(dialog.locator(".mej-cc-export-row", { hasText: "Scope-PersonB" })).toBeVisible();
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("party picker lists only same-campaign entries", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator('nav.tabs a[data-tab="relationships"], nav.sheet-tabs a[data-tab="relationships"]').first().click();
    await settle(page, 400);
    await shell.locator(".tab.active[data-tab='relationships'] .mej-cc-party-add button").click();
    const picker = page.locator(".mej-cc-party-picker");
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await expect(picker.locator(".mej-cc-party-pick", { hasText: "Scope-PersonA2" })).toHaveCount(1);
    await expect(picker.locator(".mej-cc-party-pick", { hasText: "Scope-PersonB" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    assertNoConsoleErrors(errors);
  });

  test("checklist secret has one reveal control; Everyone whispers and shows the all mark", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    const shell = await openEntry(page, ids.session, `${TT_PREFIX}Scope-Session`);
    await shell.locator('nav.tabs a[data-tab="session"], nav.sheet-tabs a[data-tab="session"]').first().click();
    await settle(page, 300);
    const row = shell.locator('.secrets-list li[data-id="k1"]');
    // The old eye toggle is gone: the audience control is the only reveal control.
    await expect(row.locator('[data-action="toggleSecret"], .secret-toggle')).toHaveCount(0);
    await expect(row.locator('[data-action="secretAudience"]')).toHaveCount(1);
    await row.locator('[data-action="secretAudience"]').click();
    const dialog = page.locator(".application.dialog", { hasText: "Reveal secret to" });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="all"]').check();
    await dialog.locator("button", { hasText: "Apply" }).click();
    await settle(page, 600);
    await expect(row.locator(".mej-cc-audience-count")).toHaveText("✱");
    const whispered = await page.evaluate(() => game.messages.contents.some((m) => m.content?.includes("scope-clue") && m.whisper?.length));
    expect(whispered).toBe(true);
    assertNoConsoleErrors(errors);
  });

  test("deleting a dashboard asks first", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const ids = await seed(page);
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "savedQueries",
      [{ id: "q1", name: "TT-Dash", query: "type:person", showPlayers: false }]));
    const shell = await openEntry(page, ids.pa, "Scope-PersonA body");
    await shell.locator(".nav-button.campaign-hub").click();
    await settle(page, 500);
    await shell.locator('nav.sheet-tabs a[data-tab="dashboards"]').click();
    const del = shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"] [data-action="deleteDashboard"]');
    await del.click();
    const confirm = page.locator(".application.dialog", { hasText: "Delete dashboard" });
    await expect(confirm).toBeVisible();
    await confirm.locator("button", { hasText: "No" }).click();
    await expect(shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"]')).toBeVisible();
    await del.click();
    await page.locator(".application.dialog", { hasText: "Delete dashboard" }).locator("button", { hasText: "Yes" }).click();
    await expect(shell.locator('.mej-cc-dashboard[data-dashboard-id="q1"]')).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });
});
