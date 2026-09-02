import { defineConfig } from "@playwright/test";
import { TARGET } from "./tests/e2e/helpers/target.mjs";

/**
 * E2E tests run against a local Foundry VTT server. The default target is
 * the v14 install with world-a active; FOUNDRY_TARGET=v13 selects the
 * Foundry 13 + stock MEJ 13.06 install (world-b) used for the v13 stock-smoke
 * gate. Global setup starts/switches the server as needed. See
 * tests/e2e/helpers/target.mjs and tests/e2e/README.md.
 *
 * Adapted from campaign-record's tests/e2e/ harness (helpers copied
 * wholesale, then retargeted: module id campaign-record -> mej-campaign-companion,
 * test world world-b -> world-a, Foundry v13 paths -> v14 paths, "E2E "
 * doc prefix -> "TT-" per the MEJ harness convention).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.mjs",
  globalTeardown: "./tests/e2e/global-teardown.mjs",
  use: {
    baseURL: TARGET.url,
    viewport: { width: 1440, height: 900 },
    // window.screen defaults to 1280x720 in headless Chromium regardless of
    // viewport size. Foundry checks window.screen (not the viewport) against
    // its own recommended minimum (1366x768) and renders a warning banner
    // that intercepts pointer events across the whole page when it's too
    // small — setting `screen` here (a distinct context option from
    // `viewport`) avoids both the banner and its click-blocking.
    screen: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000
  },
  // "setup" logs in Gamemaster + User 1 + User 2 once per run and saves
  // storageState (tests/e2e/.auth/, git-ignored); "e2e" (all *.spec.mjs
  // files) depends on it so login() in helpers/foundry.mjs can fast-path
  // from the saved cookies instead of repeating the interactive /join flow
  // per spec file.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.mjs/ },
    { name: "e2e", testMatch: /.*\.spec\.mjs/, dependencies: ["setup"] }
  ]
});
