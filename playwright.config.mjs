import { defineConfig } from "@playwright/test";

/**
 * E2E tests run against a local Foundry VTT v14 server with the dedicated
 * test world (world-a) active. Global setup starts/switches the server as
 * needed. See tests/e2e/README.md for environment details and overrides.
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
    baseURL: process.env.FOUNDRY_URL ?? "http://localhost:30000",
    viewport: { width: 1440, height: 900 },
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
