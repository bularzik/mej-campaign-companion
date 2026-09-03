import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureTestWorld, login, ensureModuleEnabled, serverStatus,
  deleteJournalsByPrefix, deleteActorsByPrefix, deleteScenesByPrefix, deleteAllCombats,
  BASE_URL, MODULE_ID, MEJ_MODULE_ID
} from "./helpers/foundry.mjs";
import { acquireLock, releaseLock } from "./helpers/env-lock.mjs";
import { pinSymlink, verifyDeployment } from "./helpers/deploy.mjs";
import { TARGET, generationOf } from "./helpers/target.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Exclusive-access gate for the shared Foundry install: lock, pin the
 * companion module symlink to this checkout, boot, verify served code,
 * sweep TT- leftovers. Does NOT touch the monks-enhanced-journal symlink —
 * that's pointed at the feat-extension-api worktree by hand for Task 14
 * (see task-14-report.md) and must stay that way across runs.
 */
export default async function globalSetup() {
  acquireLock({ worktree: REPO_ROOT });
  try {
    // Pre-flight wrong-server guard: check BEFORE pinSymlink/ensureTestWorld
    // touch anything. ensureTestWorld() itself stops/starts the server on a
    // world mismatch, so by the time the post-ensureTestWorld guard below
    // could inspect /api/status, a mis-targeted run would already have
    // SIGTERM'd the wrong (possibly the user's real v14) server. If nothing
    // answers here, proceed — ensureTestWorld will start the right binary.
    const preflight = await serverStatus();
    if (preflight) {
      const preflightGeneration = generationOf(preflight.version);
      if (preflightGeneration !== TARGET.generation) {
        throw new Error(
          `Pre-flight: Target "${TARGET.name}" expects Foundry ${TARGET.generation} at ${BASE_URL} but /api/status reports version "${preflight.version}".`
        );
      }
    }
    pinSymlink(REPO_ROOT);
    const status = await ensureTestWorld();
    // Wrong-server guard: FOUNDRY_TARGET=v13 pointed at the v14 server (or
    // the reverse) would run this suite against the wrong world — the v14
    // one is the user's real world. /api/status reports "13.351" / "14.367".
    const generation = generationOf(status?.version);
    if (generation !== TARGET.generation) {
      throw new Error(
        `Target "${TARGET.name}" expects Foundry ${TARGET.generation} at ${BASE_URL} but /api/status reports version "${status?.version}".`
      );
    }
    await verifyDeployment({ baseURL: BASE_URL, repoRoot: REPO_ROOT });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await login(page, "Gamemaster");
      await ensureModuleEnabled(page, MEJ_MODULE_ID);
      await ensureModuleEnabled(page, MODULE_ID);
      // The stock-smoke return phase (13-stock-smoke.spec.mjs) depends on a
      // TT- fixture created by the PREVIOUS invocation (its stock phase) —
      // sweeping journals here would delete the very document whose heal the
      // phase exists to verify (this happened; see the spec's header). Any
      // later normal run still reclaims stock-smoke leftovers.
      if (process.env.STOCK_PHASE !== "return") await deleteJournalsByPrefix(page);
      await deleteActorsByPrefix(page);
      await deleteScenesByPrefix(page);
      await deleteAllCombats(page);
      // An active scene makes every headless client render its canvas via
      // software WebGL, which starves player-side tests into timeouts.
      await page.evaluate(async () => {
        if (game.scenes.active) await game.scenes.active.update({ active: false });
      });
    } finally {
      await browser.close();
    }
  } catch (err) {
    releaseLock();
    throw err;
  }
}
