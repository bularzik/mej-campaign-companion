import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

const BASE_URL = "http://localhost:30000";

/** Open the journal sidebar and MEJ's "Create Entry" dialog, choose type
 * "Session", submit, and return the created entry's id once MEJ has
 * finished opening it. */
async function createSessionViaDialog(page, name) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.locator("#journal [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="name"]').fill(name);
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  // The type list is present and "Session" is one of the options — the
  // exact assertion the brief calls out ("type Session appears").
  await expect(typeSelect.locator('option[value="session"]')).toHaveText("Session");
  await typeSelect.selectOption("session");
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 800);
  return page.evaluate((n) => game.journal.find((j) => j.name === n)?.id, name);
}

/** Dispatch a synthetic native drop of a document onto `selector`, matching
 * Foundry's own DragDrop data format ({type, uuid} as text/plain JSON) —
 * exercises the real drop handler without needing OS-level pointer drag. */
async function dropDocumentOnto(page, selector, { type, uuid }) {
  await page.evaluate(({ selector, type, uuid }) => {
    const el = document.querySelector(selector);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type, uuid }));
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    el.dispatchEvent(new DragEvent("dragenter", opts));
    el.dispatchEvent(new DragEvent("dragover", opts));
    el.dispatchEvent(new DragEvent("drop", opts));
  }, { selector, type, uuid });
}

async function cleanupEntries(page, ids) {
  const real = ids.filter(Boolean);
  if (!real.length) return;
  await page.evaluate(async (ids) => {
    await JournalEntry.implementation.deleteDocuments(ids);
  }, real);
}

test.describe("01 session entries", () => {
  test("create via New Entry dialog gets the prefixed subtype + MEJ flag (fix 1437846)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Create`;
    const entryId = await createSessionViaDialog(page, name);
    expect(entryId).toBeTruthy();

    const info = await page.evaluate((id) => {
      const entry = game.journal.get(id);
      const p = entry.pages.contents[0];
      return {
        sourceType: p._source.type,
        memType: p.type,
        flagType: p.getFlag("monks-enhanced-journal", "type"),
        subsheet: game.MonksEnhancedJournal.journal?.subsheet?.constructor?.name
      };
    }, entryId);
    // Persisted type is the Foundry-namespaced module-subtype form; MEJ's
    // fixType() coerces the in-memory .type to the bare key once it
    // recognizes the flag (API.md).
    expect(info).toEqual({
      sourceType: "mej-campaign-companion.session",
      memType: "session",
      flagType: "session",
      subsheet: "SessionSheet"
    });

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });

  test("sessionNumber, campaignDate, and a secret persist across a GM reload", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Persist`;
    const entryId = await createSessionViaDialog(page, name);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 200);

    const numberInput = shell.locator('input[name="flags.mej-campaign-companion.session.sessionNumber"]');
    await numberInput.fill("7");
    await numberInput.blur();
    // Each blur submits a document.update() that re-renders the subsheet.
    // Wait for the write to actually land before the next interaction —
    // otherwise a click can race a re-render in flight and silently miss
    // its (freshly re-created) target element.
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.sessionNumber === 7,
      entryId
    );

    // ⚠️ parked item: the campaignDate tab fields are five independent
    // number inputs relying on AppV2's dot-path FormDataExtended expansion
    // on submit — never exercised in-world before this suite (Task 5's own
    // report, concern #1).
    // month (I5) is a <select> now, not a number input - see sessionMonthOptions'
    // doc comment (scripts/logic/campaign-calendar.mjs) for why. Its option values
    // are 0-based regardless of whether a calendar is active, so selecting "9" here
    // still stores the literal value 9 the assertion below expects.
    const dateFields = { year: "1497", day: "14", hour: "19", minute: "30" };
    for (const [field, value] of Object.entries(dateFields)) {
      const input = shell.locator(`input[name="flags.mej-campaign-companion.session.campaignDate.${field}"]`);
      await input.fill(value);
    }
    await shell.locator('select[name="flags.mej-campaign-companion.session.campaignDate.month"]').selectOption("9");
    await shell.locator('input[name="flags.mej-campaign-companion.session.campaignDate.minute"]').blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.campaignDate?.minute === 30,
      entryId
    );

    await shell.locator('button[data-action="addSecret"]').click();
    await page.waitForFunction(
      (id) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length === 1,
      entryId
    );
    await settle(page, 200);
    const secretInput = shell.locator("li.item input.secret-text").first();
    await secretInput.fill("The baron is a doppelganger");
    await secretInput.blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets?.[0]?.text === "The baron is a doppelganger",
      entryId
    );

    await page.goto(`${BASE_URL}/game`);
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await settle(page, 300);

    const after = await page.evaluate((id) => {
      const entry = game.journal.get(id);
      const p = entry.pages.contents[0];
      const session = p.getFlag("mej-campaign-companion", "session") ?? {};
      return {
        sessionNumber: session.sessionNumber,
        campaignDate: session.campaignDate,
        secretCount: (session.secrets ?? []).length,
        firstSecretText: session.secrets?.[0]?.text
      };
    }, entryId);
    expect(after.sessionNumber).toBe(7);
    expect(after.campaignDate).toEqual({ year: 1497, month: 9, day: 14, hour: 19, minute: 30 });
    expect(after.secretCount).toBe(1);
    expect(after.firstSecretText).toBe("The baron is a doppelganger");

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });

  test("recap editor: header edit button opens it, and the base-class editor context menu doesn't error (smoke)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Recap Editor`;
    const entryId = await createSessionViaDialog(page, name);
    const shell = page.locator("#MonksEnhancedJournal");

    // ⚠️ parked item: header edit button opens the recap editor.
    const editorParent = shell.locator('.editor-parent[data-editor-id="recap"]');
    await expect(editorParent).not.toHaveClass(/editing/);
    await shell.locator('button[data-action="editRecap"]').click();
    await settle(page, 200);
    await expect(editorParent).toHaveClass(/editing/);

    // ⚠️ parked item: base-class editor context menu on system.recap — smoke
    // only (right-click doesn't crash the sheet / throw a console error).
    await editorParent.locator("prose-mirror").click();
    await editorParent.locator("prose-mirror").click({ button: "right" });
    await settle(page, 300);
    await page.keyboard.press("Escape");

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });

  test("relationship drag: linking a person entry to a session shows up on both sheets", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const personId = await page.evaluate(async (prefix) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Relationship Person`,
        pages: [{ name: `${prefix}Relationship Person`, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      return entry.id;
    }, TT_PREFIX);
    const personUuid = await page.evaluate((id) => game.journal.get(id).uuid, personId);

    const sessionName = `${TT_PREFIX}Relationship Session`;
    const sessionId = await createSessionViaDialog(page, sessionName);
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="relationships"]').click();
    await settle(page, 200);

    await dropDocumentOnto(page, ".relationships .items-list", { type: "JournalEntry", uuid: personUuid });
    await settle(page, 500);

    await expect(shell.locator(`.relationships li.item[data-uuid="${personUuid}"]`)).toHaveCount(1);

    const relationships = await page.evaluate((id) => {
      // The relationships flag lives on the PAGE, not the entry.
      const p = game.journal.get(id).pages.contents[0];
      return p.getFlag("monks-enhanced-journal", "relationships");
    }, sessionId);
    expect(Object.values(relationships ?? {}).some((r) => r.uuid === personUuid)).toBe(true);

    await cleanupEntries(page, [personId, sessionId]);
    assertNoConsoleErrors(errors);
  });

  test("player client: gmNotes tab is absent from the DOM, unrevealed secrets are not sent", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const name = `${TT_PREFIX}Session Player View`;
    const entryId = await createSessionViaDialog(gmPage, name);
    const gmShell = gmPage.locator("#MonksEnhancedJournal");
    await gmShell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(gmPage, 200);
    await gmShell.locator('button[data-action="addSecret"]').click();
    await gmPage.waitForFunction(
      (id) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length === 1,
      entryId
    );
    await settle(gmPage, 200);
    const secretInput = gmShell.locator("li.item input.secret-text").first();
    await secretInput.fill("hidden from players");
    await secretInput.blur();
    await gmPage.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets?.[0]?.text === "hidden from players",
      entryId
    );
    // Grant the player OWNER so they can open it directly.
    await gmPage.evaluate(async (id) => {
      await game.journal.get(id).update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
    }, entryId);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
    await login(playerPage, "User 1");
    await playerPage.evaluate(async (id) => {
      const entry = game.journal.get(id);
      await game.MonksEnhancedJournal.openJournalEntry(entry);
    }, entryId);
    await settle(playerPage, 500);
    const playerShell = playerPage.locator("#MonksEnhancedJournal");

    await expect(playerShell.locator('a[data-action="tab"][data-tab="session"]')).toHaveCount(1);
    await playerShell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(playerPage, 200);

    // gmNotes tab section absent entirely (template-gated, not CSS-hidden).
    await expect(playerShell.locator('.editor-parent.gm-notes')).toHaveCount(0);
    // The unrevealed secret's text never reaches the DOM for a player.
    await expect(playerShell.locator("li.item .secret-text")).toHaveCount(0);
    await expect(playerPage.locator("body")).not.toContainText("hidden from players");

    assertNoConsoleErrors(errors);
    // Close the player's context *before* deleting the still-open document —
    // MEJ's shell tries to re-render the player's still-open subsheet when
    // it's deleted out from under them and hits an unrelated bug in that
    // path (EnhancedJournal.renderSubSheet's compendium-visibility check
    // throws "A subclass of Document must implement this getter" on the
    // resulting broken reference). Real but narrow MEJ-side edge case (a GM
    // deleting a doc a player has open), not exercised further here per the
    // brief's "structural MEJ-side issues: STOP, don't fix" guidance —
    // avoided rather than asserted on, since it's not what this test is for.
    await playerContext.close();
    await gmPage.evaluate(async (id) => {
      await JournalEntry.implementation.deleteDocuments([id]);
    }, entryId);
    await gmContext.close();
  });
});
