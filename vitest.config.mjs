import { defineConfig } from "vitest/config";

// Playwright's own spec files (tests/e2e/*.spec.mjs, Task 14) match
// vitest's default include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) just
// like this project's real unit tests (test/*.test.js) do — without this
// exclude, `npm test` tries to collect them as vitest tests and fails on
// Playwright's own `test.describe()` ("did not expect test.describe() to be
// called here"), even though the actual unit suite passes. Excluding
// tests/e2e/ keeps the two test runners scoped to their own directories.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "tests/e2e/**"]
  }
});
