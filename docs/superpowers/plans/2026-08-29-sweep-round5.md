# Bugfix Sweep Round 5 (docs & test hygiene) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring both user guides and all their screenshots up to the 0.13.x UI, and close the four recorded e2e flakes by root cause or by documented non-reproduction.

**Architecture:** Two independent workstreams sharing one branch. Workstream A (guides) is driven by a live-UI audit file that the prose and screenshot tasks consume — nothing is written from the changelog. Workstream B (flakes) is a data-gathering job (≥5 full-suite runs, logged) followed by triage. Both need the e2e environment lock at different times, so B's runs start first and run in the background while A's lock-free prose work proceeds; A's screenshot capture runs only after B's runs finish.

**Tech Stack:** Markdown guides in `docs/`, Playwright e2e against the live Foundry v14 world (`tests/e2e/`), the gated screenshot harness `tests/e2e/guide-screenshots.spec.mjs` (`GUIDE_SHOTS=1`), `npm run check:links`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-bugfix-sweep-design.md`, section "Round 5 scope (reconciled 2026-08-29)".

## Global Constraints

- Companion features never patch MEJ: no edits outside this repo.
- Only Workstream B may touch `scripts/`, and only for a root-caused product bug, with a regression test and a vacuity check (disable the fix by hand-edit, confirm the test fails, restore).
- e2e env lock (`tests/e2e/helpers/env-lock.mjs`): if `LockHeldError` fires, wait; never `npm run e2e:unlock` while another job's pid is alive.
- The test world is **World A, the user's real world**: all cleanup is flag/id-tracked (`guideDemo` flag, `TT-` prefix); never name-based deletes.
- Screenshots use clean fantasy names (no `TT-` prefix); they are published.
- Existing image filenames in `docs/images/` stay stable; new features get new files.
- `npm run check:links` must be green at every commit that touches a guide.
- Flake bar: a failure counts as reproduced only if seen in ≥1 of ≥5 full 18-spec runs; unreproduced items are closed with the run log, never with a retry.
- Documentation alone does not cut a release; 0.13.5 only if B lands a product fix.

---

### Task 1: Live UI audit (source of truth for the rewrite)

**Files:**
- Create: `docs/superpowers/plans/2026-08-29-sweep-round5-ui-audit.md`

**Interfaces:**
- Produces: the audit file, whose headings are consumed verbatim by Tasks 4, 5 and 6. Required sections, each a bullet inventory of what is *actually on screen*, with the exact visible labels and the CSS selector / `data-action` for each control:
  1. `## Hub header bar` — every control above the tabs (campaign picker options incl. "New Campaign", Tools menu items, anything else).
  2. `## Hub panes` — the six tabs (`index, timeline, graph, search, dashboards, secrets`) and, per pane, its controls, filters and empty-state text.
  3. `## Campaigns` — how a campaign is created, filed into (`fileIntoCampaign`, `fileAllShown`), the Unfiled scope, and what a player sees.
  4. `## Portal` — where it opens from, what it shows, restore behaviour (`restorePortal`).
  5. `## Multi-timeline` — timeline selector, new/rename/delete flows.
  6. `## Portraits` — where portraits appear (graph nodes, index rows?) and how one is set.
  7. `## Secrets (0.13.3 semantics)` — the audience dialog options as now labelled, what "Everyone" does natively, recap-secret reveal path.
  8. `## Session sheet` and `## Knowledge panel` — anything changed since 0.8.
  9. `## Player view` — the same tour logged in as `Player1`.
  10. `## Gaps vs current guides` — a table: guide statement → what is true now.

- [ ] **Step 1: Read the current guides and the 0.9.0–0.13.4 changelog entries** so you know what to look for (`docs/gm-guide.md`, `docs/player-guide.md`, `CHANGELOG.md` from `## 0.13.4` down to `## 0.9.0`). Read `tests/e2e/14-campaigns.spec.mjs`, `15-campaign-portal.spec.mjs`, `16-multi-timeline.spec.mjs` for the selectors they drive — they are the fastest map of the current chrome.

- [ ] **Step 2: Write a throwaway Playwright script** at `$CLAUDE_JOB_DIR/tmp/ui-audit.spec.mjs` (NOT in the repo) that logs in via `login(page, "Gamemaster")` from `tests/e2e/helpers/foundry.mjs`, opens the Hub the way `15-campaign-portal.spec.mjs:23 openHub` does, and for each tab dumps `innerText` and every `[data-action]`/`button`/`select` with its label to stdout. Then the same as `Player1`. It creates nothing; it is read-only. Run it with `npx playwright test --config playwright.config.mjs <path>` from the worktree (the config's `testDir` is `./tests/e2e`, so copy the script to `tests/e2e/zz-audit.tmp.spec.mjs` for the run and `rm` it afterwards — confirm with `git status` that it is gone).

- [ ] **Step 3: Write the audit file** with the ten sections above. Every claim must come from the dump or from a screen you looked at, not from the changelog. Where a feature turns out to be absent or different from what the changelog implies, say so explicitly.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-29-sweep-round5-ui-audit.md
git commit -m "docs(round5): live UI audit for the guide rewrite"
```

---

### Task 2: Start the flake data run (Workstream B, background)

Controller task — run by the session itself, not a subagent, because it holds the env lock for ~1.5–2.5 h and must not overlap Task 1 or Task 6.

**Files:**
- Create (gitignored, under the job tmp dir): `$CLAUDE_JOB_DIR/tmp/flake-runs/run-{1..5}.log`

- [ ] **Step 1: Confirm Task 1's audit run has released the lock** (`ls /Users/danbularzik/FoundryVTT-14/Data/.claude-e2e-lock` → no such file).

- [ ] **Step 2: Launch five sequential full-suite runs in the background**, from the worktree:

```bash
mkdir -p "$CLAUDE_JOB_DIR/tmp/flake-runs"
cd /Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/sweep-round5
( for i in 1 2 3 4 5; do
    echo "=== run $i start $(date -u +%FT%TZ)" > "$CLAUDE_JOB_DIR/tmp/flake-runs/run-$i.log"
    npx playwright test --trace off --reporter=line >> "$CLAUDE_JOB_DIR/tmp/flake-runs/run-$i.log" 2>&1
    echo "=== run $i exit $? $(date -u +%FT%TZ)" >> "$CLAUDE_JOB_DIR/tmp/flake-runs/run-$i.log"
  done; echo ALL-DONE > "$CLAUDE_JOB_DIR/tmp/flake-runs/DONE" ) &
```

`GUIDE_SHOTS` is unset, so `guide-screenshots.spec.mjs` is skipped and the run is the 18 behaviour specs.

- [ ] **Step 3: Record in the SDD ledger** the launch time and the expected finish (first Round 4 8-spec sweep took 5.5 min; budget ~15 min per full run).

---

### Task 3: Rewrite `docs/gm-guide.md` to 0.13.x

**Files:**
- Modify: `docs/gm-guide.md`
- Read: `docs/superpowers/plans/2026-08-29-sweep-round5-ui-audit.md` (Task 1)

**Interfaces:**
- Consumes: the audit file's exact labels.
- Produces: the final list of image filenames the guide cites (existing 23 kept; new ones named `hub-header.png`, `hub-graph.png`, `campaign-picker.png`, `campaign-unfiled.png`, `portal.png`, `timeline-selector.png`, `portrait-node.png` — use exactly these names; Task 5 creates them).

- [ ] **Step 1: Keep the heading skeleton**, adding two sections in this order: `## Campaigns` after `## The Campaign Hub`, and `## The player portal` after `## Player collaboration`. Rewrite every section against the audit: the Hub is six panes (Graph is a pane — delete the "graph icon in the Hub's toolbar" sentence at line 96 and the "toolbar" phrasing at 68/165/175/199 in favour of the header bar / Tools menu labels from the audit); the Secrets section describes 0.13.3 semantics (Everyone = Foundry's native revealed; recap secrets reveal through the tracker); Multi-timeline goes into `## The timeline & campaign dates`; Portraits into `## Building your campaign record`.

- [ ] **Step 2: Cite images** with the stable names; for each new feature paragraph add the corresponding new image reference from the Interfaces list.

- [ ] **Step 3: Run the link check** — `npm run check:links`. It will report the seven new images as missing until Task 5 creates them; that is the only acceptable failure. Record the exact missing list in the report.

- [ ] **Step 4: Commit**

```bash
git add docs/gm-guide.md
git commit -m "docs: GM guide rewritten for the 0.13.x Hub, campaigns, portal, timelines, portraits, native secrets"
```

---

### Task 4: Rewrite `docs/player-guide.md` to 0.13.x

**Files:**
- Modify: `docs/player-guide.md`
- Read: the audit file's `## Player view`, `## Portal`, `## Secrets` sections

- [ ] **Step 1: Rewrite** each of the seven sections against the audit's player tour. Add `## The campaign portal` after `## Finding things`. Secrets section: what a revealed secret looks like now (native reveal — it appears in core sheets and exports too). Cite `portal.png` (shared with the GM guide) and existing player images.

- [ ] **Step 2: `npm run check:links`** — only `portal.png` may be reported missing.

- [ ] **Step 3: Commit**

```bash
git add docs/player-guide.md
git commit -m "docs: player guide rewritten for 0.13.x (portal, native reveals, six-pane Hub)"
```

---

### Task 5: Extend the screenshot harness for the new UI

**Files:**
- Modify: `tests/e2e/guide-screenshots.spec.mjs`

**Interfaces:**
- Consumes: `createCampaign(name, { ownershipDefault })` from `/modules/mej-campaign-companion/scripts/data/campaign-store.mjs` (as used at `tests/e2e/14-campaigns.spec.mjs:151`); the harness's own `shot(target, name)`, `openHub`, `openHubTab`, `seedMejEntry`.
- Produces: the seven new PNGs named in Task 3.

- [ ] **Step 1: Seeding.** In the `"seed the demo campaign"` test, after the existing entries are created, create one campaign named `"The Vale Chronicles"` via `createCampaign` and file the seeded entries into it with the same production function 14-campaigns uses for filing (read `14-campaigns.spec.mjs:748-770` for the call). Leave one entry unfiled so the Unfiled scope has a row. Tag the campaign folder with the `guideDemo` flag so `sweepGuideDemo` removes it; extend `sweepGuideDemo` to delete flagged campaign folders (`deleteSubfolders: true, deleteContents: true`) — id/flag-tracked only. Snapshot and restore any setting `createCampaign` mutates (`autoCaptureCampaign` — see `14-campaigns.spec.mjs:75-80`) in the existing snapshot mechanism.

- [ ] **Step 2: Captures.** In `"capture Hub, entry-sheet, and graph screenshots"`, add: `hub-header` (the header bar element), `hub-graph` (the graph pane — replaces the popup-based `graph-gm` route if the audit shows the popup no longer exists; keep `graph-gm.png` produced from the pane in that case), `campaign-picker` (picker open), `campaign-unfiled` (Unfiled scope with the one unfiled row), `timeline-selector`, `portrait-node`. Add `portal` in the player test. Use the selectors recorded in the audit file.

- [ ] **Step 3: Lint-level check without the env** — `node --check tests/e2e/guide-screenshots.spec.mjs` and `npx playwright test --list tests/e2e/guide-screenshots.spec.mjs` with `GUIDE_SHOTS=1` (listing does not take the lock).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/guide-screenshots.spec.mjs
git commit -m "test(guide-shots): seed a campaign; capture header, graph pane, picker, unfiled, timeline selector, portrait, portal"
```

---

### Task 6: Recapture every screenshot and verify against the prose

Controller-gated: runs only after `$CLAUDE_JOB_DIR/tmp/flake-runs/DONE` exists.

**Files:**
- Modify: `docs/images/*.png` (all 23 + 7 new)

- [ ] **Step 1: Run** from the worktree: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs --trace off`. Expected: 4/4 passed, `tests/e2e/.guide-shots-snapshot.json` absent afterwards (clean restore).

- [ ] **Step 2: Verify the world is clean**: no journal or folder carrying the `guideDemo` flag remains (`game.journal.filter(j => j.flags["mej-campaign-companion"]?.guideDemo).length === 0` and the same for `game.folders`).

- [ ] **Step 3: Review every image against the paragraph that cites it** — open each PNG (Read tool) and confirm it shows what the prose says, with no `TT-` names and no real-world content. List each image → verdict in the report. Any mismatch is fixed in prose or capture, not waved.

- [ ] **Step 4: `npm run check:links`** — green, zero missing.

- [ ] **Step 5: Commit**

```bash
git add docs/images
git commit -m "docs: recapture all guide screenshots against 0.13.4"
```

---

### Task 7: Flake triage

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-bugfix-sweep-design.md` (Round 5 outcome section)
- Possibly modify: the reproducing spec and/or `scripts/` (only for a root-caused product bug, with test + vacuity check)

- [ ] **Step 1: Tabulate** the five logs: for each run, the ordered list of failing tests (`grep -n "✘\|failed\|Error:" run-N.log`). Produce a table `test × run` for the four tracked items (06-player-collab any test; 09-secrets "reveal to Everyone round-trips"; 07-knowledge "playerHidden"; 04-auto-capture) plus anything new.

- [ ] **Step 2: For each reproducing failure**, use `superpowers:systematic-debugging`: isolate (run the spec alone ×3), then pair it with its predecessor in the suite order ×3 to separate order-dependence from intrinsic flake, read the failure's assertion and the code path, and fix at the root. A product fix gets a regression test and a vacuity check; a test-only fix (e.g. a real race between two browser contexts in 06) is fixed in the test with a comment stating the race it waits for — no `retries`, no `waitForTimeout` padding.

- [ ] **Step 3: For each non-reproducing item**, close it as *unreproduced* with the run log summary.

- [ ] **Step 4: Regression gate for any code change**: full suite once more (18 specs) and compare against the five baseline runs.

- [ ] **Step 5: Commit** (message names the root cause), then append `## Round 5 outcome` to the spec with the table, each item's verdict, unit count, and e2e counts.

```bash
git add -A
git commit -m "test: <root cause, or 'record flake triage: N reproduced, M unreproduced'>"
```

---

### Task 8: CHANGELOG and release decision

**Files:**
- Modify: `CHANGELOG.md`; `module.json` only if releasing.

- [ ] **Step 1:** If Task 7 landed a product fix: bump to `0.13.5`, CHANGELOG entry for the fix plus "User guides rewritten for 0.13.x", then finishing-a-development-branch → PR → tag `0.13.5` → release as in Round 4. Otherwise: add an `## Unreleased` CHANGELOG entry "User guides and screenshots rewritten for the 0.13.x Hub, campaigns, portal, timelines and portraits", no version bump, PR only.

- [ ] **Step 2: Commit and hand off** to `superpowers:finishing-a-development-branch`.
