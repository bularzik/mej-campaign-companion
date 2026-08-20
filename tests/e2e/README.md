# E2E test environment

The suite runs against a local Foundry VTT v14 install (`~/FoundryVTT-14`,
port 30000) with the dedicated test world `world-a` active. Global setup
(`global-setup.mjs` → `ensureTestWorld()` in `helpers/foundry.mjs`) starts or
switches the server as needed; overrides via `FOUNDRY_URL`, `FOUNDRY_APP`,
`FOUNDRY_DATA`, `FOUNDRY_NODE`, `FOUNDRY_TEST_WORLD`. Test documents are
prefixed `TT-`. Monk's Enhanced Journal is expected at
`~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal`, a symlink to a
checkout of the MEJ repo.

A `GUIDE_SHOTS=1` run of `guide-screenshots.spec.mjs` assumes a swept World A
— no stray player-visible journals left behind by other manual or crashed
runs — since shot cleanliness (e.g. a clean Hub index, an uncluttered
relationship graph) depends on that world hygiene, which the spec itself
doesn't own or verify.

## Stock-MEJ smoke test (manual pre-release gate)

`13-stock-smoke.spec.mjs` is the only suite that runs the companion against a
**genuinely stock** Monk's Enhanced Journal — a build that never fires the
`setupMonksEnhancedJournal` handshake. `12-native-mode.spec.mjs` reaches
native mode via the `forceNativeMode` setting on the API-carrying fork, which
exercises every code path but cannot prove real-stock behavior (a stock MEJ
actively strips the companion's interop flag, has no knowledge of the session
type, and may differ in ways the fork does not). Run this gate before any
release that claims stock compatibility.

The file is skipped entirely unless `STOCK_PHASE` is set; a normal suite run
never executes it. The two phases are separate invocations bridged by a
fixed-name fixture (`TT-STOCKSMOKE Session`) that phase 1 creates and phase 2
verifies (heal) and deletes.

Procedure — from the MEJ repo:

1. `git worktree add --detach /tmp/mej-stock-smoke maint/14.00-sync`
2. Stop Foundry: `kill $(lsof -ti :30000 -sTCP:LISTEN)`
3. Back up World A:
   `mkdir -p ~/FoundryVTT-14/backups && cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-<date>`
4. Repoint the module symlink (`rm` + `ln -s`; never `ln -sfn` onto an
   existing directory symlink, which can create the link *inside* the target):
   `rm ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal && ln -s /tmp/mej-stock-smoke ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal`
5. `STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
   — global setup boots World A itself; the file argument keeps the rest of
   the suite (written for the API build) from running against stock.
6. Stop Foundry again; repoint the symlink back:
   `rm ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal && ln -s ~/Claude/Projects/monks-enhanced-journal ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal`
7. `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
8. `git worktree remove --force /tmp/mej-stock-smoke` (Foundry's LevelDB pack
   churn dirties the worktree; the noise is discardable).
9. Delete the World A backup once the run is judged clean.

Failure policy: companion defects ship as a new patch release from a new
branch — published release assets are never modified in place. Breakage
attributable to stock MEJ itself is documented in the README's mode table,
not "fixed" in the companion. Stock-MEJ-owned behaviors (what stock MEJ does
when *it* opens an unknown-typed entry; stock MEJ's own console noise) are
recorded as test annotations for the run report, never asserted.
