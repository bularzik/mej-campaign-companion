import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { lockStatus, UNLOCK_HINT } from "./env-lock.mjs";

export const BASE_URL = process.env.FOUNDRY_URL ?? "http://localhost:30000";
export const TEST_WORLD = process.env.FOUNDRY_TEST_WORLD ?? "world-a";
export const MODULE_ID = "mej-campaign-companion";
export const MEJ_MODULE_ID = "monks-enhanced-journal";

// Test documents this suite creates are prefixed "TT-" (matches the MEJ
// Playwright harness convention at monks-enhanced-journal/test/) so cleanup
// stays greppable and doesn't collide with the "TT-"/"Baseline Test"/etc.
// fixtures already living in world-a from prior MEJ test rounds.
export const TT_PREFIX = "TT-";

// Phase 3 (storageState login reuse, ported from campaign-record): one saved
// session file per test-world user. The "setup" Playwright project
// (tests/e2e/auth.setup.mjs) populates these once per run; login() below
// fast-paths from them. Git-ignored (tests/e2e/.auth/) since cookies are
// host-local and short-lived.
const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".auth");
export const AUTH_STATE_FILES = {
  Gamemaster: path.join(AUTH_DIR, "gm.json"),
  "User 1": path.join(AUTH_DIR, "user1.json"),
  "User 2": path.join(AUTH_DIR, "user2.json")
};

const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? "/Users/danbularzik/FoundryVTT-14/FoundryVTT-Node-14.365";
const FOUNDRY_DATA = process.env.FOUNDRY_DATA ?? "/Users/danbularzik/FoundryVTT-14/Data";
const FOUNDRY_NODE = process.env.FOUNDRY_NODE ?? "/opt/homebrew/bin/node";
const PID_FILE = path.join(FOUNDRY_DATA, ".pid");

async function serverStatus() {
  try {
    const res = await fetch(`${BASE_URL}/api/status`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch {
    return null;
  }
}

/** Refuse server mutations while a live foreign session holds the env lock. */
function assertEnvOwned(action) {
  const { held, info, alive } = lockStatus();
  if (held && info && alive && info.pid !== process.pid) {
    throw new Error(
      `Refusing to ${action}: Foundry e2e environment is locked by pid ${info.pid} ` +
      `(worktree ${info.worktree}). ${UNLOCK_HINT}`
    );
  }
}

function stopServer() {
  assertEnvOwned("stop the Foundry server");
  try {
    const port = new URL(BASE_URL).port || "30000";
    // -sTCP:LISTEN: only the server's listening socket. A bare `-ti :port`
    // also lists CLIENT sockets on the port — including this very process's
    // keep-alive connection from the status probe (killing the test runner
    // with SIGTERM mid-setup) and any user browser tab attached to Foundry.
    const pids = execFileSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8"
    }).trim();
    for (const pid of pids.split("\n").filter((p) => /^\d+$/.test(p))) {
      process.kill(Number(pid));
    }
  } catch {
    /* nothing listening */
  }
  if (fs.existsSync(PID_FILE)) fs.rmSync(PID_FILE);
}

function startServer(worldId) {
  assertEnvOwned("start the Foundry server");
  const log = fs.openSync(path.join(FOUNDRY_DATA, "Logs", "stdout.log"), "a");
  const child = spawn(
    FOUNDRY_NODE,
    ["main.js", `--dataPath=${FOUNDRY_DATA}`, `--world=${worldId}`],
    { cwd: FOUNDRY_APP, detached: true, stdio: ["ignore", log, log] }
  );
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
}

/** Ensure the Foundry server is running with the test world active. */
export async function ensureTestWorld() {
  let status = await serverStatus();
  if (status?.active && status.world === TEST_WORLD) return status;
  stopServer();
  await new Promise((r) => setTimeout(r, 2000));
  startServer(TEST_WORLD);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    status = await serverStatus();
    if (status?.active && status.world === TEST_WORLD) return status;
  }
  throw new Error(`Foundry did not come up with world "${TEST_WORLD}" on ${BASE_URL}`);
}

/**
 * Try to authenticate `page` as `userName` from a saved storageState cookie
 * (written by the "setup" Playwright project) instead of the interactive
 * /join flow. Returns true on success (page is left on /game, ready).
 */
async function loginFromSavedState(page, userName) {
  const file = AUTH_STATE_FILES[userName];
  if (!file || !fs.existsSync(file)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    await page.context().addCookies(state.cookies ?? []);
    await page.goto(`${BASE_URL}/game`);
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 10_000 });
    const actualUser = await page.evaluate(() => game.user?.name);
    if (actualUser !== userName) {
      throw new Error(`landed as "${actualUser}", expected "${userName}"`);
    }
    return true;
  } catch (err) {
    console.warn(
      `login() fast-path miss for "${userName}" (${err.message}) — falling back to interactive /join.`
    );
    return false;
  }
}

/** Log a page in as the named user (no passwords in the test worlds). */
export async function login(page, userName) {
  if (await loginFromSavedState(page, userName)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE_URL}/join`);
    const select = page.locator('select[name="userid"]');
    await select.waitFor({ timeout: 15_000 });
    const disabled = await select
      .locator("option", { hasText: userName })
      .first()
      .isDisabled()
      .catch(() => false);
    if (disabled) {
      throw new Error(
        `User "${userName}" is already connected to the test world — close other sessions (browsers, stray test runners) and retry.`
      );
    }
    await select.selectOption({ label: userName });
    await page.locator('button[name="join"], form#join-game-form button[type="submit"]').first().click();
    try {
      await page.waitForURL("**/game", { timeout: 30_000 });
      break;
    } catch (error) {
      // Cold server boots occasionally swallow the first join; retry once.
      if (attempt === 1) throw error;
    }
  }
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
}

/**
 * Run `fn(page)` against a *fresh*, logged-in-as-Gamemaster page in its own
 * browser context, then close that context. For cleanup in specs whose
 * tests use `browser` to open their own multi-client contexts rather than
 * the default `page` fixture: a `test.afterEach(async ({ page }) => ...)`
 * hook still gets Playwright's default (never-navigated, never-logged-in)
 * `page` fixture regardless of what the test itself used, so
 * `page.evaluate(() => game...)` against it throws "game is not defined" —
 * silently, if the caller wraps it in `.catch(() => {})` as earlier drafts
 * of this suite did, meaning cleanup for those specs never actually ran and
 * state leaked between tests (confirmed live: a leftover
 * playersWriteSessions=true from one test changing the next test's
 * ownership scenario; a leftover timepoint from one test being picked up as
 * "newest" by the next). Route afterEach cleanup through this instead.
 */
export async function withGmPage(browser, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await fn(page);
  } finally {
    await context.close();
  }
}

/**
 * Cleanup helper for afterEach hooks in specs that mix the default `page`
 * fixture with tests that open their own `browser` contexts: reuses `page`
 * directly when the test itself already left it as a live, ready Gamemaster
 * session (true for every test using `page` — cheaper, and avoids a genuine
 * bug confirmed live: opening a *second* simultaneous Gamemaster session via
 * withGmPage() while the test's own `page` is still connected as the same
 * user — Playwright doesn't tear down `page` until after all hooks for that
 * test complete — silently produced a socket/session conflict where
 * deleteDocuments() calls from the second session appeared to succeed
 * (no thrown error, deletedCount > 0 in the response) but never actually
 * stuck: a "Campaign Timeline" journal reliably survived cleanup on the very
 * next check, every time, only when done this way). Falls back to
 * withGmPage() (a genuine fresh session) only when `page` isn't already a
 * live GM session — true for tests that used `browser` instead, where the
 * default `page` fixture never navigated anywhere.
 */
export async function cleanupAsGm(page, browser, fn) {
  const alreadyGm = await page.evaluate(() => {
    try {
      return globalThis.game?.ready === true && game.user?.isGM === true;
    } catch {
      return false;
    }
  }).catch(() => false);
  if (alreadyGm) {
    await fn(page);
    return;
  }
  await withGmPage(browser, fn);
}

/** As a logged-in GM page: enable a module by id if needed (reloads on change). */
export async function ensureModuleEnabled(page, moduleId = MODULE_ID) {
  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (active) return;
  await page.evaluate(async (id) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = true;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, moduleId);
  await page.goto(`${BASE_URL}/game`);
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  const nowActive = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (!nowActive) throw new Error(`module "${moduleId}" could not be enabled in the test world`);
}

/** As a logged-in GM page: disable a module by id if active (reloads on change). */
export async function ensureModuleDisabled(page, moduleId = MODULE_ID) {
  const active = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (!active) return;
  await page.evaluate(async (id) => {
    const cfg = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    cfg[id] = false;
    await game.settings.set("core", "moduleConfiguration", cfg);
  }, moduleId);
  await page.goto(`${BASE_URL}/game`);
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 60_000 });
  const nowActive = await page.evaluate((id) => game.modules.get(id)?.active === true, moduleId);
  if (nowActive) throw new Error(`module "${moduleId}" could not be disabled in the test world`);
}

/** Delete all journal entries (and thus their pages) whose name starts with the prefix. */
export async function deleteJournalsByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.journal.filter((e) => e.name.startsWith(p)).map((e) => e.id);
    if (ids.length) await JournalEntry.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Delete all actors whose name starts with the prefix (crashed-run artifacts). */
export async function deleteActorsByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.actors.filter((a) => a.name.startsWith(p)).map((a) => a.id);
    if (ids.length) await Actor.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Delete all scenes whose name starts with the prefix (crashed-run artifacts). */
export async function deleteScenesByPrefix(page, prefix = TT_PREFIX) {
  await page.evaluate(async (p) => {
    const ids = game.scenes.filter((s) => s.name.startsWith(p)).map((s) => s.id);
    if (ids.length) await Scene.implementation.deleteDocuments(ids);
  }, prefix);
}

/** Delete any leftover combats (crashed-run artifacts from auto-capture specs). */
export async function deleteAllCombats(page) {
  await page.evaluate(async () => {
    const ids = game.combats.map((c) => c.id);
    if (ids.length) await Combat.implementation.deleteDocuments(ids);
  });
}

/**
 * Bounded settle for asserting a change did NOT happen: a no-op has no
 * observable completion signal to await, so we wait out the round-trip window.
 */
export async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
}

// Known, cosmetic MEJ-side gap (see task-14-report.md) — TWO distinct MEJ
// bugs independently produce the identical-looking 404, confirmed live by
// re-testing after the deeper one was fixed:
//   1. (fixed in MEJ, commit f24cbac on feat/extension-api) preCreateJournalEntry
//      (monks-enhanced-journal.js, was ~4556-4566) stamped
//      `flags.img = assets/${type}.png` into every entry's *persisted* data
//      for any type in getDocumentTypes(), with no external-type guard - this
//      was the report's original diagnosis gap: the task-14-report.md first
//      draft attributed the 404 entirely to bug #2 below and missed this one,
//      which is the more serious of the two (it writes a wrong value into
//      stored document data, not just a transient render guess). Same guard
//      pattern as the `_onCreate` site's existing `!externalType` check
//      (monks-enhanced-journal.js:1063, fix 1437846) now applied here too.
//   2. (still present, unfixed, out of scope - MEJ-side) The sidebar/tab
//      icon-render fallback (monks-enhanced-journal.js ~line 5292) guesses
//      `assets/${pagetype}.png` for any type present in getDocumentTypes()
//      with no explicit img *at render time*, independent of whatever flag
//      value (if any) is actually stored - so even a freshly-created Session
//      page with bug #1 now fixed (confirmed live: its persisted
//      flags["monks-enhanced-journal"].img is `undefined`, not a bad path)
//      still 404s the moment its icon renders, from this second, separate
//      site. Non-blocking (a missing icon image, not a functional break) -
//      filtered here rather than fixed, since it's MEJ-side, not
//      companion-side, and outside this task's authorized fix list.
export const KNOWN_MEJ_SESSION_ICON_404 = /assets\/session\.png/;

// The headless viewport (1280x720, set for canvas-off perf per the harness
// convention) is below Foundry's own recommended-minimum check — logged as
// a console error on every world load regardless of anything under test.
export const KNOWN_LOW_RESOLUTION_WARNING = /requires a screen resolution of/;

// Expected noise, not a bug: Foundry's own core JournalEntryPage schema
// validation (documentTypes merging is live per client "setup", not frozen
// at server boot) rejects a companion-namespaced page's type the moment the
// companion module goes inactive — logged as "Failed to initialize
// JournalEntryPage ... is not a valid type" on every subsequent reload while
// disabled. This is exactly the scenario 00-mej-api.spec.mjs's fixType guard
// test deliberately creates; the underlying stored data (and MEJ's own
// interop flag) is untouched, it's just inaccessible via normal .get() while
// the module is off (see {invalid: true} reads in that spec).
export const EXPECTED_INVALID_TYPE_WHILE_DISABLED = /is not a valid type for the JournalEntryPage Document class/;

// Real, live-discovered MEJ-side bug (not a companion bug, not fixed here —
// see task-14-report.md): a module's registered shell-page document (the
// Hub included) never implements the `.compendium` getter that
// EnhancedJournal.renderSubSheet's non-GM permission re-check
// (enhanced-journal.js ~486: `!game.user.isGM && testing && (!testing
// .compendium && ...)`) reads on every re-render where `options.force` /
// `this.tempOwnership` aren't set. A fresh open passes (something upstream
// sets one of those first), but a later re-render — confirmed live: the
// debounced Hub search input, which re-renders on every keystroke — throws
// "A subclass of Document must implement this getter" and ABORTS that
// render. Corrected characterization (task-14-report.md's original
// "cosmetic, underlying update still lands" was wrong for this path,
// verified live via 03-search.spec.mjs's finding-#5 positive control): the
// aborted render means search results genuinely never paint for a non-GM
// client (0 rows), and a second attempt can leave the shell's own inputs
// unreachable. Real, and can hit any module with an open shell page on any
// non-GM client's re-render, not just campaign-companion's Hub. Worked
// around test-side in 03-search.spec.mjs's openHubSearch() by setting
// `game.MonksEnhancedJournal.journal.tempOwnership = true` right after
// opening (steers every later render around the buggy branch, same
// mechanism MEJ's own code uses once it resolves the temp-ownership path)
// — not a fix, since it touches only this test session's client instance.
export const KNOWN_MEJ_BLANKJOURNAL_COMPENDIUM_BUG = /A subclass of Document must implement this getter/;

/** Collect console errors on a page; call assertNoConsoleErrors() at spec end. */
export function trackConsoleErrors(page, { ignore = [] } = {}) {
  const allIgnore = [KNOWN_LOW_RESOLUTION_WARNING, ...ignore];
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A failed-resource-load console message's text is just the generic
    // "Failed to load resource: the server responded with a status of ###"
    // — the actual URL only lives on msg.location().url, so ignore patterns
    // matching a resource path (like KNOWN_MEJ_SESSION_ICON_404) need that
    // checked too, not just the message text.
    const location = msg.location()?.url ?? "";
    if (allIgnore.some((re) => re.test(text) || re.test(location))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = String(err);
    if (allIgnore.some((re) => re.test(text))) return;
    errors.push(text);
  });
  return errors;
}

export function assertNoConsoleErrors(errors) {
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
}
