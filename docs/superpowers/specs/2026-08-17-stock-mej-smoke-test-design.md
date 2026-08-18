# Stock-MEJ Smoke Test — Design

**Date:** 2026-08-17
**Status:** Approved (design approved in session; spec pending user review)
**Repo:** mej-campaign-companion, branch `feature/stock-smoke-test`

## Goal

Verify that the companion actually works against a **genuinely stock Monk's Enhanced Journal** — one that never fires the `setupMonksEnhancedJournal` handshake — and that a world which visited a stock build comes back to an API-carrying build with zero data loss. The existing e2e suite reaches native mode via the `forceNativeMode` setting on an API-carrying MEJ fork; it exercises every companion code path but cannot prove real-stock behavior. This test closes that gap, and stays in the repo as a repeatable pre-release check, since stock compatibility is now a standing claim of the module (0.5.0+).

## Decisions (made during brainstorming)

- **Stock stand-in:** MEJ branch `maint/14.00-sync` (currently `7f4e8d7`) — the upstream maintainer's 14.07 code synced into the fork, plus only minimal repairs of things that arrived broken in his zip. Verified to contain zero occurrences of `setupMonksEnhancedJournal`. It is the closest *working* proxy for what a real user has installed, and the base the fork's upstream PRs target, so passing here predicts post-merge behavior. (Rejected: the literal maintainer zip snapshot `tmp/maint-zip` — known-broken in ways unrelated to the companion, which muddies the signal; a pre-API fork commit — tests "older fork," not stock.)
- **Form:** a **permanent Playwright spec**, `tests/e2e/13-stock-smoke.spec.mjs`, skipped entirely unless the `STOCK_PHASE` env var is set. The symlink swap/restore stays a documented manual step outside Playwright.
- **Environment:** World A on the local Foundry v14 install (port 30000), with a full world-folder backup taken before the swap.

## Environment orchestration (manual steps, outside Playwright)

All commands are documented in a header comment of the spec file so future runs never re-derive them. The main MEJ checkout (`~/Claude/Projects/monks-enhanced-journal`, on `integration-14.07`) is **never touched**; the stock build lives in a temporary detached worktree.

**Swap to stock:**

1. Create the stock worktree (from any MEJ checkout):
   `git worktree add --detach /tmp/mej-stock-smoke maint/14.00-sync`
2. Stop the Foundry server: `kill $(cat ~/FoundryVTT-14/Data/.pid)` (modules are scanned at world launch, so a swap under a running world is invisible).
3. Back up World A:
   `mkdir -p ~/FoundryVTT-14/backups && cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-2026-08-17`
   (Backups live outside `Data/Data/worlds/` so Foundry does not offer them as worlds.)
4. Repoint the module symlink:
   `rm ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal && ln -s /tmp/mej-stock-smoke ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal`
   (`rm` + `ln -s`, never `ln -sfn` onto an existing dir symlink, which can create the link *inside* the target.)
5. Relaunch: `~/FoundryVTT-14/start-foundry.command`, wait for World A.
6. Run phase 1: `STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs`

**Restore:**

7. Stop the server; repoint the symlink back at `~/Claude/Projects/monks-enhanced-journal` (same `rm` + `ln -s` shape); relaunch.
8. Run phase 2: `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
9. Remove the stock worktree: `git worktree remove --force /tmp/mej-stock-smoke` (`--force` because Foundry's LevelDB rewrites tracked pack bookkeeping files at every world launch, dirtying the worktree; this churn is discardable runtime noise, and the temp worktree has no skip-worktree flags shielding it).
10. The World A backup is kept until the run is judged clean, then deleted manually.

lib-wrapper (already installed alongside) satisfies the stock build's dependency; the symlink's *name* keeps the module id `monks-enhanced-journal` regardless of the target directory.

## The spec file — `tests/e2e/13-stock-smoke.spec.mjs`

Uses the existing harness (`login`, `settle` helpers; adapter state read via dynamic `import("/modules/mej-campaign-companion/scripts/integrations/mej-adapter.mjs")` inside `page.evaluate`, as `12-native-mode.spec.mjs` does). When `STOCK_PHASE` is unset — every normal suite run — the whole file is skipped.

**Cross-phase fixture naming:** the two phases are separate Playwright invocations, so the fixture cannot carry a per-run random suffix. The stock-created session is named with the fixed literal **`TT-STOCKSMOKE Session`** (the `TT-` prefix keeps it inside the harness's established cleanup convention). Phase 1 deletes any leftover fixture of that name at start, making the whole procedure idempotent.

### Phase 1 — `STOCK_PHASE=stock` (symlink → stock build)

1. **MEJ itself booted.** Assert MEJ is `active` and its journal-directory UI is present — a broken stock MEJ must not masquerade as a companion result in either direction.
2. **Mode + clean boot.** `currentMode() === "native"`, `wiringFailed() === false`, no companion error notification (the `mej-missing` / `init-failed` strings must not appear), and no page errors or console errors attributable to the companion during boot. Note: `forceNativeMode` may be left `true` by a previous suite run — harmless here (mode is native either way), but the spec sets it `false` first so the run reflects a real user's configuration.
3. **Hub standalone.** The scene-controls Hub button opens the Hub as its own window; tab switching works.
4. **Session first-class.** Create `TT-STOCKSMOKE Session` via the Hub's **New Session** button; open it from the journal directory; assert the rendered sheet is `SessionSheet` (standalone, not BlankSheet) with its controls responsive.
5. **Search roundtrip.** Hub search finds the new session by name.
6. **No cleanup of the fixture** — it is phase 2's input. (Observation, not assertion: stock MEJ's `fixType` may strip the session's MEJ type flag during the run; the spec records the flag's state in the report annotation for phase 2 context but does not assert on it, because *when* fixType fires is stock MEJ's business.)

### Phase 2 — `STOCK_PHASE=return` (symlink restored to API build)

1. **Mode.** Set `forceNativeMode` to `false` (defensively) and assert `currentMode() === "api"`.
2. **Heal.** After boot settles, assert `TT-STOCKSMOKE Session`'s page carries `flags["monks-enhanced-journal"].type === "session"` **without manually invoking `healSessionFlags()`** — the claim under test is the automatic GM ready-sweep, so the test must observe it, not trigger it. (If phase 1's observation recorded the flag as never stripped, this assertion still holds and is simply vacuous for the heal; the annotation says which case occurred.) This is the roundtrip guarantee: a world that visited stock MEJ returns with zero data loss.
3. **Shell rendering.** The session opens inside the MEJ shell as `SessionSheet`.
4. **Search.** Hub search still finds it.
5. **Cleanup.** Delete all `TT-STOCKSMOKE`-named documents. This phase doubles as the "World A is healthy again" check.

## Failure policy

- Any real companion defect ships as **0.5.1** from a new branch. The published 0.5.0 release assets are **never modified in place** (repo rule).
- Breakage attributable to stock MEJ itself (not the companion) is documented in the companion README's mode table rather than "fixed" in the companion.

## Out of scope (YAGNI)

- Automating the symlink swap / server lifecycle inside the Playwright run.
- Testing against the literal maintainer zip (`tmp/maint-zip`).
- A second/throwaway test world — World A plus a backup is the environment.
- CI integration: the test requires the local Foundry install and a manual symlink swap; it is a deliberate pre-release manual gate.

## Success criteria

Both phases green in a single swap→restore cycle against `maint/14.00-sync`, World A verified healthy afterwards (phase 2 doubles as that check), spec file merged to main so the gate exists for every future release.
