// Knowledge side rail (spec 2026-10-16 §3): collapsible, push (never overlay),
// state in the knowledgePanelCollapsed client setting, present on the
// popped-out sheet and while editing. GM seat, World A; TT- fixtures.
// Test 3 opens the standalone sheet with `page.sheet.render(true)`, the same
// call 12-native-mode uses for its standalone render. Test 4 enters edit mode
// with the exact editor-open step of 24-entity-from-selection's edit-mode case.
import { test, expect } from "@playwright/test";
import { login, settle, reloadGame, TT_PREFIX, deleteJournalsByPrefix, trackConsoleErrors, assertNoConsoleErrors, KNOWN_MEJ_SESSION_ICON_404 } from "./helpers/foundry.mjs";
import { TARGET } from "./helpers/target.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const RUN = Date.now().toString(36);
const LONG = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i + 1}: Elara runs the locksmith stall by the east gate and trades in rare keys.</p>`).join("");

async function createPerson(page, name) {
  return page.evaluate(async ({ n, t }) => (await JournalEntry.create({
    name: n,
    pages: [{ name: n, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" }, "mej-campaign-companion": { tags: ["alpha"] } }, text: { content: t } }]
  })).id, { n: name, t: LONG });
}

async function openEntry(page, id) {
  await page.evaluate(async (i) => { await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(i)); }, id);
  await settle(page, 500);
  const shell = page.locator("#MonksEnhancedJournal");
  const panel = shell.locator(".mej-cc-knowledge");
  await expect(panel).toHaveCount(1);
  return { shell, panel, row: shell.locator(".mej-cc-rail-row"), body: shell.locator(".mej-cc-rail-row > .sheet-container") };
}

test.describe("39 knowledge rail", () => {
  let personId;
  test.beforeEach(async ({ page }) => {
    await login(page, "Gamemaster");
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false));
    personId = await createPerson(page, `${TT_PREFIX}Rail Person ${RUN}`);
  });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => game.settings.set("mej-campaign-companion", "knowledgePanelCollapsed", false)).catch(() => {});
    await deleteJournalsByPrefix(page);
  });

  test("1. the tab opens and closes the rail; the text column is wider while closed; the state persists across reopen and reload", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    const { panel, body } = await openEntry(page, personId);
    await expect(panel).not.toHaveClass(/collapsed/);
    const tab = panel.locator("button.mej-cc-knowledge-tab");
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    await expect(tab).toHaveText(/^Links( \(\d+\))?$/);
    await expect(tab).toHaveText("Links (1)");
    const openWidth = (await body.boundingBox()).width;

    await tab.click();
    await expect(panel).toHaveClass(/collapsed/);
    await expect(tab).toHaveAttribute("aria-expanded", "false");
    await expect(panel.locator("details").first()).toBeHidden();
    const closedWidth = (await body.boundingBox()).width;
    expect(closedWidth).toBeGreaterThan(openWidth + 100);
    // Closed, the rail is only an edge: at most 26px wide, the folder tab hanging off it.
    expect((await panel.boundingBox()).width).toBeLessThanOrEqual(26);
    await expect(tab).toHaveText(/^Links( \(\d+\))?$/);
    expect(await page.evaluate(() => game.settings.get("mej-campaign-companion", "knowledgePanelCollapsed"))).toBe(true);

    const second = await createPerson(page, `${TT_PREFIX}Rail Second ${RUN}`);
    const { panel: p2 } = await openEntry(page, second);
    await expect(p2).toHaveClass(/collapsed/);

    await reloadGame(page);
    const { panel: p3 } = await openEntry(page, second);
    await expect(p3).toHaveClass(/collapsed/);
    await p3.locator("button.mej-cc-knowledge-tab").click();
    await expect(p3).not.toHaveClass(/collapsed/);
    await expect(p3.locator("details").first()).toBeVisible();
    assertNoConsoleErrors(errors);
  });

  test("2. push, not overlay: the rail never covers the text column and takes at most 40% of the row (300px cap)", async ({ page }) => {
    const { panel, row, body } = await openEntry(page, personId);
    const [r, b, p] = await Promise.all([row.boundingBox(), body.boundingBox(), panel.boundingBox()]);
    console.log(`39 rail widths: row=${r.width} body=${b.width} rail=${p.width} rowH=${r.height} railH=${p.height}`);
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + 1);
    expect(p.width).toBeLessThanOrEqual(Math.min(301, r.width * 0.4 + 1));
    expect(b.width).toBeGreaterThanOrEqual(320);
    // The rail scrolls internally: its body never pushes the sheet taller.
    expect(p.height).toBeLessThanOrEqual(r.height + 1);
  });

  test("3. the rail renders on the popped-out sheet", async ({ page }) => {
    // v13 (stock MEJ 13.06): the standalone sheet class there is BaseSheet,
    // not EnhancedJournalSheet, so "renderEnhancedJournalSheet" never fires
    // and no knowledge panel - bottom strip or rail - has ever been injected
    // into a popped-out sheet on that stack (probed 2026-10-17: AppV2
    // BaseSheet window rendered, zero .mej-cc-knowledge in the document).
    test.skip(TARGET.name === "v13", "no popped-out knowledge panel on stock MEJ 13.06 (BaseSheet render hook)");
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await page.evaluate(async (i) => { await game.journal.get(i).pages.contents[0].sheet.render(true); }, personId);
    const popped = page.locator(".application.monks-enhanced-journal").last();
    await expect(popped.locator(".mej-cc-knowledge")).toHaveCount(1, { timeout: 15_000 });
    // On the popped-out AppV2 sheet MEJ's .sheet-container sits directly in
    // .window-content, so .window-content itself is the rail row.
    await expect(popped.locator(".window-content.mej-cc-rail-row > .sheet-container")).toHaveCount(1);
    const [b, p] = await Promise.all([popped.locator(".mej-cc-rail-row > .sheet-container").boundingBox(), popped.locator(".mej-cc-knowledge").boundingBox()]);
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + 1);
    await page.evaluate(async (i) => { await game.journal.get(i).pages.contents[0].sheet.close(); }, personId);
    assertNoConsoleErrors(errors);
  });

  test("4. edit mode leaves the rail in place", async ({ page }) => {
    const { shell, panel } = await openEntry(page, personId);
    await expect(shell.locator(".editor-parent .editor-display[data-key]").first()).toBeVisible({ timeout: 15_000 });
    // 24-entity-from-selection's edit-mode step, verbatim.
    await shell.locator(".editor-parent").filter({ has: page.locator(".editor-display[data-key]:visible") }).first()
      .locator(".editor-edit").click();
    const editing = shell.locator(".editor-parent.editing");
    await expect(editing).toHaveCount(1, { timeout: 10_000 });
    await expect(editing.locator(".ProseMirror")).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeVisible();
  });
});
