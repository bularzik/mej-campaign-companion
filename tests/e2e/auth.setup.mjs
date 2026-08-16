import { test as setup } from "@playwright/test";
import fs from "node:fs";
import { login, AUTH_STATE_FILES } from "./helpers/foundry.mjs";

// Playwright "setup" project (see playwright.config.mjs `dependencies:
// ['setup']`). Logs in each test-world user once per full run and saves
// storageState so every spec file's login() call can fast-path via a saved
// session cookie instead of repeating the interactive /join flow.

const authDir = Object.values(AUTH_STATE_FILES)[0].replace(/[^/]+$/, "");
fs.mkdirSync(authDir, { recursive: true });

for (const [userName, file] of Object.entries(AUTH_STATE_FILES)) {
  setup(`authenticate as ${userName}`, async ({ page }) => {
    await login(page, userName);
    await page.context().storageState({ path: file });
  });
}
