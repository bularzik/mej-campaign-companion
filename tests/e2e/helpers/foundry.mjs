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

// Known, cosmetic MEJ-side gap (see task-14-report.md): MEJ's sidebar/tab
// icon fallback (monks-enhanced-journal.js ~line 5287) guesses
// `assets/${type}.png` for any recognized type lacking an explicit `img`,
// without consulting `externalTypes[type].icon` the way its main
// `getIcon()` does. MEJ's own "New Entry" dialog path already guards against
// setting a *wrong* img this way for external types (see the `!externalType`
// check near monks-enhanced-journal.js:1063, fix 1437846), but nothing sets
// a *correct* one either, so any Session page without an explicit img still
// hits this 404 the first time its icon renders. Non-blocking (a missing
// icon image, not a functional break) — filtered here rather than fixed,
// since it's MEJ-side, not companion-side.
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
// see task-14-report.md): BlankJournal (apps/enhanced-journal.js's
// placeholder document for shell pages) extends foundry.abstract.Document
// directly and never implements the required `.compendium` getter.
// EnhancedJournal._onRender's non-GM permission re-check
// (`!game.user.isGM && testing && (!testing.compendium && ...)`) reads that
// getter on every re-render of an open shell page (the Hub included) for a
// non-GM client where `options.force`/`this.tempOwnership` aren't set (a
// fresh open passes, a later re-render like the debounced Hub search input
// often doesn't) — throwing "A subclass of Document must implement this
// getter" and aborting that render. Cosmetic in every case observed (the
// underlying data/UI update still lands; only this stray internal check
// throws), but real: any module with an open shell page can hit it on any
// non-GM client's re-render, not just campaign-companion's Hub.
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
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

export function assertNoConsoleErrors(errors) {
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
}
