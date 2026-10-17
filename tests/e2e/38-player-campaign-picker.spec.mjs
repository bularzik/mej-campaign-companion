// A player's Hub shows exactly their campaigns (spec 2026-10-16 §2). GM seeds
// two TT- campaigns User 1 can see and hides every other campaign from them
// for the duration (restored in afterAll), like 34-player-hub does.
import { test, expect } from "@playwright/test";
import {
  login, settle, TT_PREFIX, withGmPage, deleteJournalsByPrefix, deleteFoldersById,
  createTtCampaign, hideOtherCampaignsFrom, restoreHidden,
  trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";
import { openHub } from "./helpers/hub.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const A = `${TT_PREFIX}PP Alpha ${RUN}`;
const B = `${TT_PREFIX}PP Beta ${RUN}`;
const TOKEN = `lanternfall${RUN}`;

async function seedPerson(gm, name, folderId) {
  return gm.evaluate(async ({ n, f, token }) => (await JournalEntry.create({
    name: n, folder: f, ownership: { default: 2 },
    pages: [{ name: n, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } }, text: { content: `<p>${token}</p>` } }]
  })).id, { n: name, f: folderId, token: TOKEN });
}

test.describe("38 player campaign picker", () => {
  const ids = {};

  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      ids.a = await createTtCampaign(gm, A);
      ids.b = await createTtCampaign(gm, B);
      ids.personA = await seedPerson(gm, `${TT_PREFIX}PP Person A ${RUN}`, ids.a.folderId);
      ids.personB = await seedPerson(gm, `${TT_PREFIX}PP Person B ${RUN}`, ids.b.folderId);
      // An unfiled plain entry User 1 can open, so openHub's shell bootstrap
      // (unfiledBootstrapEntryId) finds one - a player cannot create it.
      await gm.evaluate(async () => JournalEntry.create({
        name: "TT-Hub Bootstrap", ownership: { default: 2 },
        pages: [{ name: "TT-Hub Bootstrap", type: "text", text: { content: "<p>Shell bootstrap for the e2e suite.</p>" } }]
      }));
      ids.hidden = await hideOtherCampaignsFrom(gm, [ids.a.folderId, ids.b.folderId]);
    });
  });

  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => {
      await restoreHidden(gm, ids.hidden);
      await deleteJournalsByPrefix(gm);
      await deleteFoldersById(gm, [ids.a?.folderId, ids.b?.folderId]);
    });
  });

  async function openAsPlayer(page, remembered) {
    await login(page, "User 1");
    await page.evaluate((v) => game.settings.set("mej-campaign-companion", "hubCampaignScope", v), remembered);
    // openHub bootstraps the shell from an UNFILED entry: the Hub button
    // scopes to the shown entry's campaign (spec 2026-10-15 item 4), so
    // openHubViaToolbar (any entry - in World A the owner's Radiant Citadel
    // "Barnaby") would overwrite the remembered scope this spec sets up.
    return openHub(page);
  }
  const optionValues = (shell) => shell.locator('select[name="campaign-scope"] option').evaluateAll((os) => os.map((o) => o.value));
  const selected = (shell) => shell.locator('select[name="campaign-scope"]').inputValue();

  test("1. the picker lists exactly the two visible campaigns, in Hub order, and opens on the first", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const shell = await openAsPlayer(page, "");
    expect(await optionValues(shell)).toEqual([ids.a.folderId, ids.b.folderId]);
    expect(await selected(shell)).toBe(ids.a.folderId);
    await expect(shell.locator("button.mej-cc-new-session")).toHaveCount(0);
    assertNoConsoleErrors(errors);
  });

  test("2. a remembered campaign is used while visible; a stale one falls back to the first", async ({ page }) => {
    const shell = await openAsPlayer(page, ids.b.folderId);
    expect(await selected(shell)).toBe(ids.b.folderId);
    const again = await openAsPlayer(page, "no-such-folder");
    expect(await selected(again)).toBe(ids.a.folderId);
  });

  test("3. Search all widens only the search: the scope stays, the other campaign's hit appears", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const shell = await openAsPlayer(page, ids.a.folderId);
    await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
    await settle(page, 200);
    await shell.locator("input.mej-cc-search-input").fill(TOKEN);
    await settle(page, 600);
    // The hit rows 14-campaigns test 3 counts (templates/hub.hbs).
    const rows = shell.locator("li.mej-cc-search-row");
    await expect(rows).toHaveCount(1);
    const spill = shell.locator("button.mej-cc-search-spillover");
    await expect(spill).toBeVisible();
    await spill.click();
    await settle(page, 600);
    await expect(rows).toHaveCount(2);
    expect(await selected(shell)).toBe(ids.a.folderId);
    assertNoConsoleErrors(errors);
  });

  test("4. zero visible campaigns: the header reads \"No campaigns yet\", no picker, no entry rows", async ({ page, browser }) => {
    let hiddenToo;
    await withGmPage(browser, async (gm) => { hiddenToo = await hideOtherCampaignsFrom(gm, []); });
    try {
      const shell = await openAsPlayer(page, "");
      await expect(shell.locator("h2.mej-cc-campaign-title")).toHaveText("No campaigns yet");
      await expect(shell.locator('select[name="campaign-scope"]')).toHaveCount(0);
      // The Index pane is a div.tab in templates/hub.hbs, not a section.
      await expect(shell.locator('div.tab[data-tab="index"] [data-uuid]')).toHaveCount(0);
    } finally {
      await withGmPage(browser, async (gm) => { await restoreHidden(gm, hiddenToo); });
    }
  });
});
