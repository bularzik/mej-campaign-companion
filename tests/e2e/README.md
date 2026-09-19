# E2E test environment

The suite runs against a local Foundry VTT v14 install (`~/FoundryVTT-14`,
port 30000) with the dedicated test world `world-a` active. Global setup
(`global-setup.mjs` → `ensureTestWorld()` in `helpers/foundry.mjs`) starts or
switches the server as needed; overrides via `FOUNDRY_URL`, `FOUNDRY_APP`, `FOUNDRY_DATA`, `FOUNDRY_NODE`,
`FOUNDRY_TEST_WORLD`, `FOUNDRY_MODULE_LINK`, `FOUNDRY_MAIN_CHECKOUT`; or pick a
whole preset with `FOUNDRY_TARGET=v13` (Foundry 13.351 + stock MEJ 13.06 at
`~/FoundryVTT`, world-b, port 30013 — see `helpers/target.mjs`). Global setup
refuses to run if `/api/status` reports a different Foundry generation than
the target expects. Test documents are
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

Procedure. The MEJ install at
`~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal` is a git worktree
of the MEJ repo; the stock build is tag `14.01`, the API build is the fork
line (`integration-14.08`) or the head of upstream PR #823. Its `packs/*`
bookkeeping files carry `skip-worktree` flags and differ between the two
lines, so a checkout across lines needs Foundry stopped and the flags cleared:

1. Stop Foundry: `~/FoundryVTT-14/stop-foundry.command`
2. Back up World A:
   `mkdir -p ~/FoundryVTT-14/backups && cp -R ~/FoundryVTT-14/Data/Data/worlds/world-a ~/FoundryVTT-14/backups/world-a-pre-stock-smoke-<date>`
3. Check out the stock build in the module worktree:
   ```
   cd ~/FoundryVTT-14/Data/Data/modules/monks-enhanced-journal
   git ls-files -v packs | grep '^S' | cut -c3- | xargs git update-index --no-skip-worktree
   git checkout -f --detach 14.01
   git ls-files packs | grep -E 'CURRENT|LOG|MANIFEST|\.log$' | xargs git update-index --skip-worktree
   ```
   then relaunch Foundry on World A from
   `~/FoundryVTT-14/FoundryVTT-Node-14.368` (the newest `FoundryVTT-Node-14.*`
   dir):
   `node main.js --dataPath=/Users/danbularzik/FoundryVTT-14/Data --world=world-a --port=30000`
   (background it; write its pid to `~/FoundryVTT-14/Data/.pid`). Do not write
   `--dataPath=~/...` — neither bash nor zsh expands `~` after `=`, so the
   server would come up on an empty data directory.
4. `STOCK_PHASE=stock npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
   — the file argument keeps the rest of the suite (written for the API
   build) from running against stock.
5. Stop Foundry; repeat step 3 with the API build's ref in place of `14.01`;
   relaunch.
6. `STOCK_PHASE=return npx playwright test tests/e2e/13-stock-smoke.spec.mjs`
7. Delete the World A backup once the run is judged clean.

Never commit in the module worktree: Foundry's LevelDB pack churn shows there
as modified `packs/*` files and is discardable noise.

Failure policy: companion defects ship as a new patch release from a new
branch — published release assets are never modified in place. Breakage
attributable to stock MEJ itself is documented in the README's mode table,
not "fixed" in the companion. Stock-MEJ-owned behaviors (what stock MEJ does
when *it* opens an unknown-typed entry; stock MEJ's own console noise) are
recorded as test annotations for the run report, never asserted.

## Stock gate on v13 (required before any release claiming Foundry 13)

The v13 install's MEJ is upstream 13.06 — stock by definition, no symlink
swap, no world backup (world-b is a sandbox). The `return` phase cannot run
there (it asserts `api` mode on the API-carrying MEJ), so a `cleanup` phase
deletes the fixture instead.

1. `npm run e2e:stock:v13` — global setup starts Foundry 13 on port 30013
   with world-b if it is not already up, links the module, and runs the
   `stock` phase (boot, Hub, New Session, search, and the asserted sidebar
   open of the session).
2. `npm run e2e:stock:v13:cleanup` — deletes `TT-STOCKSMOKE Session`.

The v14 server on port 30000 is untouched throughout. Run the v14 full suite
separately (`npm run test:e2e`, default target).

Summarise a JSON report: `node tests/e2e/helpers/summarize-run.mjs <report.json> [label]`
(run Playwright with `--reporter=list,json` and
`PLAYWRIGHT_JSON_OUTPUT_NAME=<path>`).
