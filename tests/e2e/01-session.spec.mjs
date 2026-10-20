import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, gotoGame, withGmPage, createTtPlainFolder, deleteFoldersById, fallbackCampaignId,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
// Since 0.28.0 the GM client files a FOLDERLESS session into the "New
// Campaign" fallback and raises its default ownership; a session in a plain
// folder is left alone. Every session here except the New Entry dialog test's
// (which asserts that filing) is created inside a plain TT- folder.
const RUN = Date.now().toString(36);
let plainFolderId = null;
const folderOf = (page, id) => page.evaluate((i) => game.journal.get(i)?.folder?.id ?? null, id);

/**
 * True when this world's MEJ carries the extension API. Stock MEJ builds
 * (13.06, 14.01) do not, and the New Entry dialog then cannot offer
 * "Session" at all: its "Single Sheet" optgroup is built from
 * MonksEnhancedJournal.getTypeLabels() (13.06 monks-enhanced-journal.js:4934),
 * which only the fork's externalTypes registry feeds (fork :181-197), and its
 * create path would in any case write a plain "text" page carrying the bare
 * MEJ flag rather than a real `mej-campaign-companion.session` subtype
 * (13.06 :939 vs the fork's externalType carve-out at :1054-1073).
 *
 * Detected through `getApi`/`externalTypes`, the statics the fork puts on
 * `MonksEnhancedJournal` - NOT `registerSheetType`, which lives on the object
 * `getApi()` returns and is therefore absent from `game.MonksEnhancedJournal`
 * on both lines.
 */
async function mejApiPresent(page) {
  return page.evaluate(() => typeof game.MonksEnhancedJournal?.getApi === "function"
    || !!game.MonksEnhancedJournal?.externalTypes);
}

/** Open the journal sidebar and MEJ's "Create Entry" dialog, choose type
 * "Session", submit, and return the created entry's id once MEJ has
 * finished opening it. With `folderId`, the dialog's own folder select puts
 * the entry there. */
async function createSessionViaDialog(page, name, folderId = null) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  // Scoped to the directory header: every FOLDER row in the journal sidebar
  // carries its own icon-only [data-action=createEntry] too, so the unscoped
  // selector became a strict-mode violation as soon as this world grew a
  // campaign folder (World A has real ones now).
  await page.locator("#journal .directory-header [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="name"]').fill(name);
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  // The type list is present and "Session" is one of the options — the
  // exact assertion the brief calls out ("type Session appears").
  await expect(typeSelect.locator('option[value="session"]')).toHaveText("Session");
  await typeSelect.selectOption("session");
  if (folderId) await dialog.locator('select[name="folder"]').selectOption(folderId);
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 800);
  return page.evaluate((n) => game.journal.find((j) => j.name === n)?.id, name);
}

/**
 * A Session entry for the tests that only need one to exist. Routes through
 * MEJ's New Entry dialog where that is possible (the fork's extension API
 * registers the type into the dialog, and the dialog path is worth exercising
 * whenever it is available) and creates the same document directly through
 * the module's own page builder on a stock MEJ, where the dialog cannot offer
 * the type. Everything downstream - the subtype, the MEJ flag, the sheet -
 * is identical either way; only the affordance differs.
 */
async function createSessionEntry(page, name) {
  if (await mejApiPresent(page)) {
    const viaDialog = await createSessionViaDialog(page, name, plainFolderId);
    // The fixture must really sit in the plain folder, not the fallback campaign.
    expect(await folderOf(page, viaDialog)).toBe(plainFolderId);
    return viaDialog;
  }
  const id = await page.evaluate(async ({ n, folder }) => {
    const { buildSessionPageData } = await import("/modules/mej-campaign-companion/scripts/logic/session-page-data.mjs");
    const entry = await JournalEntry.create({ name: n, folder, pages: [buildSessionPageData(n, "", null, null)] });
    await game.MonksEnhancedJournal.openJournalEntry(entry);
    return entry.id;
  }, { n: name, folder: plainFolderId });
  await settle(page, 800);
  return id;
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
  test.beforeAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => { plainFolderId = await createTtPlainFolder(gm, `${TT_PREFIX}01 Sessions ${RUN}`); });
  });
  test.afterAll(async ({ browser }) => {
    await withGmPage(browser, async (gm) => { await deleteFoldersById(gm, [plainFolderId]); });
  });

  test("create via New Entry dialog gets the prefixed subtype + MEJ flag (fix 1437846)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Create`;
    // The dialog affordance itself is what this test is about, and a stock
    // MEJ cannot offer it - see mejApiPresent().
    test.skip(!(await mejApiPresent(page)), "MEJ on this stack has no extension API; the New Entry dialog cannot offer Session");
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

    // Left folderless on purpose: the dialog is one of "every other creation
    // path", so the GM client files it into the "New Campaign" fallback. The
    // global-setup reclaim removes that campaign on the next run.
    await expect.poll(() => folderOf(page, entryId), { timeout: 10_000 }).not.toBeNull();
    expect(await folderOf(page, entryId)).toBe(await fallbackCampaignId(page));
    expect(await page.evaluate((id) => game.journal.get(id).folder.name, entryId)).toBe("New Campaign");

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });

  test("sessionNumber, campaignDate, and a secret persist across a GM reload", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Persist`;
    const entryId = await createSessionEntry(page, name);
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

    await gotoGame(page);
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

  test("recap editor: clicking into the recap opens it, and the base-class editor context menu doesn't error (smoke)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Recap Editor`;
    const entryId = await createSessionEntry(page, name);
    const shell = page.locator("#MonksEnhancedJournal");

    // Always editable (spec 2026-10-19 §4.4): no pencil - a click into the
    // recap's text opens the editor.
    const editorParent = shell.locator('.editor-parent[data-editor-id="recap"]');
    await expect(editorParent).not.toHaveClass(/editing/);
    await editorParent.locator(".editor-display").click();
    await settle(page, 200);
    await expect(editorParent).toHaveClass(/editing/);
    // The editor is mounted on the click and activates (constructing the
    // ProseMirror view, plus the collaborative join) asynchronously - wait
    // for it before interacting, rather than trusting the fixed settle above.
    await expect(editorParent.locator("prose-mirror")).toHaveClass(/active/, { timeout: 10_000 });

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

    const personId = await page.evaluate(async ({ prefix, folder }) => {
      const entry = await JournalEntry.create({
        name: `${prefix}Relationship Person`,
        folder,
        pages: [{ name: `${prefix}Relationship Person`, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } } }]
      });
      return entry.id;
    }, { prefix: TT_PREFIX, folder: plainFolderId });
    const personUuid = await page.evaluate((id) => game.journal.get(id).uuid, personId);

    const sessionName = `${TT_PREFIX}Relationship Session`;
    const sessionId = await createSessionEntry(page, sessionName);
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
    const entryId = await createSessionEntry(gmPage, name);
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

  // S2 (spec Group S), redone by spec 2026-10-19 §4.2: MEJ's shared
  // detailed-header partial drew "Page Name / Type / File Path / Page
  // Category / Sort Order" over empty divs on a Session. The companion header
  // replaces it outright, so it has to keep that partial's two jobs: the
  // sheet's only rename input and its only add-image control.
  test("a fresh Session sheet renders the companion header: rename + add-image in one row, no MEJ header", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Header`;
    const entryId = await createSessionEntry(page, name);
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".session-container .journal-sheet-header")).toHaveCount(0);
    await expect(shell.locator(".session-container nav.sheet-tabs")).toHaveCount(1);
    await expect(shell.locator('.editor-parent[data-editor-id="recap"]')).toHaveCount(1);

    // One rename input, one add-image control (the dashed "+" thumbnail), and
    // the img[data-edit="src"] value carrier that MEJ's FilePicker callback
    // writes to and FormDataExtended reads `src` off (form-data-extended.mjs
    // #processEditableHTML - without it a picked image would be dropped).
    const header = shell.locator(".session-container .mej-cc-session-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator('input[name="name"]')).toHaveValue(name);
    await expect(header.locator('.mej-cc-session-thumb.empty[data-action="addImage"]')).toHaveCount(1);
    await expect(header.locator('img[data-edit="src"]')).toHaveCount(1);
    // One row: thumbnail, title + meta, button - not a stacked block.
    const headerHeight = await header.evaluate((el) => el.getBoundingClientRect().height);
    expect(headerHeight).toBeGreaterThan(0);
    expect(headerHeight).toBeLessThan(100);
    // SessionSheet declares its own DEFAULT_OPTIONS.actions (addImage among
    // them, shadowing MEJ's); ApplicationV2 must still merge MEJ's map in.
    const actions = await page.evaluate(() => {
      const a = game.MonksEnhancedJournal?.journal?.subsheet?.options?.actions ?? {};
      return { addImage: typeof a.addImage, viewImage: typeof a.viewImage, showPlayers: typeof a.showPlayers };
    });
    expect(actions).toEqual({ addImage: "function", viewImage: "function", showPlayers: "function" });

    // A submit that isn't about the name leaves the name alone and does not
    // write a bogus src through the value carrier (JournalEntryPage.src is blank:false).
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 200);
    const numberInput = shell.locator('input[name="flags.mej-campaign-companion.session.sessionNumber"]');
    await numberInput.fill("3");
    await numberInput.blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.sessionNumber === 3,
      entryId
    );
    const afterNumber = await page.evaluate((id) => {
      const p = game.journal.get(id).pages.contents[0];
      return { name: p.name, src: p.src };
    }, entryId);
    expect(afterNumber.name).toBe(name);
    expect(afterNumber.src ?? null).toBe(null);
    await expect(header.locator(".mej-cc-session-number")).toHaveText("#3");

    // And the header input really is the rename control.
    const renamed = `${name} Renamed`;
    await shell.locator('.session-container .mej-cc-session-header input[name="name"]').fill(renamed);
    await shell.locator('.session-container .mej-cc-session-header input[name="name"]').blur();
    await page.waitForFunction(
      ({ id, n }) => game.journal.get(id).pages.contents[0].name === n, { id: entryId, n: renamed });

    // A viewer who cannot edit sees the header (title, meta) but neither the
    // rename input, the add-image control nor the value carrier (MEJ's
    // _toggleDisabled would only grey them out, which is not the same thing).
    await page.evaluate(async (id) => {
      await game.journal.get(id).update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    }, entryId);
    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    await login(playerPage, "User 1");
    await playerPage.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, entryId);
    await settle(playerPage, 600);
    const playerShell = playerPage.locator("#MonksEnhancedJournal");
    await expect(playerShell.locator('.editor-parent[data-editor-id="recap"]')).toHaveCount(1);
    const playerHeader = playerShell.locator(".session-container .mej-cc-session-header");
    await expect(playerHeader).toHaveCount(1);
    await expect(playerHeader.locator(".mej-cc-session-title")).toHaveText(renamed);
    await expect(playerHeader.locator('input[name="name"]')).toHaveCount(0);
    await expect(playerHeader.locator('[data-action="addImage"]')).toHaveCount(0);
    await expect(playerHeader.locator('img[data-edit="src"]')).toHaveCount(0);
    await expect(playerShell.locator(".session-container .journal-sheet-header")).toHaveCount(0);
    // Closed before the delete below: MEJ's shell errors re-rendering a
    // subsheet whose document is deleted out from under it (see the player
    // gmNotes test's own note on that MEJ-side edge case).
    await playerContext.close();

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });

  // An image-bearing Session shows the image as the header's 56px thumbnail
  // (MEJ's detailed header never renders), and the value carrier carries the
  // current src - a submit about anything else must not clear the image.
  test("an image-bearing Session shows the 56px thumbnail and no MEJ header", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Image Header`;
    const entryId = await createSessionEntry(page, name);
    // A path Foundry actually ships, so the thumbnail resolves.
    await page.evaluate(async (id) => {
      const p = game.journal.get(id).pages.contents[0];
      await p.update({ src: "icons/svg/book.svg" });
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, entryId);
    await settle(page, 800);

    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".session-container .journal-sheet-header")).toHaveCount(0);
    const header = shell.locator(".session-container .mej-cc-session-header");
    const thumb = header.locator('.mej-cc-session-thumb[data-action="viewImage"] img');
    await expect(thumb).toHaveAttribute("src", "icons/svg/book.svg");
    const box = await thumb.evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(box)).toBeLessThanOrEqual(56);
    expect(Math.round(box)).toBeGreaterThanOrEqual(50);
    await expect(header.locator('.mej-cc-session-thumb-change[data-action="addImage"]')).toHaveCount(1);
    await expect(header.locator('img[data-edit="src"]')).toHaveAttribute("src", "icons/svg/book.svg");

    // A rename submit keeps the image.
    await header.locator('input[name="name"]').fill(`${name} 2`);
    await header.locator('input[name="name"]').blur();
    await page.waitForFunction(({ id, n }) => game.journal.get(id).pages.contents[0].name === n, { id: entryId, n: `${name} 2` });
    expect(await page.evaluate((id) => game.journal.get(id).pages.contents[0].src, entryId)).toBe("icons/svg/book.svg");

    // Clicking the thumbnail opens a local image popout.
    await shell.locator('.session-container .mej-cc-session-header .mej-cc-session-thumb[data-action="viewImage"]').click();
    await expect.poll(() => page.evaluate(() => [...foundry.applications.instances.values()]
      .some((a) => a instanceof foundry.applications.apps.ImagePopout && a.options?.src === "icons/svg/book.svg")), { timeout: 10_000 }).toBe(true);
    await page.evaluate(() => Promise.all([...foundry.applications.instances.values()]
      .filter((a) => a instanceof foundry.applications.apps.ImagePopout).map((a) => a.close())));

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });
});
