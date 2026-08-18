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
 * the shell's own default position/size overlaps it), and collapse MEJ's
 * OWN embedded "quick browse" directory pane.
 *
 * Live investigation (review finding: 7 of 18 full-shell shots showed ~30%
 * of the frame filled with a native-looking journal-entries list) found the
 * sidebar-overlap theory in the original comment here was WRONG: after
 * setPosition() below, getBoundingClientRect() confirms the shell's right
 * edge (1070) and Foundry's real #sidebar's left edge (1092) never actually
 * overlap. The list bleeding into every shot is a *different*, always-
 * present element: apps/enhanced-journal.js's own `.journal-directory` pane
 * (a docked "quick browse" journal list MEJ embeds inside its own shell,
 * toggled by the `.sidebar-toggle` arrow button, confirmed live via
 * elementFromPoint() on the exact pixels the debris list appeared at — its
 * ancestor chain roots at `#MonksEnhancedJournal form`, not `#sidebar`).
 * It defaults to expanded and eats ~300px of the shell's own content width.
 * `collapseSidebar()` is a real MEJ API method (same one `.sidebar-toggle`'s
 * click handler calls) — idempotent to call every time (checked via
 * `_collapsed` first to avoid a redundant `game.settings.set` on MEJ's own
 * "start-collapsed" world setting, snapshotted/restored in before/afterAll
 * below since this is the one call in this file that mutates
 * monks-enhanced-journal's own settings, not this module's). */
async function positionShell(page) {
  await page.evaluate(() => {
    const app = game.MonksEnhancedJournal.journal;
    app?.setPosition({ left: 60, top: 40, width: 1010, height: 820 });
    if (app && !app._collapsed) app.collapseSidebar();
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

/** Scroll the Hub index list just enough to bring the row named `name`
 * fully into view — no further, so as many other rows as possible (e.g. the
 * demo entries above it) stay in frame too. The index list's fixed content
 * height (~822px, clamped by MEJ's own CSS regardless of the shell window's
 * requested height — confirmed live: setPosition({height: 900}) still only
 * ever produces an ~822px-tall form) means a long alphabetical list with
 * this world's other test-spec debris interleaved can push a demo entry's
 * mention badge below the visible fold even at the shell's max height. */
async function scrollIndexRowIntoFrame(page, name) {
  await page.evaluate((rowName) => {
    const list = document.querySelector(".mej-cc-index-list");
    if (!list) return;
    const listBottom = list.getBoundingClientRect().bottom;
    const row = [...list.querySelectorAll(".mej-cc-index-row")].find((r) => r.textContent.includes(rowName));
    if (!row) return;
    const overflow = row.getBoundingClientRect().bottom - listBottom;
    if (overflow > 0) list.scrollTop += overflow + 4;
  }, name);
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

/** Stronger-than-toBeVisible() check for a relationship-graph node: a d3
 * -force node <g> can carry a real, non-empty bounding box (satisfying
 * toBeVisible()) while its actual position sits outside the SVG's own
 * clipped viewBox — never painted, but not "hidden" by any check
 * toBeVisible() runs — confirmed live as the root cause behind an earlier
 * graph-gm.png shipping an almost-empty canvas despite passing exactly that
 * assertion. Checks the node's geometry is fully within the graph app's own
 * frame and that it's drawn at non-zero opacity. */
async function assertNodeOnscreen(graphApp, nodeLocator) {
  await expect(nodeLocator).toBeVisible();
  const appBox = await graphApp.boundingBox();
  const nodeBox = await nodeLocator.boundingBox();
  expect(appBox, "graph app has no bounding box").toBeTruthy();
  expect(nodeBox, "node has no bounding box").toBeTruthy();
  const within =
    nodeBox.x >= appBox.x &&
    nodeBox.y >= appBox.y &&
    nodeBox.x + nodeBox.width <= appBox.x + appBox.width &&
    nodeBox.y + nodeBox.height <= appBox.y + appBox.height;
  expect(within, `node outside graph frame: node=${JSON.stringify(nodeBox)} app=${JSON.stringify(appBox)}`).toBe(true);
  const opacity = await nodeLocator.locator("circle").evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(opacity, "node circle has zero opacity").toBeGreaterThan(0);
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
// Cross-module world state, snapshotted/restored alongside settingsSnapshot
// but NOT part of SETTINGS_TO_RESTORE (that loop only reads/writes this
// module's own settings namespace):
//   - "monks-enhanced-journal" "start-collapsed" — positionShell()'s
//     collapseSidebar() call (a real GM-only side effect of that MEJ API
//     method) flips this MEJ-owned world setting.
//   - game.paused — plain broadcast session state, not a game.settings key
//     at all, but still world state this run changes (unpaused below) and
//     must leave as it found it.
let mejStartCollapsedSnapshot = false;
let pausedSnapshot = false;

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

    // Snapshot MEJ's own "start-collapsed" world setting (positionShell()'s
    // collapseSidebar() call below flips it) and the current pause state,
    // then unpause — a leftover `game.paused === true` from some other
    // manual/test session bled Foundry's "GAME PAUSED" overlay into
    // prep-board.png (clearly) and settings.png (faintly, through that
    // window's own translucent background) in a prior run. Unpausing here,
    // at the very start of the seed+capture flow, keeps every shot this
    // file takes clean of it.
    mejStartCollapsedSnapshot = await page.evaluate(() =>
      game.settings.get("monks-enhanced-journal", "start-collapsed")
    );
    pausedSnapshot = await page.evaluate(() => game.paused === true);
    // `broadcast: true` is load-bearing, not decoration: togglePause()'s
    // default (`broadcast: false`) only patches the CALLING client's own
    // in-memory game.data.paused - confirmed live, the exact bug behind
    // this fix's first attempt still shipping the overlay: a *fresh*
    // client connecting seconds later (this file's every subsequent test
    // logs in fresh) still read paused:true, because the unpause was never
    // actually sent to the server for it to hand to new connections.
    if (pausedSnapshot) await page.evaluate(() => game.togglePause(false, { broadcast: true }));
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
    await page.evaluate(
      async ({ collapsed, paused }) => {
        await game.settings.set("monks-enhanced-journal", "start-collapsed", collapsed);
        if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
      },
      { collapsed: mejStartCollapsedSnapshot, paused: pausedSnapshot }
    );
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
    // Bring the mention-count badge on the LATER-sorted of the two badge-
    // bearing demo entries ("The Missing Caravan" sorts after "The Gilded
    // Flagon") into frame — this world's other test-spec debris (T-prefixed
    // fixtures) interleave alphabetically above both, pushing them near the
    // bottom of the index list's fixed-height, scrollable content area.
    await scrollIndexRowIntoFrame(page, "The Missing Caravan");
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

    // Ego/Focus mode centered on Aldric, opened the same way MEJ's own
    // "open graph" header button does (openGraph({centerUuid}), imported
    // directly — that real header button is absent from the DOM on v14 for
    // an unrelated, already-documented MEJ-side bug; see the prep-board
    // shot below), rather than the Hub's plain "Whole campaign" button.
    //
    // Review finding: a whole-campaign-mode shot's toBeVisible() checks on
    // the two named nodes passed, yet the committed PNG showed an
    // almost-empty canvas — toBeVisible() only checks a non-empty bounding
    // box + non-hidden computed style, not whether the node's <g> actually
    // landed inside the SVG's own clipped viewBox. With this world's full
    // node cluster (every visible entry, not just this run's demo cast),
    // d3-force's forceCenter() can drift a node's *geometry* outside the
    // viewBox while its DOM element still reports a "visible" bounding box.
    // Ego mode structurally avoids this: buildGraph() filters to just the
    // center node + its direct neighbors (graph-data.mjs's `mode === "ego"`
    // branch) — Aldric's only relationship is to the Caravan, so this is a
    // 2-node, 1-edge graph that settles near forceCenter()'s target
    // regardless of how large the rest of the world's fixture set grows.
    const aldricUuid = await uuidOf(page, demo.aldricId);
    await page.evaluate(async (centerUuid) => {
      const { openGraph } = await import("/modules/mej-campaign-companion/scripts/apps/graph-app.mjs");
      openGraph({ centerUuid });
    }, aldricUuid);
    const graphApp = page.locator(".mej-cc-graph-app");
    await expect(graphApp).toHaveCount(1);
    await expect.poll(() => graphApp.locator(".mej-cc-graph-node").count()).toBeGreaterThanOrEqual(2);
    await settle(page, 2500); // let the (now tiny) simulation's alpha decay toward rest
    // Belt-and-suspenders on top of the ego-mode structural fix: assert
    // each named node's actual painted geometry sits inside the graph app's
    // own frame (not just "has a bounding box" per toBeVisible()) and is
    // drawn at non-zero opacity, exactly the two properties the flaky
    // whole-campaign shot's toBeVisible()-only check missed.
    await assertNodeOnscreen(graphApp, graphApp.locator(".mej-cc-graph-node", { hasText: "Captain Aldric Vane" }));
    await assertNodeOnscreen(graphApp, graphApp.locator(".mej-cc-graph-node", { hasText: "The Missing Caravan" }));
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
