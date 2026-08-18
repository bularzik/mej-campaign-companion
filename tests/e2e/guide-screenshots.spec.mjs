// Guide screenshot capture — regenerates every image in docs/images/ used by
// docs/gm-guide.md and docs/player-guide.md. NOT a test of behavior; a
// deliberately-gated documentation tool, following 13-stock-smoke's gating
// pattern. A normal suite run (GUIDE_SHOTS unset) skips this file entirely.
//
// Run:  GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs
//
// Seeded demo content uses clean fantasy names (no TT- prefix — these names
// appear in published screenshots). Cleanup is by the guideDemo flag, swept
// at start AND end so a crashed run leaves nothing and reruns are idempotent.
//
// Task 2 (this file's seeding + GM captures) builds a small demo campaign —
// three Persons, a Place, a Quest, and a Session — and takes the 18
// GM-perspective screenshots the brief calls for. State is left in place
// after this file's tests finish (cleanup happens only in afterAll): Task 3
// appends player-perspective capture tests later in this same
// guideDescribe block and depends on this seeded world state still being
// there when it runs.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { login, settle, MODULE_ID } from "./helpers/foundry.mjs";

const GATED = process.env.GUIDE_SHOTS === "1";
const guideDescribe = GATED ? test.describe : test.describe.skip;

const IMG_DIR = "docs/images";
const DOCX_PATH = "/Users/danbularzik/Claude/Projects/campaign-record/examples/Radiant Citadel.docx";
// Every seeded demo document gets this ownership so a player client (Task 3)
// can see it; ownership levels are passed as plain numbers — CONST only
// exists inside the browser context, not in Node test scope (matches
// 11-auto-link-scope.spec.mjs's own comment on this).
const OBSERVER_OWNERSHIP = { default: 2 };

/** Screenshot a Locator (preferred: the app window element) or a Page. */
async function shot(target, name) {
  await target.screenshot({ path: `${IMG_DIR}/${name}.png` });
}

/** Delete every guideDemo-flagged JournalEntry and Actor (idempotent). */
async function sweepGuideDemo(page) {
  await page.evaluate(async (id) => {
    const doomedEntries = game.journal.filter((e) => e.getFlag(id, "guideDemo"));
    for (const e of doomedEntries) await e.delete();
    // Task 2 seeds two demo Actors (Session attendees) — not JournalEntry
    // documents, so the sweep above never sees them; they need their own
    // guideDemo-flag sweep or they'd survive every cleanup pass.
    const doomedActors = game.actors.filter((a) => a.getFlag(id, "guideDemo"));
    for (const a of doomedActors) await a.delete();
  }, MODULE_ID);
}

/**
 * Create an MEJ-typed entry (person/place/quest/encounter). Pattern from
 * 07-knowledge.spec.mjs createPerson() and 01-session.spec.mjs:197.
 */
async function seedMejEntry(page, { name, mejType, text = "", flags = {}, ownership }) {
  return await page.evaluate(async ({ name, mejType, text, flags, ownership, id }) => {
    const entry = await JournalEntry.create({
      name,
      ownership: ownership ?? undefined,
      flags: { [id]: { guideDemo: true } },
      pages: [{
        name,
        type: `monks-enhanced-journal.${mejType}`,
        text: { content: text },
        flags: { "monks-enhanced-journal": { type: mejType }, [id]: flags }
      }]
    });
    return entry.id;
  }, { name, mejType, text, flags, ownership, id: MODULE_ID });
}

/** Open the journal sidebar and MEJ's "Create Entry" dialog, choose type
 * "Session", submit, and return the created entry's id once MEJ has
 * finished opening it. Copied verbatim from 01-session.spec.mjs:15 — the
 * task-2 brief calls for this exact helper, since it drives the same New
 * Entry dialog the GM guide itself tells users to use. */
async function createSessionViaDialog(page, name) {
  await page.locator('[data-tab="journal"][data-action="tab"]').click();
  await settle(page, 200);
  await page.locator("#journal [data-action=createEntry]").click();
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="name"]').fill(name);
  const typeSelect = dialog.locator('select[name="flags.monks-enhanced-journal.pagetype"]');
  await expect(typeSelect.locator('option[value="session"]')).toHaveText("Session");
  await typeSelect.selectOption("session");
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 800);
  return page.evaluate((n) => game.journal.find((j) => j.name === n)?.id, name);
}

async function uuidOf(page, entryId) {
  return page.evaluate((id) => game.journal.get(id).uuid, entryId);
}

/** Append raw HTML to an existing page's text.content (e.g. an enricher tag
 * or a plain-text name mention). */
async function appendPageContent(page, entryId, html) {
  await page.evaluate(async ({ id, html }) => {
    const p = game.journal.get(id).pages.contents[0];
    await p.update({ "text.content": (p.text.content ?? "") + html });
  }, { id: entryId, html });
}

/** Move/resize the MEJ shell window clear of Foundry's own right-hand
 * sidebar (which defaults to opening at x=1092 in this 1440-wide viewport —
 * the shell's own default position/size overlaps it, and the sidebar's
 * higher stacking order then bleeds its own journal list into that
 * overlapping region of any element.screenshot() taken of the shell). */
async function positionShell(page) {
  await page.evaluate(() => {
    game.MonksEnhancedJournal.journal?.setPosition({ left: 60, top: 40, width: 1010, height: 820 });
  });
  // A lingering hover tooltip (e.g. "Campaign Hub" over the nav icon,
  // triggered by Playwright's own click() synthetically moving the pointer
  // there first) can otherwise survive into the next screenshot — the
  // window resize above shifts the button out from under the real pointer
  // without firing a new pointerleave, so a synthetic mouse.move() alone
  // doesn't reliably clear it. Foundry's own TooltipManager does.
  await page.evaluate(() => game.tooltip?.deactivate());
  await page.mouse.move(400, 885);
}

/** Open a specific entry (not the Hub) in the MEJ shell. */
async function openEntry(page, entryId) {
  await page.evaluate(async (id) => {
    await game.MonksEnhancedJournal.openJournalEntry(game.journal.get(id));
  }, entryId);
  await settle(page, 400);
  await positionShell(page);
  return page.locator("#MonksEnhancedJournal");
}

/** Open any entry (so the MEJ shell exists) then click the Campaign Hub
 * toolbar button. Idempotent — 08-query-graph.spec.mjs's openHub() pattern:
 * re-clicking the sidebar journal tab while the shell is already open can
 * hang (it covers the sidebar button). */
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
  await positionShell(page);
  return shell;
}

async function openHubTab(page, tab) {
  const shell = await openHub(page);
  await shell.locator(`nav.sheet-tabs a[data-tab="${tab}"]`).click();
  await settle(page, 300);
  return shell;
}

/** Dispatch a synthetic native drop of a document onto `selector`, matching
 * Foundry's own DragDrop data format ({type, uuid} as text/plain JSON) —
 * exercises the real drop handler without needing OS-level pointer drag.
 * Copied from 01-session.spec.mjs's dropDocumentOnto(). */
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

/** The attributes <details> renders collapsed by default (07-knowledge.spec.mjs). */
async function ensureAttrsExpanded(panel) {
  const details = panel.locator(".mej-cc-knowledge-attrs");
  const isOpen = await details.evaluate((el) => el.open);
  if (!isOpen) await details.locator("summary").click();
}

/** Fill (or blank) the add/rename-timepoint dialog and return its locator.
 * `date`, when given, is {year, month, day, time} — mirrors
 * CampaignHubPage#promptTimepoint's own fields (02-hub-timeline.spec.mjs:92-112
 * pattern). When omitted, every date field is explicitly cleared: the dialog
 * pre-fills them from the current world time whenever a calendar is active,
 * so leaving them untouched would silently date every "manual" timepoint. */
async function fillTimepointDialog(page, { label, date }) {
  const dialog = page.locator("dialog.application").last();
  await dialog.locator('input[name="label"]').fill(label);
  const yearInput = dialog.locator('input[name="year"]');
  if (await yearInput.count()) {
    if (date) {
      await yearInput.fill(String(date.year));
      await dialog.locator('select[name="month"]').selectOption(String(date.month));
      await dialog.locator('input[name="day"]').fill(String(date.day));
      await dialog.locator('input[name="time"]').fill(date.time);
    } else {
      await yearInput.fill("");
      await dialog.locator('select[name="month"]').selectOption("");
      await dialog.locator('input[name="day"]').fill("");
      await dialog.locator('input[name="time"]').fill("");
    }
  }
  return dialog;
}

/** Create one timepoint on the Hub's Timeline tab. When `date` is given, the
 * dialog itself — with the campaign-date fields visible — is the
 * campaign-date-picker.png shot (only available transiently, while it's open). */
async function addTimepoint(shell, page, label, date) {
  await shell.locator("button.mej-cc-add-timepoint").click();
  const dialog = await fillTimepointDialog(page, { label, date });
  if (date) await shot(dialog, "campaign-date-picker");
  await dialog.locator('button[data-action="ok"]').click();
  await settle(page, 500);
}

// World settings the demo run mutates; snapshotted in beforeAll, restored in
// afterAll. timelineJournalId is reset to "" at start (02-hub-timeline's
// pattern, see its file-header comment) so the Hub creates a FRESH timeline
// journal for the shots; that fresh journal is deleted before restore.
const SETTINGS_TO_RESTORE = [
  "timelineJournalId",
  "savedQueries",
  "playerGroups",
  "retroLinkMode",
  "autoLink"
];
let settingsSnapshot = {};

// Ids of the seeded demo documents, populated by the seed test and read by
// the capture tests that follow it (plain Node-side values — these persist
// across tests in this file regardless of each test's own fresh
// page/context, since only browser-side state resets between tests).
const demo = {};

guideDescribe("guide screenshots", () => {
  test.beforeAll(async ({ browser }) => {
    mkdirSync(IMG_DIR, { recursive: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    settingsSnapshot = await page.evaluate((keys) => {
      const out = {};
      for (const k of keys) out[k] = game.settings.get("mej-campaign-companion", k);
      return out;
    }, SETTINGS_TO_RESTORE);
    await sweepGuideDemo(page);
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
    });
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await sweepGuideDemo(page);
    // Delete the fresh timeline journal this run created, then restore.
    await page.evaluate(async (snapshot) => {
      const id = game.settings.get("mej-campaign-companion", "timelineJournalId");
      if (id && id !== snapshot.timelineJournalId) await game.journal.get(id)?.delete();
      for (const [k, v] of Object.entries(snapshot))
        await game.settings.set("mej-campaign-companion", k, v);
    }, settingsSnapshot);
    await context.close();
  });

  test("seed the demo campaign", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "Gamemaster");
    // The headless viewport's permanent "no hardware acceleration" warning
    // (KNOWN_LOW_RESOLUTION_WARNING) is a real, visible notification banner,
    // not just a console message — clear it so it doesn't sit across the
    // top of every screenshot this test takes.
    await page.evaluate(() => ui.notifications.clear());

    // Defensive baseline regardless of whatever a prior spec run left behind
    // (11-auto-link-scope.spec.mjs's own afterEach, for one, restores
    // retroLinkMode to "confirm", not "off") — every entry this test creates
    // is either brand-new-named or already @UUID-linked at creation time, so
    // this is just hygiene, not load-bearing for the seeding below.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", false);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "off");
    });

    // --- Place, Quest, Persons -------------------------------------------
    const flagonId = await seedMejEntry(page, {
      name: "The Gilded Flagon",
      mejType: "place",
      text: "<p>The Gilded Flagon is the busiest tavern on the harborfront, its taproom thick with pipe smoke and the low murmur of merchants trading rumors over dice. The innkeeper waters down the ale just enough that nobody complains twice.</p>",
      ownership: OBSERVER_OWNERSHIP
    });
    const flagonUuid = await uuidOf(page, flagonId);

    // The block secret (09-secrets.spec.mjs:18's HTML shape) lives here, not
    // on the Session page: the Session sheet never renders a
    // `.editor-display[data-key="text.content"]` region at all (its own
    // template only ever keys system.recap/system.gmNotes/playerRecaps), so
    // a block secret placed in a Session page's text.content would be inert
    // — the secrets-ui.mjs GM overlay hook that adds `.mej-cc-secret-audience`
    // only scans that exact data-key. Quest/Place/Person pages all render it
    // (MEJ's shared sheet-textentry.hbs partial), so the block secret is
    // seeded on the Quest entry instead — narratively apt, since the secret
    // is about the caravan incident itself.
    const caravanId = await seedMejEntry(page, {
      name: "The Missing Caravan",
      mejType: "quest",
      text: '<p>A merchant caravan bound for the eastern hills never reached its destination. The party has been hired to find out what happened to it — and to recover whatever cargo can still be saved.</p><section class="secret" id="guide-secret-1"><p>The caravan was never attacked — Aldric staged it.</p></section>',
      ownership: OBSERVER_OWNERSHIP
    });
    const caravanUuid = await uuidOf(page, caravanId);

    const miraId = await seedMejEntry(page, {
      name: "Mira Thornwood",
      mejType: "person",
      text: `<p>Mira Thornwood keeps a dye-and-cloth stall near the docks, trading in colors most weavers in town have never seen. She's quick with a smile and quicker to notice who's watching her — and she can usually be found at @UUID[JournalEntry.${flagonId}]{The Gilded Flagon} once the sun goes down.</p>`,
      flags: {
        tags: ["ally", "merchant"],
        attributes: [
          { id: "mira-attr-trust", key: "trustworthiness", value: "high", playerHidden: false },
          { id: "mira-attr-loyalty", key: "secret loyalty", value: "The Gilded Hand", playerHidden: true }
        ]
      },
      ownership: OBSERVER_OWNERSHIP
    });
    const aldricId = await seedMejEntry(page, {
      name: "Captain Aldric Vane",
      mejType: "person",
      text: `<p>Captain Aldric Vane commands the town watch's small garrison. Publicly, he's leading the search into @UUID[JournalEntry.${caravanId}]{The Missing Caravan} — though more than one guard has noticed his account of that night doesn't quite line up.</p>`,
      ownership: OBSERVER_OWNERSHIP
    });
    const serenaId = await seedMejEntry(page, {
      name: "Serena of the Vale",
      mejType: "person",
      text: "<p>Serena of the Vale is a traveling scholar cataloguing the old trade roads through the region. She arrived in town only days before the caravan vanished, and she's been asking a lot of very specific questions ever since.</p>",
      ownership: OBSERVER_OWNERSHIP
    });

    // Relationship edges for the graph (flag shape from 08-query-graph.spec.mjs:200-205,
    // set on the PAGE, MEJ's own "relationships" flag namespace).
    await page.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: false }
      });
    }, { pid: miraId, relId: "guide-rel-mira-flagon", targetUuid: flagonUuid });
    await page.evaluate(async ({ pid, relId, targetUuid }) => {
      const p = game.journal.get(pid).pages.contents[0];
      await p.setFlag("monks-enhanced-journal", "relationships", {
        [relId]: { id: relId, uuid: targetUuid, hidden: false }
      });
    }, { pid: aldricId, relId: "guide-rel-aldric-caravan", targetUuid: caravanUuid });

    // The rendered @CampaignQuery enricher shot (campaign-query-inline.png).
    await appendPageContent(page, flagonId, "<p>@CampaignQuery[type:person tag:ally]</p>");

    // --- Session -----------------------------------------------------------
    const sessionId = await createSessionViaDialog(page, "Session 12 — Shadows over Daggerford");
    await page.evaluate(async ({ sessionId, id }) => {
      await game.journal.get(sessionId).setFlag(id, "guideDemo", true);
    }, { sessionId, id: MODULE_ID });
    await page.evaluate(async (id) => {
      await game.journal.get(id).update({ ownership: { default: 2 } });
    }, sessionId);

    const user1Id = await page.evaluate(() => game.users.getName("User 1").id);

    // Session-tab fields, driven through the real UI (01-session.spec.mjs's
    // proven field selectors) — plain inputs/selects, low-risk to automate.
    const shell = page.locator("#MonksEnhancedJournal");
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 200);

    const numberInput = shell.locator('input[name="flags.mej-campaign-companion.session.sessionNumber"]');
    await numberInput.fill("12");
    await numberInput.blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.sessionNumber === 12,
      sessionId
    );

    const dateFields = { year: "1497", day: "14", hour: "19", minute: "0" };
    for (const [field, value] of Object.entries(dateFields)) {
      const input = shell.locator(`input[name="flags.mej-campaign-companion.session.campaignDate.${field}"]`);
      await input.fill(value);
    }
    await shell.locator('select[name="flags.mej-campaign-companion.session.campaignDate.month"]').selectOption("5");
    await shell.locator('input[name="flags.mej-campaign-companion.session.campaignDate.minute"]').blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.campaignDate?.year === 1497,
      sessionId
    );

    // Attendees, via the real attendees-list drop target (SessionSheet.mjs's
    // dropSelector) — two small demo Actors, guideDemo-flagged so the sweep
    // in sweepGuideDemo() (extended above) cleans them up too.
    const actorIds = await page.evaluate(async ({ id, names }) => {
      const ids = [];
      for (const name of names) {
        const actor = await Actor.create({ name, type: "npc", flags: { [id]: { guideDemo: true } } });
        ids.push(actor.id);
      }
      return ids;
    }, { id: MODULE_ID, names: ["Kestrel Ashgrove", "Doran Emberhollow"] });
    const actorUuids = await page.evaluate((ids) => ids.map((id) => game.actors.get(id).uuid), actorIds);
    for (const uuid of actorUuids) {
      await dropDocumentOnto(page, ".attendees-list", { type: "Actor", uuid });
      await settle(page, 400);
    }

    // Secret checklist (session.secrets — a separate mechanism from the
    // block secret above, SessionSheet.mjs's own addSecret/secret-text UI).
    for (const text of ["Where did the caravan really go?", "Who paid off the guards?"]) {
      const before = await page.evaluate(
        (id) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length,
        sessionId
      );
      await shell.locator('button[data-action="addSecret"]').click();
      await page.waitForFunction(
        ({ id, before }) => (game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.secrets ?? []).length === before + 1,
        { id: sessionId, before }
      );
      await settle(page, 200);
      const input = shell.locator("li.item input.secret-text").last();
      await input.fill(text);
      await input.blur();
      await settle(page, 400);
    }

    // GM recap + one player recap: set directly (system.recap / playerRecaps
    // are plain page flags/fields — logic/player-recap.mjs's reserved
    // shape), rather than driving the real ProseMirror editor via UI. A real
    // contenteditable ProseMirror element is significantly more fragile to
    // automate reliably (focus/selection state, custom-element internals)
    // than the plain <input>/<select> fields above, and recap content isn't
    // one of the brief's listed UI-is-the-subject exceptions (timepoints,
    // saved query, player group, audience dialog) — a deliberate deviation
    // from the brief's literal "through the sheet UI" wording for this one
    // field, noted in the task report. Done LAST, after every session-tab
    // field above: confirmed live that MEJ's shared <form> submits its
    // FULL current field set (every tab's fields, not just the one just
    // blurred) on each of those submits — setting recap/playerRecaps any
    // earlier got silently stomped back to empty by the next blur's
    // whole-form resubmit carrying the stale (pre-update) recap value still
    // sitting in the still-mounted, not-currently-active recap tab's DOM.
    await page.evaluate(async ({ sessionId, recap, user1Id, playerRecap }) => {
      const p = game.journal.get(sessionId).pages.contents[0];
      await p.update({ system: { recap } });
      await p.setFlag("mej-campaign-companion", "playerRecaps", { [user1Id]: playerRecap });
    }, {
      sessionId,
      // Kept short deliberately: the Session sheet's shared MEJ header
      // partial (sheet-detailed-header.hbs, via a generic Page Name/Type/
      // File Path/Page Category/Sort Order fields fallback the companion's
      // SessionSheet never overrides with session-specific fields) eats
      // most of the vertical space available at this window size, leaving
      // only ~180px for the whole description tab body — confirmed live,
      // reported as a concern rather than fixed here (a SessionSheet/MEJ
      // integration gap, out of this task's scope). Short text is the
      // practical way to keep both recaps actually visible in the shot.
      recap: "<p>The party found the caravan's last stop — a burned-out waystation. Vane's story about bandits doesn't add up.</p>",
      user1Id,
      playerRecap: "<p>Boot prints led away from where the \"bandits\" supposedly came from.</p>"
    });
    await settle(page, 300);

    // --- Hub: timeline, dashboards (saved query), secrets (player group) --
    const timelineShell = await openHubTab(page, "timeline");
    await addTimepoint(timelineShell, page, "The Caravan Departs");
    await addTimepoint(timelineShell, page, "Mira's Warning");
    await addTimepoint(timelineShell, page, "The Ambush (staged)");
    await addTimepoint(timelineShell, page, "Session 12 Convenes", { year: "1497", month: "5", day: "14", time: "19:00" });

    // Attach the Quest entry to the first timepoint (same synthetic-drop
    // technique as 02-hub-timeline.spec.mjs).
    // Look the timeline journal up by the world SETTING's current id, not by
    // name: beforeAll only resets the *setting* to "" (so the Hub files a
    // fresh timeline journal for this run) — it doesn't touch whatever
    // pre-existing journal is already named "Campaign Timeline" in this
    // world. Two documents can carry that exact name at once, and
    // `game.journal.find(name === ...)` picks whichever the collection
    // happens to order first — not necessarily the one this run's
    // timelineJournalId setting (and thus the Hub UI itself) is using.
    const firstTimepointId = await page.evaluate(() => {
      const id = game.settings.get("mej-campaign-companion", "timelineJournalId");
      const j = game.journal.get(id);
      const tp = j?.getFlag("mej-campaign-companion", "timeline")?.timepoints
        ?.find((t) => t.label === "The Caravan Departs");
      return tp?.id;
    });
    await dropDocumentOnto(page, `li.mej-cc-timepoint[data-timepoint-id="${firstTimepointId}"]`, { type: "JournalEntry", uuid: caravanUuid });
    await settle(page, 500);

    const dashboardsShell = await openHubTab(page, "dashboards");
    await dashboardsShell.locator('button[data-action="addDashboard"]').click();
    const dashboardDialog = page.locator("dialog.application").last();
    await dashboardDialog.locator('input[name="name"]').fill("Allies");
    await dashboardDialog.locator('input[name="query"]').fill("type:person tag:ally");
    await dashboardDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    const secretsShell = await openHubTab(page, "secrets");
    await secretsShell.locator('button[data-action="addGroup"]').click();
    const groupDialog = page.locator("dialog.application").last();
    await groupDialog.locator('input[name="name"]').fill("Inner Circle");
    await groupDialog.locator(`input[name="member-${user1Id}"]`).check();
    await groupDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    Object.assign(demo, {
      flagonId, caravanId, miraId, aldricId, serenaId, sessionId
    });
  });

  test("capture Hub, entry-sheet, and graph screenshots", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.notifications.clear());

    const indexShell = await openHub(page);
    await settle(page, 300);
    await shot(indexShell, "hub-index");

    const timelineShell = await openHubTab(page, "timeline");
    await shot(timelineShell, "hub-timeline");

    const searchShell = await openHubTab(page, "search");
    await searchShell.locator(".mej-cc-search-input").fill("caravan");
    await settle(page, 400);
    await shot(searchShell, "hub-search");

    const dashboardsShell = await openHubTab(page, "dashboards");
    await settle(page, 300);
    await shot(dashboardsShell, "hub-dashboards");

    const secretsShell = await openHubTab(page, "secrets");
    await settle(page, 300);
    await shot(secretsShell, "hub-secrets-tab");

    // .mej-cc-graph-open lives in the "index" tab's controls — openHub()
    // alone just switches back to the Hub subsheet without necessarily
    // reselecting that tab (the last-active tab, "secrets" above, sticks),
    // and the button is present-but-hidden (CSS-inactive tab) rather than
    // absent, which is why a plain click() here hangs on "not visible"
    // instead of failing fast with a locator-not-found.
    const graphShell = await openHubTab(page, "index");
    await graphShell.locator("button.mej-cc-graph-open").click();
    const graphApp = page.locator(".mej-cc-graph-app");
    await expect(graphApp).toHaveCount(1);
    // Node/edge count first (08-query-graph.spec.mjs's pattern): the
    // d3-force simulation can leave nodes off-screen or mid-flight for a
    // beat after the app itself mounts, so waiting on the app element alone
    // — as an earlier version of this shot did — occasionally captured an
    // empty canvas. Then a flat settle to let alpha decay toward rest so
    // the two named nodes aren't caught mid-drift.
    await expect.poll(() => graphApp.locator(".mej-cc-graph-node").count()).toBeGreaterThanOrEqual(2);
    await settle(page, 2500);
    // The forceCenter() layout pulls the whole node cluster toward the
    // app's own center, but with enough background nodes (this world
    // carries plenty of pre-existing fixtures beyond this run's own demo
    // cast) the cluster can still be wider than the app window, drifting
    // our two named nodes outside its visible bounds on an unlucky run
    // (confirmed live: a node-count check alone isn't enough) — confirm
    // the two we actually seeded a relationship for are on-screen before
    // trusting the shot.
    await expect(graphApp.locator(".mej-cc-graph-node", { hasText: "Captain Aldric Vane" })).toBeVisible();
    await expect(graphApp.locator(".mej-cc-graph-node", { hasText: "The Missing Caravan" })).toBeVisible();
    await shot(graphApp, "graph-gm");
    await page.keyboard.press("Escape");
    await settle(page, 300);

    const sessionShell = await openEntry(page, demo.sessionId);
    await sessionShell.locator('a[data-action="tab"][data-tab="description"]').click();
    await settle(page, 300);
    await shot(sessionShell, "session-sheet-gm");
    await sessionShell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 300);
    await shot(sessionShell.locator(".secrets-section"), "session-checklist");

    const miraShell = await openEntry(page, demo.miraId);
    const miraPanel = miraShell.locator(".mej-cc-knowledge");
    await expect(miraPanel).toHaveCount(1);
    await ensureAttrsExpanded(miraPanel);
    await shot(miraPanel, "knowledge-tags-attributes");

    const flagonShell = await openEntry(page, demo.flagonId);
    const flagonPanel = flagonShell.locator(".mej-cc-knowledge");
    await expect(flagonPanel).toHaveCount(1);
    await shot(flagonPanel.locator(".mej-cc-knowledge-backlinks"), "knowledge-backlinks");
    // The @CampaignQuery enricher rendered on this same page.
    await expect(flagonShell.locator(".mej-cc-query-embed")).toHaveCount(1);
    await shot(flagonShell, "campaign-query-inline");
  });

  test("capture standalone dialogs and windows", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "Gamemaster");
    await page.evaluate(() => ui.notifications.clear());

    // Settings window's module section — captured before this test mutates
    // any settings, so it shows real, non-transient default values.
    await page.evaluate(() => game.settings.sheet.render(true));
    await settle(page, 500);
    const settingsApp = page.locator("#settings-config");
    await expect(settingsApp).toBeVisible();
    await settingsApp.locator(`button[data-action="tab"][data-tab="${MODULE_ID}"]`).click();
    await settle(page, 300);
    await shot(settingsApp, "settings");
    // ApplicationV2 windows (unlike a native <dialog>) don't reliably close
    // on Escape here — use the window's own header close control instead.
    // force: true — a permanent "hardware acceleration" notification banner
    // (this headless test environment's own known quirk, unrelated to this
    // module) sits over part of the viewport and can intercept the plain
    // pointer-actionability check on a window's header close control.
    await settingsApp.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Prep board (openPrepBoard() called directly — MEJ's own header-button
    // injection for it is broken on v14, unrelated to this module; see
    // 10-secrets-hub.spec.mjs's doc comment).
    await page.evaluate(async (sessionId) => {
      const { openPrepBoard } = await import("/modules/mej-campaign-companion/scripts/apps/prep-board-app.mjs");
      const pageDoc = game.journal.get(sessionId).pages.contents[0];
      await openPrepBoard({ pageUuid: pageDoc.uuid });
    }, demo.sessionId);
    await settle(page, 500);
    const board = page.locator(".mej-cc-prep-board");
    await expect(board).toHaveCount(1);
    await shot(board, "prep-board");
    await board.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Secret-audience dialog on the block secret (Quest entry) — reveal to
    // the Inner Circle group seeded earlier, so Task 3's player captures can
    // show it revealed.
    const caravanShell = await openEntry(page, demo.caravanId);
    const audienceBtn = caravanShell.locator(".mej-cc-secret-audience");
    await expect(audienceBtn).toHaveCount(1);
    await audienceBtn.click();
    await settle(page, 300);
    const audienceDialog = page.locator("dialog.application").last();
    await expect(audienceDialog).toBeVisible();
    await shot(audienceDialog, "secret-audience-dialog");
    const groupId = await page.evaluate(() => {
      const groups = game.settings.get("mej-campaign-companion", "playerGroups") ?? [];
      return groups.find((g) => g.name === "Inner Circle")?.id;
    });
    if (groupId) await audienceDialog.locator(`input[name="group-${groupId}"]`).check();
    await audienceDialog.locator('button[data-action="ok"]').click();
    await settle(page, 500);

    // Docx import wizard, on the fixture used by 05-docx-import.spec.mjs —
    // opened and populated, but never actually imported (Escape-closed
    // afterward) so it doesn't add extra, unmanaged demo content.
    const importShell = await openHub(page);
    await importShell.locator("button.mej-cc-import-open").click();
    await settle(page, 300);
    const wizard = page.locator(".mej-cc-import-wizard-app");
    await wizard.locator("input[type=file][name=file]").setInputFiles(DOCX_PATH);
    await wizard.locator(".mej-cc-import-review").waitFor({ timeout: 60_000 });
    await settle(page, 300);
    await shot(wizard, "docx-import-wizard");
    // Not Escape-closed: this ApplicationV2 window doesn't reliably close on
    // it (confirmed live — its subtree kept intercepting pointer events for
    // the next Hub interaction). The header close control does.
    await wizard.locator('button.header-control[data-action="close"]').click({ force: true });
    await settle(page, 300);

    // Export dialog, with "Include GM Content" visible — Escape-closed
    // rather than triggering a real download.
    const exportShell = await openHub(page);
    await exportShell.locator("button.mej-cc-export-open").click();
    const exportDialog = page.locator("dialog.application").last();
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.locator('input[name="includeGM"]')).toHaveCount(1);
    await shot(exportDialog, "docx-export-dialog");
    await page.keyboard.press("Escape");
    await settle(page, 300);

    // Retroactive auto-link confirm dialog (11-auto-link-scope.spec.mjs's
    // selectors): a plain-text mention in an existing demo page, then a
    // freshly-created entity with that exact name triggers the confirm scan.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", true);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "confirm");
    });
    await appendPageContent(page, demo.serenaId,
      "<p>Serena mentioned a fence named Old Toby Rackett who might know where stolen goods pass through town.</p>");
    await settle(page, 300);
    await seedMejEntry(page, {
      name: "Old Toby Rackett",
      mejType: "person",
      text: "<p>A quiet fence who deals in things better left unlooked-at.</p>",
      ownership: OBSERVER_OWNERSHIP
    });
    const retroDialog = page.locator(".mej-cc-retro-link-dialog");
    await expect(retroDialog).toBeVisible({ timeout: 10_000 });
    await shot(retroDialog, "autolink-confirm");
    await retroDialog.locator('button[data-action="apply"]').click();
    await settle(page, 500);

    // Return these two settings to a safe baseline before Task 3's tests
    // run — afterAll restores the ORIGINAL pre-run snapshot regardless, but
    // this avoids leaving autoLink/retroLinkMode "hot" for whatever Task 3
    // does next in this same describe block.
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "autoLink", false);
      await game.settings.set("mej-campaign-companion", "retroLinkMode", "off");
    });
  });
});
