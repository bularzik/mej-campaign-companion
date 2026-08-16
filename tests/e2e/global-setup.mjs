import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureTestWorld, login, ensureModuleEnabled,
  deleteJournalsByPrefix, deleteActorsByPrefix, deleteScenesByPrefix, deleteAllCombats,
  BASE_URL, MODULE_ID, MEJ_MODULE_ID
} from "./helpers/foundry.mjs";
import { acquireLock, releaseLock } from "./helpers/env-lock.mjs";
import { pinSymlink, verifyDeployment } from "./helpers/deploy.mjs";

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
    pinSymlink(REPO_ROOT);
    await ensureTestWorld();
    await verifyDeployment({ baseURL: BASE_URL, repoRoot: REPO_ROOT });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      await login(page, "Gamemaster");
      await ensureModuleEnabled(page, MEJ_MODULE_ID);
      await ensureModuleEnabled(page, MODULE_ID);
      await deleteJournalsByPrefix(page);
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
