import { defineConfig } from "vitest/config";

// Playwright's own spec files (tests/e2e/*.spec.mjs, Task 14) match
// vitest's default include glob (**/*.{test,spec}.?(c|m)[jt]s?(x)) just
// like this project's real unit tests (test/*.test.js) do — without this
// exclude, `npm test` tries to collect them as vitest tests and fails on
// Playwright's own `test.describe()` ("did not expect test.describe() to be
// called here"), even though the actual unit suite passes. Excluding
// tests/e2e/ keeps the two test runners scoped to their own directories.
// `.claude/worktrees/**` (C15): a git worktree is a COMPLETE second checkout
// living inside this one, so vitest's default include glob collects its test/
// files too - the suite silently multiplies by the number of worktrees present.
// Their copies of tests/e2e/*.spec.mjs fail as vitest tests on top of that,
// because the "tests/e2e/**" exclude above is checkout-relative and does not
// match ".claude/worktrees/<name>/tests/e2e/**". Observed concretely: `npm test`
// in a checkout holding two worktrees reported 196 test files, 38 of them
// failing, and 1832 tests, against a real suite of 602 - so a green-looking
// number could be measuring code from a branch you are not even on. Excluding
// the directory keeps a run measuring the checkout it was started from.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "tests/e2e/**", "**/.claude/worktrees/**"]
  }
});
