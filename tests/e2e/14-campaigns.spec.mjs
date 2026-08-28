// Campaign container e2e (task-12): creation, membership/index scoping,
// scoped search + spillover, timeline attachment discipline, import-into-
// campaign, world adoption, and campaign-scoped permissions.
//
// World A carries real, pre-existing content (loose MEJ entries and a real
// legacy singleton timeline) that other specs' pre-adoption fallback
// assumptions depend on (see 03-search.spec.mjs) - every campaign Folder,
// subfolder, and entry this file creates is TT_PREFIX-named and explicitly
// torn down (folder cascade delete covers descendants; loose docs are
// deleted by id) so the world is left exactly as found. The one genuinely
// dangerous scenario - world adoption - is run as a fully separate,
// self-restoring describe block BEFORE any campaign exists (see its own
// comment for why real content is never mutated there).
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, withGmPage, cleanupTimelineJournal,
  trackConsoleErrors, assertNoConsoleErrors, settle,
  BASE_URL, KNOWN_MEJ_SESSION_ICON_404, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG
} from "./helpers/foundry.mjs";

const MODULE_ID = "mej-campaign-companion";
const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const DOCX_PATH = "/Users/danbularzik/Claude/Projects/campaign-record/examples/Radiant Citadel.docx";

/** Open any journal entry (bootstraps the MEJ shell), then open the Campaign Hub. Lands on the Index tab. */
async function openHub(page) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  const anyEntryId = await page.evaluate(() => game.journal.contents[0]?.id);
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, anyEntryId);
  await settle(page, 400);
  const shell = page.locator("#MonksEnhancedJournal");
  await shell.locator(".nav-button.campaign-hub").click();
  await settle(page, 500);
  return shell;
}

async function gotoTab(shell, page, tab) {
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 200);
}

/** Select the Hub's campaign-scope <select> ("" = All, "unfiled", or a campaign Folder id). */
async function scopeHub(shell, page, value) {
  await shell.locator('select[name="campaign-scope"]').selectOption(value);
  await settle(page, 300);
}

// ---------------------------------------------------------------------------
// Adoption (isolated + fully restored). Runs first, on purpose: it needs the
// zero-campaign precondition World A starts in (same one 03-search's
// pre-adoption fallback depends on), and must finish before the "14
// campaigns" describe below creates any real campaign.
//
// onAdoptWorld() itself scans game.journal.contents - EVERY loose entry in
// the whole world, not just this suite's fixtures - so clicking the real
// "Adopt" button here would permanently move all of World A's real loose
// content into a new campaign folder. Per the task brief's non-destructive-
// adoption guidance, the move/settings mechanics are instead exercised at
// the API level (page.evaluate) against seeded TT- fixtures only, calling
// the same production functions (adoptionPlan, createCampaign) the real
// action uses - the banner-visibility half needs no seeding at all, since
// World A's real pre-adoption content already makes it visible.
// ---------------------------------------------------------------------------
test.describe.serial("14 campaigns - adoption (isolated, non-destructive)", () => {
  test("banner shown pre-adoption; seeded-fixture move + settings verified at the API level; full restoration", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const prior = await page.evaluate(() => ({
      timelineId: game.settings.get("mej-campaign-companion", "timelineJournalId"),
      prompted: game.settings.get("mej-campaign-companion", "adoptionPrompted"),
      // Fix 6 (createCampaign seeds the auto-capture target on the world's
      // first campaign): this test's own createCampaign() call below is
      // exactly that first-campaign call in a zero-campaign world, so it
      // WILL set this setting - snapshot/restore it like the others.
      captureCampaign: game.settings.get("mej-campaign-companion", "autoCaptureCampaign"),
      // Document-level snapshot, not just the setting: a GM Hub render in a
      // zero-campaign world can side-effect-create a fresh "Campaign
      // Timeline" journal via ensureTimelineJournal() (see the close()
      // comment below) - this suite opens the Hub as GM three times, so the
      // true "left exactly as found" bar is this count matching at the end
      // too, not just the setting value.
      campaignTimelineCount: game.journal.filter((e) => e.name === "Campaign Timeline").length
    }));

    // Defensive: clear any TT- campaign folder left over from a previously
    // crashed run of this very suite before trusting the zero-campaign
    // precondition below. Never touches a non-TT- folder.
    await page.evaluate(async (prefix) => {
      const stray = game.folders.filter((f) =>
        f.type === "JournalEntry" && f.flags?.["mej-campaign-companion"]?.campaign && f.name.startsWith(prefix));
      for (const f of stray) await f.delete({ deleteSubfolders: true, deleteContents: true });
    }, TT_PREFIX);

    const campaignCountBefore = await page.evaluate(async () => {
      const { getCampaigns } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      return getCampaigns().length;
    });
    // This is the precondition that makes the banner meaningfully testable
    // here at all, and the same one 03-search's zero-campaign fallback
    // depends on - fail loudly rather than silently asserting something
    // false if it doesn't hold.
    expect(campaignCountBefore).toBe(0);
    expect(prior.prompted).toBe(false);

    // 1) Banner visibility, against REAL world state - no seeding needed:
    // World A genuinely carries loose MEJ entries pre-adoption.
    let shell = await openHub(page);
    const banner = shell.locator(".mej-cc-adoption-banner");
    await expect(banner).toHaveCount(1);
    await expect(banner).toContainText(/no campaign/i);

    // Close the Hub before touching timelineJournalId below: the Hub's
    // Timeline tab context prep calls ensureTimelineJournal() on every GM
    // render (see CampaignHubPage#_prepareBodyContext), and a currently-
    // OPEN Hub auto-re-renders on document hooks (e.g. the folder delete in
    // the restore step below) - confirmed live as a real race: an
    // interleaved re-render reading timelineJournalId as "" mid-mutation
    // created and persisted a brand-new EMPTY "Campaign Timeline" journal,
    // clobbering the restore that ran right after it. No open Hub, no
    // auto-render, no race.
    await page.evaluate(() => game.MonksEnhancedJournal?.journal?.close?.());
    await settle(page, 300);

    // 2) Move + settings mechanics, entirely against seeded TT- fixtures.
    let seeded = null;
    let campaignId = null;
    try {
      seeded = await page.evaluate(async (prefix) => {
        const legacy = await JournalEntry.create({
          name: `${prefix}Legacy Timeline`,
          flags: { "mej-campaign-companion": { timeline: { timepoints: [] } } },
          ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
        });
        const person = await JournalEntry.create({
          name: `${prefix}Adopt Person`,
          pages: [{ name: `${prefix}Adopt Person`, type: "monks-enhanced-journal.person", flags: { "monks-enhanced-journal": { type: "person" } } }]
        });
        const place = await JournalEntry.create({
          name: `${prefix}Adopt Place`,
          pages: [{ name: `${prefix}Adopt Place`, type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } } }]
        });
        return { legacyId: legacy.id, personId: person.id, placeId: place.id };
      }, TT_PREFIX);

      const result = await page.evaluate(async ({ seeded, prefix }) => {
        const { adoptionPlan } = await import("/modules/mej-campaign-companion/scripts/logic/campaigns.mjs");
        const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const { mejType } = await import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs");
        // adoptionPlan() driven against ONLY the seeded fixtures (never
        // game.journal.contents) - see this describe's header comment.
        const seededDocs = [seeded.legacyId, seeded.personId, seeded.placeId].map((id) => game.journal.get(id));
        const ids = adoptionPlan(seededDocs, mejType, seeded.legacyId);
        const campaign = await createCampaign(`${prefix}Adopted`, { ownershipDefault: "observer" });
        if (ids.length) await JournalEntry.updateDocuments(ids.map((_id) => ({ _id, folder: campaign.id })));
        await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
        await game.settings.set("mej-campaign-companion", "adoptionPrompted", true);
        return {
          planIds: ids.slice().sort(),
          campaignId: campaign.id,
          folders: [seeded.legacyId, seeded.personId, seeded.placeId].map((id) => game.journal.get(id)?.folder?.id ?? null),
          timelineSetting: game.settings.get("mej-campaign-companion", "timelineJournalId")
        };
      }, { seeded, prefix: TT_PREFIX });

      campaignId = result.campaignId;
      expect(result.planIds).toEqual([seeded.legacyId, seeded.personId, seeded.placeId].sort());
      expect(result.folders.every((f) => f === campaignId)).toBe(true);
      expect(result.timelineSetting).toBe("");

      // Fresh open (the Hub was closed above) rather than a re-render of a
      // live instance - same reasoning as the close() above: keep the Hub
      // closed while game state is in flux, only open it to observe.
      shell = await openHub(page);
      await expect(shell.locator(".mej-cc-adoption-banner")).toHaveCount(0);
      await expect(shell.locator('select[name="campaign-scope"] option', { hasText: `${TT_PREFIX}Adopted` })).toHaveCount(1);
      await page.evaluate(() => game.MonksEnhancedJournal?.journal?.close?.());
      await settle(page, 300);
    } finally {
      // Full restoration: delete every seeded/created doc regardless of how
      // far the try block got, then put both world settings back exactly
      // as found. Hub stays closed throughout - see the close() comment above.
      await page.evaluate(async ({ seeded, campaignId, prior }) => {
        if (seeded) {
          const ids = [seeded.legacyId, seeded.personId, seeded.placeId].filter((id) => game.journal.get(id));
          if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
        }
        if (campaignId) {
          const folder = game.folders.get(campaignId);
          if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
        }
        await game.settings.set("mej-campaign-companion", "timelineJournalId", prior.timelineId ?? "");
        await game.settings.set("mej-campaign-companion", "adoptionPrompted", prior.prompted ?? false);
        await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior.captureCampaign ?? "");
      }, { seeded, campaignId, prior });
    }

    const after = await page.evaluate(() => ({
      timelineId: game.settings.get("mej-campaign-companion", "timelineJournalId"),
      prompted: game.settings.get("mej-campaign-companion", "adoptionPrompted"),
      captureCampaign: game.settings.get("mej-campaign-companion", "autoCaptureCampaign"),
      campaignTimelineCount: game.journal.filter((e) => e.name === "Campaign Timeline").length
    }));
    expect(after).toEqual(prior);

    // Final observation only (does the banner genuinely reappear against
    // real world state?) - but this Hub open is itself another GM render
    // in a zero-campaign world, which can side-effect-create a fresh
    // "Campaign Timeline" journal via ensureTimelineJournal() (same
    // mechanism the close()-before-mutating comment above documents), so
    // it has to be treated as one more mutating step, not a read-only
    // check: close the Hub again afterward, run this suite's own safe
    // cleanup + settings restore, then re-assert the world state matches
    // the pre-test snapshot one more time - checked AFTER every mutating
    // step this test performs (including this one), not before the last.
    shell = await openHub(page);
    await expect(shell.locator(".mej-cc-adoption-banner")).toHaveCount(1);
    await page.evaluate(() => game.MonksEnhancedJournal?.journal?.close?.());
    await settle(page, 300);

    // excludeId: prior.timelineId - the journal (if any) that already
    // existed at THIS test's own start is "found" state, full stop, even
    // if it happens to be currently empty (that emptiness is unmanaged
    // churn from some earlier, unrelated run's own Hub-open side effect,
    // not this test's business to judge or clean up). Without excluding
    // it, cleanupTimelineJournal's normal "empty -> safe to delete"
    // heuristic would delete THAT journal too, and the explicit restore
    // right below would then point timelineJournalId at an id that no
    // longer resolves to anything - confirmed live: this is exactly what
    // happened on the first version of this fix.
    await cleanupTimelineJournal(page, { excludeId: prior.timelineId || null });
    await page.evaluate(async (prior) => {
      await game.settings.set("mej-campaign-companion", "timelineJournalId", prior.timelineId ?? "");
      await game.settings.set("mej-campaign-companion", "adoptionPrompted", prior.prompted ?? false);
      await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", prior.captureCampaign ?? "");
    }, prior);

    const final = await page.evaluate(() => ({
      timelineId: game.settings.get("mej-campaign-companion", "timelineJournalId"),
      prompted: game.settings.get("mej-campaign-companion", "adoptionPrompted"),
      captureCampaign: game.settings.get("mej-campaign-companion", "autoCaptureCampaign"),
      campaignTimelineCount: game.journal.filter((e) => e.name === "Campaign Timeline").length
    }));
    expect(final).toEqual(prior);

    assertNoConsoleErrors(errors);
  });
});

// ---------------------------------------------------------------------------
// Main scenarios. Serial: later tests build on Folder/entry ids created by
// earlier ones. HUB_CAMPAIGN_SCOPE_SETTING is a "client"-scoped setting
// (window.localStorage, per Foundry's ClientSettings), so it is NOT shared
// across tests - each Playwright test() gets its own browser context/
// localStorage. Every test that needs a specific scope re-selects it via
// scopeHub() rather than assuming carry-over from a previous test; scenario
// 1 verifies the persistence claim itself within a single test (real page
// reload, same context).
// ---------------------------------------------------------------------------
test.describe.serial("14 campaigns", () => {
  const ALPHA = `${TT_PREFIX}Alpha`;
  const BETA = `${TT_PREFIX}Beta`;
  const TOKEN = "glimmerthorn";

  let alphaId, betaId;
  let personAlphaId, personBetaId, plainAlphaId;
  // Fix 6: createCampaign() seeds AUTO_CAPTURE_CAMPAIGN_SETTING when it's
  // the world's FIRST campaign. By this point the adoption describe block
  // (above, and fully self-restoring) has left the world at zero campaigns,
  // so scenario 1's ALPHA creation below is exactly that first-campaign
  // call and WILL set it - snapshot before, restore in afterAll.
  let captureCampaignPrior;

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await login(page, "Gamemaster");
      await page.evaluate(async ({ alphaId, betaId, captureCampaignPrior }) => {
        for (const id of [alphaId, betaId]) {
          if (!id) continue;
          const folder = game.folders.get(id);
          if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
        }
        // Loose fixtures (Unfiled scenario) are name-prefixed and swept by
        // the harness's global TT- sweep on the next run in any case, but
        // clean up in-run too.
        const loose = game.journal.filter((j) => !j.folder && j.name.startsWith("TT-"));
        if (loose.length) await JournalEntry.implementation.deleteDocuments(loose.map((j) => j.id));
        if (captureCampaignPrior !== undefined) {
          await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", captureCampaignPrior);
        }
      }, { alphaId, betaId, captureCampaignPrior });
    } finally {
      await page.close();
    }
  });

  test("1. create campaign: picker contains it, and scoping persists across a real Hub re-open", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    captureCampaignPrior = await page.evaluate(() => game.settings.get("mej-campaign-companion", "autoCaptureCampaign"));
    const shell = await openHub(page);

    await shell.locator('select[name="campaign-scope"]').selectOption("__new");
    const dialog = page.locator("dialog.application").last();
    await dialog.locator('input[name="name"]').fill(ALPHA);
    await dialog.locator('select[name="baseline"]').selectOption("observer"); // "Players can view"
    await dialog.locator('button[data-action="ok"]').click();
    await settle(page, 400);

    alphaId = await page.evaluate((name) => game.folders.find((f) => f.name === name)?.id, ALPHA);
    expect(alphaId).toBeTruthy();

    await expect(shell.locator('select[name="campaign-scope"] option', { hasText: ALPHA })).toHaveCount(1);
    // onNewCampaign() scopes the Hub to the new campaign immediately.
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue(alphaId);

    // Persistence across a Hub re-open, via a genuine page reload (fresh JS
    // module state) rather than just re-rendering - HUB_CAMPAIGN_SCOPE_SETTING
    // is a "client" setting (localStorage in this same browser context, not
    // the world DB), so reloading the same context is what actually proves it.
    await page.goto(`${BASE_URL}/game`);
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await settle(page, 500);
    const reopened = await openHub(page);
    await expect(reopened.locator('select[name="campaign-scope"]')).toHaveValue(alphaId);

    assertNoConsoleErrors(errors);
  });

  test("2. membership + Journal rows; a loose entry appears under Unfiled AND All (no campaign badge), never when scoped to Alpha", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const seeded = await page.evaluate(async ({ prefix, alphaId, token }) => {
      const person = await JournalEntry.create({
        name: `${prefix}Alpha Person`,
        folder: alphaId,
        pages: [{
          name: `${prefix}Alpha Person`,
          type: "monks-enhanced-journal.person",
          flags: { "monks-enhanced-journal": { type: "person" } },
          text: { content: `A merchant who deals in ${token} dust.` }
        }]
      });
      const plain = await JournalEntry.create({
        name: `${prefix}Alpha Plain`,
        folder: alphaId,
        pages: [{ name: `${prefix}Alpha Plain`, text: { content: "Untyped notes." } }]
      });
      const loose = await JournalEntry.create({
        name: `${prefix}Loose Text`,
        pages: [{ name: `${prefix}Loose Text`, text: { content: "Unfiled notes." } }]
      });
      return { personId: person.id, plainId: plain.id, looseId: loose.id };
    }, { prefix: TT_PREFIX, alphaId, token: TOKEN });
    personAlphaId = seeded.personId;
    plainAlphaId = seeded.plainId;

    const shell = await openHub(page);
    await scopeHub(shell, page, alphaId);

    await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(1);
    const plainRow = shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Plain` });
    await expect(plainRow).toHaveCount(1);
    await expect(plainRow.locator(".mej-cc-index-type")).toHaveText("Journal");
    await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Loose Text` })).toHaveCount(0);

    await scopeHub(shell, page, "unfiled");
    await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Loose Text` })).toHaveCount(1);
    await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(0);

    // RULING (fix 5): All scope means everything - campaign members AND
    // unfiled entries, the latter carrying no campaign badge (only filed
    // rows get one - see #indexContext's `badge` map).
    await scopeHub(shell, page, ""); // All
    await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(1);
    const looseRowAll = shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Loose Text` });
    await expect(looseRowAll).toHaveCount(1);
    await expect(looseRowAll.locator(".mej-cc-row-campaign")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("3. scoped search + spillover", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const seeded = await page.evaluate(async ({ prefix, token }) => {
      const beta = await Folder.create({
        name: `${prefix}Beta`, type: "JournalEntry", folder: null,
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      const person = await JournalEntry.create({
        name: `${prefix}Beta Person`,
        folder: beta.id,
        pages: [{
          name: `${prefix}Beta Person`,
          type: "monks-enhanced-journal.person",
          flags: { "monks-enhanced-journal": { type: "person" } },
          text: { content: `A smuggler who also deals in ${token} dust.` }
        }]
      });
      return { betaId: beta.id, personId: person.id };
    }, { prefix: TT_PREFIX, token: TOKEN });
    betaId = seeded.betaId;
    personBetaId = seeded.personId;

    const shell = await openHub(page);
    await scopeHub(shell, page, betaId);
    await gotoTab(shell, page, "search");
    await shell.locator("input.mej-cc-search-input").fill(TOKEN);
    await settle(page, 400);

    await expect(shell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Beta Person` })).toHaveCount(1);
    await expect(shell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(0);
    const spillover = shell.locator("button.mej-cc-search-spillover");
    await expect(spillover).toHaveCount(1);
    await expect(spillover).toContainText(/1 more/i);

    await spillover.click();
    await settle(page, 400);
    await expect(shell.locator('select[name="campaign-scope"]')).toHaveValue("");
    await expect(shell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Beta Person` })).toHaveCount(1);
    await expect(shell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(1);
    await expect(shell.locator("button.mej-cc-search-spillover")).toHaveCount(0);

    assertNoConsoleErrors(errors);
  });

  test("4. timeline discipline: cross-campaign entry attach is blocked with a warning; media attach is not", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const betaUuid = await page.evaluate((id) => game.journal.get(id)?.uuid, personBetaId);

    const shell = await openHub(page);
    await scopeHub(shell, page, alphaId);
    await gotoTab(shell, page, "timeline");

    // Auto-created the moment a GM scopes to Alpha (not lazily for "All").
    await expect(shell.locator(".mej-cc-timeline-stack")).toHaveCount(1);

    await shell.locator("button.mej-cc-add-timepoint").click();
    const dialog = page.locator("dialog.application").last();
    await dialog.locator('input[name="label"]').fill(`${TT_PREFIX}Alpha Point`);
    await dialog.locator('button[data-action="ok"]').click();
    await settle(page, 400);
    await expect(shell.locator("li.mej-cc-timepoint", { hasText: `${TT_PREFIX}Alpha Point` })).toHaveCount(1);

    // A Beta entry dropped onto an Alpha timepoint: blocked, with a warning,
    // and no link created (spec §3 attachment discipline).
    await page.evaluate(({ uuid }) => {
      const target = document.querySelector("li.mej-cc-timepoint[data-timepoint-id]");
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "JournalEntry", uuid }));
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    }, { uuid: betaUuid });
    await settle(page, 400);
    await expect(page.locator("#notifications li.notification.warning", { hasText: /own campaign/i })).toHaveCount(1);
    await expect(shell.locator(`li.mej-cc-timepoint .mej-cc-link-chip[data-uuid="${betaUuid}"]`)).toHaveCount(0);

    // Media/image drops are NOT subject to the cross-campaign rule (only
    // entries are) - the same timepoint accepts an image drop normally.
    page.once("dialog", (d) => d.accept());
    await page.evaluate(() => {
      const target = document.querySelector("li.mej-cc-timepoint[data-timepoint-id]");
      const dt = new DataTransfer();
      dt.setData("text/uri-list", "icons/svg/mystery-man.svg");
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      target.dispatchEvent(new DragEvent("drop", opts));
    });
    await settle(page, 400);
    const confirmBtn = page.locator('dialog.application button[data-action="yes"]');
    if (await confirmBtn.count()) await confirmBtn.click();
    await settle(page, 400);
    await expect(shell.locator("li.mej-cc-timepoint .mej-cc-link-chip[data-src]")).toHaveCount(1);

    assertNoConsoleErrors(errors);
  });

  test("5. import into campaign: lands under an Alpha subfolder, shows in Alpha's index, and files its timepoint on Alpha's own timeline", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const before = await page.evaluate(async () => {
      const { getTimepoints } = await import("/modules/mej-campaign-companion/scripts/data/timepoints.mjs");
      const legacyId = game.settings.get("mej-campaign-companion", "timelineJournalId");
      const legacy = legacyId ? game.journal.get(legacyId) : null;
      return { legacyId, count: legacy ? getTimepoints(legacy).length : null };
    });

    const shell = await openHub(page);
    await shell.locator(".mej-cc-tools-summary").click();
    await shell.locator('.mej-cc-tools-menu button[data-action="openImportWizard"]').click();
    await settle(page, 300);
    const wizard = page.locator(".mej-cc-import-wizard-app");
    await wizard.locator("input[type=file][name=file]").setInputFiles(DOCX_PATH);
    await wizard.locator(".mej-cc-import-review").waitFor({ timeout: 60_000 });

    await wizard.locator('select[name="destination"]').selectOption({ value: alphaId });
    // subfolder checkbox defaults checked - leave it ("Import into: Alpha" + subfolder).

    const rowCount = await wizard.locator("table.mej-cc-import-sections tbody tr").count();
    expect(rowCount).toBeGreaterThan(10);

    await wizard.locator('button[data-action="createImport"]').click();
    const resultDialog = page.locator("dialog.application", { hasText: /created|import/i }).last();
    await resultDialog.waitFor({ timeout: 60_000 });
    await settle(page, 300);
    const okBtn = resultDialog.locator('button[data-action="ok"]').first();
    if (await okBtn.count()) await okBtn.click();
    await settle(page, 500);

    const summary = await page.evaluate(async ({ alphaId, before }) => {
      const { getTimepoints } = await import("/modules/mej-campaign-companion/scripts/data/timepoints.mjs");
      const alphaFolder = game.folders.get(alphaId);
      // Folder-scoped, not name-matched: World A's real content can contain
      // entries sharing a docx section's generic title (e.g. "Introduction"),
      // so counting "created" by name alone risks false positives from
      // unrelated real entries. Every subfolder of Alpha and everything
      // directly inside one is unambiguously this import's own work.
      const subfolders = game.folders.filter((f) => f.folder?.id === alphaId);
      const subfolderIds = new Set(subfolders.map((f) => f.id));
      const createdUnderAlpha = game.journal.filter((j) => j.folder && subfolderIds.has(j.folder.id));
      const alphaTimeline = alphaFolder.contents.find((e) => e.getFlag("mej-campaign-companion", "timeline"));
      const alphaTimepoints = alphaTimeline ? getTimepoints(alphaTimeline) : [];
      const legacy = before.legacyId ? game.journal.get(before.legacyId) : null;
      const legacyCountAfter = legacy ? getTimepoints(legacy).length : null;
      return {
        createdUnderAlphaCount: createdUnderAlpha.length,
        subfolderCount: subfolders.length,
        alphaTimelineId: alphaTimeline?.id ?? null,
        alphaHasSessionZero: alphaTimepoints.some((t) => t.label?.startsWith("Session Zero")),
        // Proves the singleton legacy timeline was untouched by this import
        // (not a label-content check, which could collide with World A's
        // own real, pre-existing "Session Zero"-labeled content).
        legacyCountUnchanged: legacyCountAfter === before.count
      };
    }, { alphaId, before });

    expect(summary.createdUnderAlphaCount).toBeGreaterThan(10);
    expect(summary.subfolderCount).toBeGreaterThanOrEqual(1);
    expect(summary.alphaTimelineId).toBeTruthy();
    expect(summary.alphaHasSessionZero).toBe(true);
    expect(summary.legacyCountUnchanged).toBe(true);

    await scopeHub(shell, page, alphaId);
    await expect(shell.locator("li.mej-cc-index-row", { hasText: "Session Zero" })).toHaveCount(1);

    assertNoConsoleErrors(errors);
  });

  test("6. New Session in Unfiled scope prompts for a campaign; cancelling keeps it loose", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const beforeIds = await page.evaluate(() => game.journal.filter((j) => j.name === "New Session").map((j) => j.id));

    const shell = await openHub(page);
    await scopeHub(shell, page, "unfiled");
    await shell.locator("button.mej-cc-new-session").click();
    // Two (or more) campaigns exist by now (Alpha + Beta) - promptCampaignChoice()
    // only short-circuits without a dialog when zero or exactly one exists.
    const dialog = page.locator("dialog.application").last();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select[name="campaign"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await settle(page, 500);

    const afterList = await page.evaluate(() =>
      game.journal.filter((j) => j.name === "New Session").map((j) => ({ id: j.id, folder: j.folder?.id ?? null })));
    const created = afterList.find((e) => !beforeIds.includes(e.id));
    expect(created).toBeTruthy();
    expect(created.folder).toBeNull();

    await page.evaluate(async (id) => { await JournalEntry.implementation.deleteDocuments([id]); }, created.id);
    assertNoConsoleErrors(errors);
  });

  test("7. All-mode timeline stacks never lazily create a journal for a campaign no GM has scoped yet", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    const gammaId = await page.evaluate(async (name) => {
      const f = await Folder.create({
        name, type: "JournalEntry", folder: null,
        flags: { "mej-campaign-companion": { campaign: { ownershipDefault: "observer" } } }
      });
      return f.id;
    }, `${TT_PREFIX}Gamma`);

    try {
      const shell = await openHub(page);
      await scopeHub(shell, page, ""); // All
      await gotoTab(shell, page, "timeline");

      const gammaStack = shell.locator(".mej-cc-timeline-stack", { hasText: `${TT_PREFIX}Gamma` });
      await expect(gammaStack).toHaveCount(1);
      await expect(gammaStack).toContainText(/hasn't been created yet/i);
      await expect(gammaStack.locator("button.mej-cc-add-timepoint")).toHaveCount(0);

      const journalExists = await page.evaluate((id) => {
        const folder = game.folders.get(id);
        return folder.contents.some((e) => e.getFlag("mej-campaign-companion", "timeline"));
      }, gammaId);
      expect(journalExists).toBe(false);

      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async (id) => {
        const f = game.folders.get(id);
        if (f) await f.delete({ deleteSubfolders: true, deleteContents: true });
      }, gammaId);
    }
  });

  test("8. permissions from the player seat: apply-to-all never un-hides a NONE member; per-row reveal/hide controls one at a time", async ({ browser }) => {
    // Both Alpha entries seeded in scenario 2 sit at Foundry's create-time
    // ownership default (NONE) - the SAME value setEntryHidden uses for
    // "explicitly hidden via the eye toggle" (fix 3: bulkOwnershipPlan
    // can't tell "never touched" apart from "a GM hid this on purpose", so
    // it treats every NONE entry as off-limits to the bulk shortcut).
    // "Apply now" therefore does NOT reveal them - proven first - and a
    // fresh member only reaches the baseline via its own per-row reveal
    // (the eye toggle), same control a GM uses to hide one afterward.
    await withGmPage(browser, async (gmPage) => {
      const errors = trackConsoleErrors(gmPage, { ignore: IGNORE });
      const shell = await openHub(gmPage);
      await scopeHub(shell, gmPage, alphaId);
      await shell.locator("button.mej-cc-edit-campaign").click();
      const dialog = gmPage.locator("dialog.application").last();
      await expect(dialog.locator('input[name="applyNow"]')).toBeChecked();
      await dialog.locator('button[data-action="ok"]').click();
      await settle(gmPage, 400);

      const stillNone = await gmPage.evaluate(
        ({ personId, plainId }) => [game.journal.get(personId)?.ownership?.default, game.journal.get(plainId)?.ownership?.default],
        { personId: personAlphaId, plainId: plainAlphaId }
      );
      expect(stillNone).toEqual([0, 0]); // CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE - untouched by the bulk apply

      // Per-row reveal brings both up to the baseline the bulk apply couldn't touch.
      for (const label of [`${TT_PREFIX}Alpha Person`, `${TT_PREFIX}Alpha Plain`]) {
        await shell.locator("li.mej-cc-index-row", { hasText: label }).locator("button.mej-cc-row-hide").click();
        await settle(gmPage, 300);
      }
      assertNoConsoleErrors(errors);
    });

    const playerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
    const playerPage = await playerContext.newPage();
    const playerErrors = trackConsoleErrors(playerPage, { ignore: [...IGNORE, KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG] });
    await login(playerPage, "User 1");
    const playerShell = await openHub(playerPage);
    await scopeHub(playerShell, playerPage, alphaId);
    await expect(playerShell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(1);
    await expect(playerShell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Plain` })).toHaveCount(1);
    // Positive control for search too, before hiding.
    await gotoTab(playerShell, playerPage, "search");
    await playerShell.locator("input.mej-cc-search-input").fill(TOKEN);
    await settle(playerPage, 400);
    await expect(playerShell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(1);

    await withGmPage(browser, async (gmPage) => {
      const shell = await openHub(gmPage);
      await scopeHub(shell, gmPage, alphaId);
      const row = shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` });
      await row.locator("button.mej-cc-row-hide").click();
      await settle(gmPage, 400);
    });

    // Force a fresh render against live server state.
    await playerPage.goto(`${BASE_URL}/game`);
    await playerPage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
    await settle(playerPage, 500);
    const reopenedPlayerShell = await openHub(playerPage);
    await scopeHub(reopenedPlayerShell, playerPage, alphaId);
    await expect(reopenedPlayerShell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(0);
    await expect(reopenedPlayerShell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}Alpha Plain` })).toHaveCount(1);

    await gotoTab(reopenedPlayerShell, playerPage, "search");
    await reopenedPlayerShell.locator("input.mej-cc-search-input").fill(TOKEN);
    await settle(playerPage, 400);
    await expect(reopenedPlayerShell.locator("li.mej-cc-search-row", { hasText: `${TT_PREFIX}Alpha Person` })).toHaveCount(0);

    assertNoConsoleErrors(playerErrors);
    await playerContext.close();

    // Fix 3, end to end: a SECOND bulk apply (raising the baseline to
    // "owner") must raise the still-visible Alpha Plain (currently at
    // observer, not NONE) while leaving the now explicitly-hidden Alpha
    // Person (NONE, set by the eye-toggle click above) exactly where it is.
    await withGmPage(browser, async (gmPage) => {
      const shell = await openHub(gmPage);
      await scopeHub(shell, gmPage, alphaId);
      await shell.locator("button.mej-cc-edit-campaign").click();
      const dialog = gmPage.locator("dialog.application").last();
      await dialog.locator('select[name="baseline"]').selectOption("owner");
      await dialog.locator('button[data-action="ok"]').click();
      await settle(gmPage, 400);

      const levels = await gmPage.evaluate(
        ({ personId, plainId }) => [game.journal.get(personId)?.ownership?.default, game.journal.get(plainId)?.ownership?.default],
        { personId: personAlphaId, plainId: plainAlphaId }
      );
      expect(levels).toEqual([0, 3]); // Person stays NONE (hidden); Plain raised to OWNER by the bulk apply
    });
  });

  test("9. unfiled filing: fileIntoCampaign (single row) and fileAllShown (bulk, respecting the current name filter)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    // Fix 6 defensive snapshot/restore: Alpha/Beta already exist by this
    // point in the suite, so this test's own createCampaign() call below is
    // NOT the world's first and shouldn't touch this setting - but restore
    // it anyway rather than assume that invariant holds forever.
    const captureCampaignBefore = await page.evaluate(() => game.settings.get("mej-campaign-companion", "autoCaptureCampaign"));

    let targetId = null;
    let seededIds = [];
    try {
      const seeded = await page.evaluate(async (prefix) => {
        const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const target = await createCampaign(`${prefix}FileTarget`, { ownershipDefault: "observer" });
        const single = await JournalEntry.create({ name: `${prefix}File Single`, pages: [{ name: `${prefix}File Single`, text: { content: "single" } }] });
        const bulkA = await JournalEntry.create({ name: `${prefix}FileBulk Alpha`, pages: [{ name: `${prefix}FileBulk Alpha`, text: { content: "bulk a" } }] });
        const bulkB = await JournalEntry.create({ name: `${prefix}FileBulk Beta`, pages: [{ name: `${prefix}FileBulk Beta`, text: { content: "bulk b" } }] });
        const other = await JournalEntry.create({ name: `${prefix}NotFiled`, pages: [{ name: `${prefix}NotFiled`, text: { content: "excluded" } }] });
        return { targetId: target.id, singleId: single.id, bulkAId: bulkA.id, bulkBId: bulkB.id, otherId: other.id };
      }, TT_PREFIX);
      targetId = seeded.targetId;
      seededIds = [seeded.singleId, seeded.bulkAId, seeded.bulkBId, seeded.otherId];

      const shell = await openHub(page);
      await scopeHub(shell, page, "unfiled");

      // fileIntoCampaign: a single Unfiled row's own "file" button, real UI
      // action through to promptCampaignChoice's dialog (three campaigns
      // now exist - Alpha, Beta, FileTarget - so it prompts, same as
      // scenario 6's onNewSession dialog).
      const singleRow = shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}File Single` });
      await singleRow.locator("button.mej-cc-row-file").click();
      const singleDialog = page.locator("dialog.application").last();
      await expect(singleDialog).toBeVisible();
      await expect(singleDialog.locator('select[name="campaign"]')).toHaveCount(1);
      await singleDialog.locator('select[name="campaign"]').selectOption({ label: `${TT_PREFIX}FileTarget` });
      await singleDialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);

      // Filed - no longer an Unfiled row.
      await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}File Single` })).toHaveCount(0);

      // fileAllShown: bulk-files whatever the CURRENT name filter shows,
      // not every Unfiled row - filter down to only the "FileBulk" pair
      // first, leaving NotFiled out of scope.
      await shell.locator('input[name="index-filter"]').fill(`${TT_PREFIX}FileBulk`);
      await settle(page, 400);
      await expect(shell.locator("li.mej-cc-index-row")).toHaveCount(2);
      await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}NotFiled` })).toHaveCount(0);

      await shell.locator("button.mej-cc-file-all").click();
      const bulkDialog = page.locator("dialog.application").last();
      await expect(bulkDialog).toBeVisible();
      await bulkDialog.locator('select[name="campaign"]').selectOption({ label: `${TT_PREFIX}FileTarget` });
      await bulkDialog.locator('button[data-action="ok"]').click();
      await settle(page, 400);

      await expect(shell.locator("li.mej-cc-index-row", { hasText: `${TT_PREFIX}FileBulk` })).toHaveCount(0);

      const membership = await page.evaluate(({ singleId, bulkAId, bulkBId, otherId, targetId }) => ({
        single: game.journal.get(singleId)?.folder?.id ?? null,
        bulkA: game.journal.get(bulkAId)?.folder?.id ?? null,
        bulkB: game.journal.get(bulkBId)?.folder?.id ?? null,
        other: game.journal.get(otherId)?.folder?.id ?? null
      }), { singleId: seeded.singleId, bulkAId: seeded.bulkAId, bulkBId: seeded.bulkBId, otherId: seeded.otherId, targetId });

      expect(membership.single).toBe(targetId);
      expect(membership.bulkA).toBe(targetId);
      expect(membership.bulkB).toBe(targetId);
      // NotFiled was excluded by the name filter at fileAllShown-click time - stays unfiled.
      expect(membership.other).toBeNull();

      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async ({ targetId, seededIds, captureCampaignBefore }) => {
        if (targetId) {
          const folder = game.folders.get(targetId);
          if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
        }
        const remaining = seededIds.filter((id) => game.journal.get(id));
        if (remaining.length) await JournalEntry.implementation.deleteDocuments(remaining);
        await game.settings.set("mej-campaign-companion", "autoCaptureCampaign", captureCampaignBefore ?? "");
      }, { targetId, seededIds, captureCampaignBefore });
    }
  });

  test("10. header bar: controls above the tabs, Tools menu, picker New Campaign with cancel-revert", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const shell = await openHub(page); // this spec's own hub-open helper

    // Header renders above the tab nav with the relocated controls.
    const header = shell.locator(".mej-cc-hub-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator('select[name="campaign-scope"]')).toHaveCount(1);
    await expect(header.locator(".mej-cc-new-session")).toHaveCount(1);
    // The Index toolbar no longer carries the moved controls.
    await expect(shell.locator(".mej-cc-index-controls .mej-cc-new-campaign")).toHaveCount(0);
    await expect(shell.locator(".mej-cc-index-controls .mej-cc-import-open")).toHaveCount(0);

    // Tools menu opens with the four GM items and closes.
    await header.locator(".mej-cc-tools-summary").click();
    const menu = header.locator(".mej-cc-tools-menu");
    await expect(menu.locator('button[data-action="openImportWizard"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="openExportDialog"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="setCaptureCampaign"]')).toHaveCount(1);
    await expect(menu.locator('button[data-action="openHelp"]')).toHaveCount(1);
    await header.locator(".mej-cc-tools-summary").click();
    await expect(header.locator(".mej-cc-tools-menu")).toHaveCount(0);

    // Picker "New Campaign…": cancel reverts the visible selection. DialogV2
    // .prompt() (CampaignHubPage.mjs#onNewCampaign) only ever adds an "Ok"
    // button - the only way to cancel is the window header's own close (x)
    // control, `button[data-action="close"]` (confirmed against Foundry's
    // ApplicationV2 header markup, client/applications/api/application.mjs).
    const before = await header.locator('select[name="campaign-scope"]').inputValue();
    await header.locator('select[name="campaign-scope"]').selectOption("__new");
    await settle(page, 400);
    const dialog = page.locator("dialog.application").last();
    await dialog.locator('button[data-action="cancel"], button[data-action="close"]').first().click().catch(() => dialog.evaluate((d) => d.close()));
    await settle(page, 400);
    expect(await header.locator('select[name="campaign-scope"]').inputValue()).toBe(before);
    assertNoConsoleErrors(errors);
  });

  test("11. player seat: Tools menu offers only the User Guide; no GM chrome", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "User 1");
    const shell = await openHub(page); // same helper scenario 8 uses

    const header = shell.locator(".mej-cc-hub-header");
    await expect(header).toHaveCount(1);
    await expect(header.locator(".mej-cc-new-session")).toHaveCount(0);
    await expect(header.locator(".mej-cc-edit-campaign")).toHaveCount(0);
    // Picker exists but offers players no "__new" creation option.
    await expect(header.locator('select[name="campaign-scope"] option[value="__new"]')).toHaveCount(0);

    await header.locator(".mej-cc-tools-summary").click();
    const menu = header.locator(".mej-cc-tools-menu");
    await expect(menu.locator("button")).toHaveCount(1);
    await expect(menu.locator('button[data-action="openHelp"]')).toHaveCount(1);
    await context.close();
  });

  // C1 regression. onFileAllShown is documented Unfiled-scope-only but used
  // to guard on isGM alone. In All scope #scopedEntries() returns EVERY
  // campaign's members plus unfiled entries, and the handler bulk-writes
  // `folder` across all of them - so a stray invocation outside Unfiled would
  // silently collapse every campaign in the world into one, with no
  // confirmation step and nothing but hand-refiling to undo it.
  //
  // Invoked programmatically ON PURPOSE. The button is not rendered outside
  // Unfiled scope, so a UI click cannot reach it - and that was precisely the
  // problem: the markup was the only thing standing in the way, while Foundry
  // wires data-action handlers regardless of what rendered. A test that only
  // clicked the button could never have failed on this bug. Without the guard
  // the call below opens promptCampaignChoice's dialog and then moves
  // documents; with it, it returns before either.
  test("12. fileAllShown refuses to act outside Unfiled scope (never bulk-refolders the world)", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");

    let campaignId = null;
    let looseId = null;
    try {
      const seeded = await page.evaluate(async (prefix) => {
        const { createCampaign } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
        const campaign = await createCampaign(`${prefix}GuardHome`, { ownershipDefault: "observer" });
        // A member of that campaign plus a loose entry outside it: if the
        // guard fails, All scope sweeps up both.
        const member = await JournalEntry.create({
          name: `${prefix}GuardMember`, folder: campaign.id,
          pages: [{ name: `${prefix}GuardMember`, text: { content: "member" } }]
        });
        const loose = await JournalEntry.create({
          name: `${prefix}GuardLoose`, pages: [{ name: `${prefix}GuardLoose`, text: { content: "loose" } }]
        });
        return { campaignId: campaign.id, memberId: member.id, looseId: loose.id };
      }, TT_PREFIX);
      campaignId = seeded.campaignId;
      looseId = seeded.looseId;

      const shell = await openHub(page);
      await scopeHub(shell, page, "");           // All scope - deliberately not Unfiled
      // Precondition: the control genuinely isn't offered here, so the only
      // way in is the programmatic one below.
      await expect(shell.locator("button.mej-cc-file-all")).toHaveCount(0);

      await page.evaluate(async () => {
        const { CampaignHubPage } = await import("/modules/mej-campaign-companion/scripts/apps/CampaignHubPage.mjs");
        await CampaignHubPage.onFileAllShown.call(game.MonksEnhancedJournal.journal.subsheet);
      });
      await settle(page, 500);

      // The guard returns before promptCampaignChoice, so no picker opens.
      await expect(page.locator("dialog.application select[name='campaign']")).toHaveCount(0);

      // And nothing moved: the member stays in its campaign, the loose entry
      // stays loose.
      const after = await page.evaluate(({ memberId, looseId }) => ({
        member: game.journal.get(memberId)?.folder?.id ?? null,
        loose: game.journal.get(looseId)?.folder?.id ?? null
      }), { memberId: seeded.memberId, looseId: seeded.looseId });
      expect(after.member).toBe(campaignId);
      expect(after.loose).toBeNull();

      assertNoConsoleErrors(errors);
    } finally {
      await page.evaluate(async ({ campaignId, looseId }) => {
        if (campaignId) {
          const folder = game.folders.get(campaignId);
          if (folder) await folder.delete({ deleteSubfolders: true, deleteContents: true });
        }
        if (looseId && game.journal.get(looseId)) {
          await JournalEntry.implementation.deleteDocuments([looseId]);
        }
      }, { campaignId, looseId });
    }
  });
});
