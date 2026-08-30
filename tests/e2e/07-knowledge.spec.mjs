import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, cleanupAsGm,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];

/** Create a person page via the MEJ API, optionally with default ownership. */
async function createPerson(page, name, { text = "", ownership } = {}) {
  return page.evaluate(async ({ n, t, own }) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "monks-enhanced-journal.person",
        flags: { "monks-enhanced-journal": { type: "person" } },
        text: { content: t }
      }],
      ...(own ? { ownership: { default: own } } : {})
    });
    return entry.id;
  }, { n: name, t: text, own: ownership });
}

/** Create a place page via the MEJ API (place uses text.content, no gmFields). */
async function createPlace(page, name, { text = "", ownership } = {}) {
  return page.evaluate(async ({ n, t, own }) => {
    const entry = await JournalEntry.create({
      name: n,
      pages: [{
        name: n,
        type: "monks-enhanced-journal.place",
        flags: { "monks-enhanced-journal": { type: "place" } },
        text: { content: t }
      }],
      ...(own ? { ownership: { default: own } } : {})
    });
    return entry.id;
  }, { n: name, t: text, own: ownership });
}

async function entryUuid(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).uuid, entryId);
}

/** Open an entry's own MEJ-shell sheet (not the Hub) and return the shell + knowledge panel locators. */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  const panel = shell.locator(".mej-cc-knowledge");
  await expect(panel).toHaveCount(1);
  return { shell, panel };
}

async function openHubSearch(page) {
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  await shell.locator('nav.sheet-tabs a[data-tab="search"]').click();
  await settle(page, 200);
  return shell;
}

async function search(shell, page, query) {
  await shell.locator("input.mej-cc-search-input").fill(query);
  await settle(page, 400);
}

/** The attributes <details> renders collapsed by default (no `open` in
 * knowledge-panel.hbs, unlike tags/backlinks) and a full panel rebuild - a
 * knowledge-ui.mjs refresh() reload after any edit - rebuilds it collapsed
 * again each time. Expand it (idempotently) before interacting with anything
 * inside; clicking an already-open <summary> would toggle it CLOSED. */
async function ensureAttrsExpanded(panel) {
  const details = panel.locator(".mej-cc-knowledge-attrs");
  const isOpen = await details.evaluate((el) => el.open);
  if (!isOpen) await details.locator("summary").click();
}

async function cleanupTT(page) {
  await page.evaluate(async () => {
    const ids = game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
  });
}

test.describe("07 knowledge panel", () => {
  test.afterEach(async ({ page, browser }) => {
    await cleanupAsGm(page, browser, async (gmPage) => {
      await cleanupTT(gmPage);
    });
  });

  test("backlinks appear after linking", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const targetName = `${TT_PREFIX}Backlink-Target`;
    const sourceName = `${TT_PREFIX}Backlink-Source`;
    const targetId = await createPerson(page, targetName);
    const targetUuid = await entryUuid(page, targetId);
    await createPlace(page, sourceName, { text: `<p>Home of @UUID[${targetUuid}]{${targetName}}.</p>` });

    const { panel } = await openEntry(page, targetId);
    const backlinks = panel.locator(".mej-cc-knowledge-backlinks");
    const row = backlinks.locator(".mej-cc-backlink-row", { hasText: sourceName });
    await expect(row).toHaveCount(1);
    await expect(row.locator(".mej-cc-backlink-count")).toHaveText("×1");

    assertNoConsoleErrors(errors);
  });

  test("Mentioned-in updates live while the target's sheet stays open", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const targetName = `${TT_PREFIX}Live-Target`;
    const sourceName = `${TT_PREFIX}Live-Source`;
    const targetId = await createPerson(page, targetName);
    const targetUuid = await entryUuid(page, targetId);

    // Open the target FIRST - its panel is built with no mentions yet.
    const { panel } = await openEntry(page, targetId);
    const backlinks = panel.locator(".mej-cc-knowledge-backlinks");
    await expect(backlinks.locator(".mej-cc-backlink-row", { hasText: sourceName })).toHaveCount(0);

    // A mention created elsewhere appears WITHOUT re-opening the sheet
    // (knowledge-ui's tracked-panel refresh, debounced 250ms).
    const sourceId = await createPlace(page, sourceName, {
      text: `<p>Home of @UUID[${targetUuid}]{${targetName}}.</p>`
    });
    await settle(page, 900);
    await expect(backlinks.locator(".mej-cc-backlink-row", { hasText: sourceName })).toHaveCount(1);

    // And disappears again when the mentioning page drops the link.
    await page.evaluate(async (id) => {
      await game.journal.get(id).pages.contents[0].update({ text: { content: "<p>Quiet now.</p>" } });
    }, sourceId);
    await settle(page, 900);
    await expect(backlinks.locator(".mej-cc-backlink-row", { hasText: sourceName })).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("tags round-trip: add via widget, indexed by search, then removed", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const name = `${TT_PREFIX}Tag-Person`;
    const entryId = await createPerson(page, name);
    const { panel } = await openEntry(page, entryId);

    const tagInput = panel.locator(".mej-cc-tag-input");
    await tagInput.click();
    await tagInput.type("villain");
    await tagInput.press("Enter");

    const chip = panel.locator(".mej-cc-tag-chip", { hasText: "villain" });
    await expect(chip).toHaveCount(1);

    // Tags feed the search index (search-index.mjs joins them into
    // fields.tags) - confirm a Hub search for the tag word finds this entry.
    const hubShell = await openHubSearch(page);
    await search(hubShell, page, "villain");
    await expect(hubShell.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

    // Switch back to the entry's own tab to remove the tag.
    await page.evaluate(async (id) => {
      await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
    }, entryId);
    await settle(page, 400);
    const shell = page.locator("#MonksEnhancedJournal");
    const panel2 = shell.locator(".mej-cc-knowledge");
    await panel2.locator(".mej-cc-tag-remove").first().click();
    await expect(panel2.locator(".mej-cc-tag-chip", { hasText: "villain" })).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("attributes: playerHidden values never leak to a player, in the panel or in search", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const name = `${TT_PREFIX}Attr-Person`;
    const entryId = await createPerson(gmPage, name, { ownership: 2 /* OBSERVER */ });
    const { panel } = await openEntry(gmPage, entryId);

    await ensureAttrsExpanded(panel);

    // Add attribute #1: faction = Zhentarim (visible). Every field edit's
    // "change" event runs through knowledge-ui.mjs's debounced
    // commitAttributes() and its refresh() reload re-collapses <details> -
    // settle + re-expand after each committed edit. (The debounce/coalescing
    // fix itself is probed separately, deterministically, in the dedicated
    // race test below - real UI action timing here is not a reliable way to
    // trigger it.)
    await panel.locator(".mej-cc-attr-add").click();
    await settle(gmPage, 500); // refresh() reloads the shell, re-collapsing <details>
    await ensureAttrsExpanded(panel);
    let row = panel.locator("tr[data-attr-id]").last();
    await expect(row).toBeVisible();
    await row.locator(".mej-cc-attr-key").fill("faction");
    await row.locator(".mej-cc-attr-key").blur();
    await settle(gmPage, 700); // let the debounced commit (300ms) fire, then its refresh() reload settle
    await ensureAttrsExpanded(panel);
    row = panel.locator("tr[data-attr-id]").last();
    await row.locator(".mej-cc-attr-value").fill("Zhentarim");
    await row.locator(".mej-cc-attr-value").blur();
    await settle(gmPage, 700);
    await ensureAttrsExpanded(panel);

    // Add attribute #2: patron = Asmodeus (playerHidden) - same pattern.
    await panel.locator(".mej-cc-attr-add").click();
    await settle(gmPage, 500);
    await ensureAttrsExpanded(panel);
    row = panel.locator("tr[data-attr-id]").last();
    await expect(row).toBeVisible();
    await row.locator(".mej-cc-attr-key").fill("patron");
    await row.locator(".mej-cc-attr-key").blur();
    await settle(gmPage, 700);
    await ensureAttrsExpanded(panel);
    row = panel.locator("tr[data-attr-id]").last();
    await row.locator(".mej-cc-attr-value").fill("Asmodeus");
    await row.locator(".mej-cc-attr-value").blur();
    await settle(gmPage, 700);
    await ensureAttrsExpanded(panel);
    row = panel.locator("tr[data-attr-id]").last();
    await row.locator(".mej-cc-attr-hidden").check();
    await settle(gmPage, 700);

    const stored = await gmPage.evaluate((id) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.flags?.["mej-campaign-companion"]?.attributes ?? [];
    }, entryId);
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "faction", value: "Zhentarim", playerHidden: false }),
      expect.objectContaining({ key: "patron", value: "Asmodeus", playerHidden: true })
    ]));

    // GM's own view shows both - read the *input values* (canEdit renders
    // key/value as <input>, whose value lives in the value attribute, not as
    // text content, so textContent()/innerText() on the table would find
    // nothing for a GM regardless of what's stored).
    const gmValues = await panel.locator(".mej-cc-attr-value").evaluateAll((els) => els.map((el) => el.value));
    expect(gmValues).toContain("Asmodeus");

    // GM's Hub search finds the hidden value.
    const gmHub = await openHubSearch(gmPage);
    await search(gmHub, gmPage, "Asmodeus");
    await expect(gmHub.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(1);

    // As player (OBSERVER on this entry): open it, and never see "Asmodeus".
    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
    await login(playerPage, "User 1");
    const { panel: playerPanel } = await openEntry(playerPage, entryId);

    const playerPanelText = await playerPanel.locator(".mej-cc-attr-table").textContent();
    expect(playerPanelText).toContain("faction");
    expect(playerPanelText).not.toContain("Asmodeus");

    const playerHub = await openHubSearch(playerPage);
    await search(playerHub, playerPage, "Asmodeus");
    await expect(playerHub.locator("li.mej-cc-search-row", { hasText: name })).toHaveCount(0);

    assertNoConsoleErrors(errors);
    await playerContext.close();
    await gmContext.close();
  });

  // Mandatory check #2 (task-13-brief deferred item): edit one attribute
  // field, then edit a second before the first field's round trip completes.
  // Dispatched from a single page.evaluate() tick (not two separate
  // Playwright actions) so the two "change" events fire back-to-back
  // deterministically, regardless of real browser/IPC action latency -
  // exactly the race window described in the brief, without depending on
  // wall-clock timing to land it.
  test("attribute edits: two fields changed before the first save round-trips are both persisted (no lost update)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const name = `${TT_PREFIX}Attr-Race-Person`;
    const entryId = await page.evaluate(async (n) => {
      const entry = await JournalEntry.create({
        name: n,
        pages: [{
          name: n,
          type: "monks-enhanced-journal.person",
          flags: {
            "monks-enhanced-journal": { type: "person" },
            "mej-campaign-companion": {
              attributes: [
                { id: "attr-alpha", key: "alpha", value: "one", playerHidden: false },
                { id: "attr-beta", key: "beta", value: "two", playerHidden: false }
              ]
            }
          }
        }]
      });
      return entry.id;
    }, name);

    const { panel } = await openEntry(page, entryId);
    await ensureAttrsExpanded(panel);
    await expect(panel.locator("tr[data-attr-id]")).toHaveCount(2);

    await panel.evaluate((panelEl) => {
      const fire = (id, value) => {
        const input = panelEl.querySelector(`tr[data-attr-id="${id}"] .mej-cc-attr-value`);
        input.value = value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      fire("attr-alpha", "one-updated");
      fire("attr-beta", "two-updated");
    });
    // Debounce window (300ms) + one page.update() round trip + refresh() reload.
    await settle(page, 900);

    const stored = await page.evaluate((id) => {
      const p = game.journal.get(id).pages.contents[0];
      return p.flags?.["mej-campaign-companion"]?.attributes ?? [];
    }, entryId);
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "alpha", value: "one-updated" }),
      expect.objectContaining({ key: "beta", value: "two-updated" })
    ]));

    assertNoConsoleErrors(errors);
  });

  // Task 4b regression. Two Knowledge panels used to end up on one sheet, and
  // once there they never went away: the panel is 130px tall, so two of them
  // took 260px of a 523px sheet, squeezed `.sheet-container` to 211px and left
  // `section.sheet-body` at clientHeight 0 - every control below the header
  // (09-secrets' audience button) present, correctly sized, and simply not
  // painted. Captured live (task-4b-report.md) with injectPanel instrumented,
  // on a plain create-then-open of one entry:
  //
  //   2925 enter    #1 hook:renderJournalPageSheet eid=1 panels=0
  //   2929 enter    #2 refreshTrackedPanels        eid=1 panels=0
  //   2931 rendered #1 hook     eid=1 panels=0
  //   2932 appended #1 hook     eid=1 panels=1
  //   2932 rendered #2 refresh  eid=1 panels=1
  //   2932 appended #2 refresh  eid=1 panels=2
  //
  // injectPanel is async - it awaits renderTemplate - and it used to strip the
  // old panel BEFORE that await and append the new one AFTER it. Two calls for
  // the same element (the render hook, and the debounced refreshTrackedPanels
  // that the create fires) therefore both saw zero panels and both appended.
  // The two assertions below cover both halves of the fix, and both fail
  // without it:
  //  (a) overlapping injections into one element leave exactly one panel. The
  //      hook is dispatched twice in a single tick, which is the same overlap
  //      the capture shows (both calls enter before either appends) driven
  //      deterministically instead of waiting for a 4ms coincidence.
  //  (b) a duplicate already on screen collapses back to one on the next
  //      injection. The old code removed only the FIRST panel per pass, so a
  //      pair was self-sustaining - remove one, append one, still two - which
  //      is why the collapsed sheet in 09-secrets never recovered on re-render.
  test("the Knowledge panel is injected at most once per sheet element, even when two injections overlap", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const name = `${TT_PREFIX}Dup-Panel-Person`;
    const entryId = await createPerson(page, name);
    const { shell } = await openEntry(page, entryId);

    // Dispatching MEJ's own hook is only meaningful if it carries the same
    // arguments MEJ's renderSubSheet passes (the subsheet, its root element).
    // Assert that before relying on what the dispatch does, or a shell that
    // ever stops exposing them would make this test pass by doing nothing.
    const probe = await page.evaluate(() => {
      const journal = game.MonksEnhancedJournal.journal;
      const el = journal?.subsheetElement;
      const sheet = journal?.subsheet;
      return {
        hasElement: el instanceof HTMLElement,
        isPage: sheet?.document instanceof JournalEntryPage,
        docName: sheet?.document?.name ?? null
      };
    });
    expect(probe).toEqual({ hasElement: true, isPage: true, docName: name });

    // (a) two injections that overlap across the template await.
    await page.evaluate(() => {
      const journal = game.MonksEnhancedJournal.journal;
      Hooks.callAll("renderJournalPageSheet", journal.subsheet, journal.subsheetElement, {});
      Hooks.callAll("renderJournalPageSheet", journal.subsheet, journal.subsheetElement, {});
    });
    await settle(page, 500);
    await expect(shell.locator(".mej-cc-knowledge")).toHaveCount(1);

    // (b) a pair already on screen must not survive the next injection.
    await page.evaluate(() => {
      const extra = document.createElement("section");
      extra.className = "mej-cc-knowledge";
      game.MonksEnhancedJournal.journal.subsheetElement.appendChild(extra);
    });
    await expect(shell.locator(".mej-cc-knowledge")).toHaveCount(2);
    await page.evaluate(() => {
      const journal = game.MonksEnhancedJournal.journal;
      Hooks.callAll("renderJournalPageSheet", journal.subsheet, journal.subsheetElement, {});
    });
    await settle(page, 500);
    await expect(shell.locator(".mej-cc-knowledge")).toHaveCount(1);

    assertNoConsoleErrors(errors);
  });

  test("backlink permission leak: a GM-only mentioning entry never appears in a player's Mentioned-in list", async ({ browser }) => {
    const gmContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const gmPage = await gmContext.newPage();
    await login(gmPage, "Gamemaster");

    const targetName = `${TT_PREFIX}Backlink-Target2`;
    const secretName = `${TT_PREFIX}Backlink-Secret`;
    const targetId = await createPerson(gmPage, targetName, { ownership: 2 /* OBSERVER */ });
    const targetUuid = await entryUuid(gmPage, targetId);
    // Default ownership NONE (GM-only) - deliberately no `ownership` override.
    await createPlace(gmPage, secretName, { text: `<p>Secretly linked to @UUID[${targetUuid}]{${targetName}}.</p>` });

    const { panel: gmPanel } = await openEntry(gmPage, targetId);
    await expect(gmPanel.locator(".mej-cc-backlink-row", { hasText: secretName })).toHaveCount(1);

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const errors = trackConsoleErrors(playerPage, { ignore: IGNORE });
    await login(playerPage, "User 1");
    const { panel: playerPanel } = await openEntry(playerPage, targetId);
    await expect(playerPanel.locator(".mej-cc-backlink-row", { hasText: secretName })).toHaveCount(0);

    assertNoConsoleErrors(errors);
    await playerContext.close();
    await gmContext.close();
  });
});
