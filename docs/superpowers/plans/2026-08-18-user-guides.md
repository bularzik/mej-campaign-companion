# User Guides (GM + Player) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `docs/gm-guide.md` and `docs/player-guide.md` — two complete, screenshot-illustrated, task-oriented user guides — linked from the README, with a gated Playwright spec that regenerates every screenshot.

**Architecture:** One new e2e spec (`tests/e2e/guide-screenshots.spec.mjs`, gated on `GUIDE_SHOTS=1`, skipped otherwise — same pattern as `13-stock-smoke.spec.mjs`'s `STOCK_PHASE` gate) seeds a clean-named demo campaign, captures ~21 PNGs into `docs/images/`, and sweeps itself clean by a `guideDemo` flag. The two guides are then written against those images. Documentation only — zero runtime-code changes.

**Tech Stack:** Playwright (existing harness in `tests/e2e/`), Foundry VTT v14 World A, GitHub-flavored Markdown, one small Node link-check script.

**Spec:** `docs/superpowers/specs/2026-08-18-user-guides-design.md` — read it first; it fixes the guide outlines, the mode-split decision (api-mode screenshots only), and the cross-linking rules this plan implements.

## Global Constraints

- Screenshots depict **api mode** only (World A's current MEJ build carries the extension API). Never swap the MEJ symlink for this work.
- Demo content uses clean fantasy names, **no `TT-` prefix** — cleanup is by the `guideDemo` flag, not the prefix sweep.
- Every seeded document carries `flags["mej-campaign-companion"].guideDemo: true`.
- The new spec must be **skipped entirely** when `GUIDE_SHOTS` is unset — normal e2e runs (45 tests) and CI must be unaffected.
- Guides link to README sections for trust models, docx round-trip details, and the authoritative settings table — never duplicate that normative text.
- Guide prose is English-only, matching module scope.
- No runtime-code changes. `scripts/`, `templates/`, `styles/`, `lang/` are untouched.
- All work on a feature branch off `main` (e.g. `feature/user-guides`), PR at the end per repo convention.

## Environment prerequisites (read before Task 1)

- Foundry v14 must be running with World A active; `tests/e2e/global-setup.mjs` boots/switches it automatically on any `npx playwright test` run. See `tests/e2e/README.md`.
- The harness drives three logged-in clients: `Gamemaster`, `User 1`, `User 2` (see `tests/e2e/auth.setup.mjs`, `helpers/foundry.mjs`'s `login()`).
- Viewport is 1440×900 (`playwright.config.mjs`) — all screenshots inherit it; don't override per-shot.
- Key helper exports (`tests/e2e/helpers/foundry.mjs`): `login(page, userName)`, `settle(page, ms)`, `MODULE_ID` (`"mej-campaign-companion"`), `MEJ_MODULE_ID`, `trackConsoleErrors`.
- Known-good selectors from existing specs (verify against the cited spec before trusting variations): MEJ shell `#MonksEnhancedJournal`; Hub tab nav `nav.sheet-tabs a[data-tab="..."]` (tab names: check `02-hub-timeline.spec.mjs:89` for `timeline`, `08-query-graph.spec.mjs` for `dashboards`, `10-secrets-hub.spec.mjs` for `secrets`); timepoint controls `button.mej-cc-add-timepoint` / `li.mej-cc-timepoint` (`02:94-100`); secret audience button `.mej-cc-secret-audience` (`09:90`); revealed-secret marker `section.secret.mej-cc-revealed-to-you` (`09:116`).

---

### Task 1: Gated capture-spec skeleton — gating, sweep, settings snapshot, shot helper

**Files:**
- Create: `tests/e2e/guide-screenshots.spec.mjs`
- Create: `docs/images/` (directory, created by the spec at runtime via `mkdirSync`)

**Interfaces:**
- Produces (for Tasks 2–3, which extend this same file): `shot(target, name)` — screenshots a Locator or Page to `docs/images/<name>.png`; `sweepGuideDemo(page)` — deletes every `guideDemo`-flagged JournalEntry; `SETTINGS_TO_RESTORE` — the world-setting snapshot/restore list; the `guideDescribe` gate.

- [ ] **Step 1: Write the skeleton**

```js
// Guide screenshot capture — regenerates every image in docs/images/ used by
// docs/gm-guide.md and docs/player-guide.md. NOT a test of behavior; a
// deliberately-gated documentation tool, following 13-stock-smoke's gating
// pattern. A normal suite run (GUIDE_SHOTS unset) skips this file entirely.
//
// Run:  GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs
//
// Seeded demo content uses clean fantasy names (no TT- prefix — these names
// appear in published screenshots). Cleanup is by the guideDemo flag, swept
// at start AND end so a crashed run leaves nothing and reruns are idempotent.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { login, settle, MODULE_ID } from "./helpers/foundry.mjs";

const GATED = process.env.GUIDE_SHOTS === "1";
const guideDescribe = GATED ? test.describe : test.describe.skip;

const IMG_DIR = "docs/images";

/** Screenshot a Locator (preferred: the app window element) or a Page. */
async function shot(target, name) {
  await target.screenshot({ path: `${IMG_DIR}/${name}.png` });
}

/** Delete every guideDemo-flagged JournalEntry (idempotent). */
async function sweepGuideDemo(page) {
  await page.evaluate(async (id) => {
    const doomed = game.journal.filter((e) => e.getFlag(id, "guideDemo"));
    for (const e of doomed) await e.delete();
  }, MODULE_ID);
}

// World settings the demo run mutates; snapshotted in beforeAll, restored in
// afterAll. timelineJournalId is reset to "" at start (02-hub-timeline's
// pattern, see its file-header comment) so the Hub creates a FRESH timeline
// journal for the shots; that fresh journal is deleted before restore.
const SETTINGS_TO_RESTORE = [
  "timelineJournalId",
  "savedQueries",
  "playerGroups",
  "retroLinkMode",
  "autoLink"
];
let settingsSnapshot = {};

guideDescribe("guide screenshots", () => {
  test.beforeAll(async ({ browser }) => {
    mkdirSync(IMG_DIR, { recursive: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    settingsSnapshot = await page.evaluate((keys) => {
      const out = {};
      for (const k of keys) out[k] = game.settings.get("mej-campaign-companion", k);
      return out;
    }, SETTINGS_TO_RESTORE);
    await sweepGuideDemo(page);
    await page.evaluate(async () => {
      await game.settings.set("mej-campaign-companion", "timelineJournalId", "");
    });
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "Gamemaster");
    await sweepGuideDemo(page);
    // Delete the fresh timeline journal this run created, then restore.
    await page.evaluate(async (snapshot) => {
      const id = game.settings.get("mej-campaign-companion", "timelineJournalId");
      if (id && id !== snapshot.timelineJournalId) await game.journal.get(id)?.delete();
      for (const [k, v] of Object.entries(snapshot))
        await game.settings.set("mej-campaign-companion", k, v);
    }, settingsSnapshot);
    await context.close();
  });

  test("placeholder — seeding and captures land in Tasks 2–3", async () => {
    expect(GATED).toBe(true);
  });
});
```

Note: the placeholder test is deleted in Task 2 — it exists only so this task's skeleton is runnable/reviewable on its own.

- [ ] **Step 2: Verify the gate — normal runs skip it**

Run: `npx playwright test tests/e2e/guide-screenshots.spec.mjs --list` (GUIDE_SHOTS unset)
Expected: the file's tests listed as skipped / no runnable tests. Then run `npx playwright test` (full suite, GUIDE_SHOTS unset) and confirm the same 45-test count as before this branch, all green.

- [ ] **Step 3: Verify the gated path runs clean**

Run: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs`
Expected: PASS (1 test). World A unchanged: no `guideDemo`-flagged journals (there were none to sweep), settings restored verbatim.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/guide-screenshots.spec.mjs
git commit -m "test: gated guide-screenshot spec skeleton (GUIDE_SHOTS)"
```

---

### Task 2: Demo seeding + GM-perspective captures

**Files:**
- Modify: `tests/e2e/guide-screenshots.spec.mjs` (replace the placeholder test)
- Output: `docs/images/*.png` (GM set, 18 files — committed)

**Interfaces:**
- Consumes: Task 1's `shot`, `sweepGuideDemo`, `guideDescribe`, settings snapshot.
- Produces: the seeded demo world state Task 3's player shots depend on (Task 3 runs in the same spec file, later tests of the same `guideDescribe` block — Playwright runs them in order, `workers: 1`).

**Demo cast (clean names, all flagged `guideDemo`):** Persons *Mira Thornwood* (tags `ally`, `merchant`; attributes `trustworthiness: high`, plus one `playerHidden` attribute `secret loyalty: The Gilded Hand`), *Captain Aldric Vane*, *Serena of the Vale*; Place *The Gilded Flagon*; Quest *The Missing Caravan*; Session *Session 12 — Shadows over Daggerford* (GM recap, one player recap, attendees, secret checklist, one block secret); player group *Inner Circle*; 4 timepoints (one calendar-dated); saved query `type:person tag:ally`.

- [ ] **Step 1: Add seeding helpers and the seed test**

Direct-create the data documents (fast, deterministic); drive the UI only where the UI itself is the screenshot subject (timepoints, saved query, player group — their creation dialogs/tabs are shots). Seeding code — adapt the cited existing-spec patterns where marked:

```js
/** Create an MEJ-typed entry (person/place/quest/encounter). Pattern from
 *  07-knowledge.spec.mjs createPerson() and 01-session.spec.mjs:197. */
async function seedMejEntry(page, { name, mejType, text = "", flags = {}, ownership }) {
  return await page.evaluate(async ({ name, mejType, text, flags, ownership, id }) => {
    const entry = await JournalEntry.create({
      name,
      ownership: ownership ?? undefined,
      flags: { [id]: { guideDemo: true } },
      pages: [{
        name,
        type: `monks-enhanced-journal.${mejType}`,
        text: { content: text },
        flags: { "monks-enhanced-journal": { type: mejType }, [id]: flags }
      }]
    });
    return entry.id;
  }, { name, mejType, text, flags, ownership, id: MODULE_ID });
}
```

For the Session entry, copy the `createSessionViaDialog` helper **verbatim** from `tests/e2e/01-session.spec.mjs:15` into this file (it drives MEJ's New Entry dialog, which is also how the GM guide tells users to do it), then rename the created entry to the demo name and stamp the `guideDemo` flag:

```js
const sessionId = await createSessionViaDialog(gmPage, "Session 12 — Shadows over Daggerford");
await gmPage.evaluate(async ({ sessionId, id }) => {
  await game.journal.get(sessionId).setFlag(id, "guideDemo", true);
}, { sessionId, id: MODULE_ID });
```

Fill Session fields (session number, campaign date, GM recap, attendees, checklist) through the sheet UI — `01-session.spec.mjs` shows the field selectors; filling via UI also puts realistic content in the session-sheet shot. Seed the block secret by updating the session page's text content with the `09-secrets.spec.mjs:18` HTML shape (`<section class="secret" id="guide-secret-1"><p>…</p></section>` after a public paragraph), with narrative secret text ("The caravan was never attacked — Aldric staged it."), then set its reveal audience via the `.mej-cc-secret-audience` UI (that dialog is a shot).

Relationships: link Mira ↔ The Gilded Flagon and Aldric ↔ The Missing Caravan through MEJ's relationships UI or the flag shape used at `07-knowledge.spec.mjs:105` — check that spec's relationship handling and mirror it exactly. Attributes/tags: seed via the flag shapes proven at `07-knowledge.spec.mjs:267` (`attributes: [{ name, value, hidden }] — copy the exact object keys from that line`) and its tags round-trip test (`:118`); put narrative values, not TT- strings.

Timepoints: open the Hub timeline tab and create 4 via `button.mej-cc-add-timepoint` + rename (`02-hub-timeline.spec.mjs:92-112` pattern), binding one to a calendar date through its date UI. Attach the Quest entry to one timepoint. Saved query: create through the Dashboards tab UI. Player group: create *Inner Circle* (members: User 1) through the Hub Secrets tab UI. Also append the literal text `@CampaignQuery[type:person tag:ally]` to The Gilded Flagon's page content — that rendered enricher is the `campaign-query-inline.png` shot.

- [ ] **Step 2: Add the GM capture test(s) — 16 shots**

One or more `test()` blocks after seeding, GM client. For each shot, open the relevant window, `await settle(page, …)` until stable, and screenshot the **window element** (e.g. `page.locator("#MonksEnhancedJournal")`, or the Hub/graph/prep-board window element in specs `02`/`08`/`10`), not the full page. Shot list (filename → subject):

| File | Subject |
|---|---|
| `hub-index.png` | Hub entry index pane, demo entries visible with mention-count badges |
| `hub-timeline.png` | Timeline tab, 4 timepoints, one calendar-dated |
| `hub-search.png` | Search pane with results for `caravan` |
| `hub-dashboards.png` | Dashboards tab, the saved `type:person tag:ally` query with inline results |
| `hub-secrets-tab.png` | Secrets tab, filters + the demo secret row + Inner Circle group |
| `session-sheet-gm.png` | Full Session sheet, GM view |
| `session-checklist.png` | The secret-checklist region of the Session sheet |
| `campaign-date-picker.png` | The campaign-date UI open |
| `knowledge-tags-attributes.png` | Knowledge panel on Mira: tags + attributes (incl. hidden row) |
| `knowledge-backlinks.png` | "Mentioned in" panel on The Gilded Flagon |
| `graph-gm.png` | Relationship graph, whole-campaign view, GM |
| `campaign-query-inline.png` | An `@CampaignQuery[type:person tag:ally]` enricher rendered on a page |
| `prep-board.png` | Session prep board |
| `secret-audience-dialog.png` | The reveal dialog on the block secret |
| `docx-import-wizard.png` | Import wizard on the fixture docx from `05-docx-import.spec.mjs` (reuse its fixture file path) |
| `docx-export-dialog.png` | Export dialog with Include GM Content toggle visible |

Also capture `settings.png` (the module's section of Foundry's settings window) and `autolink-confirm.png`: set `retroLinkMode` to `confirm` and `autoLink` on (both already in the restore list), add a plain-text mention of a new name in an existing demo page, create an entity with that name, and screenshot the confirm dialog (`11-auto-link-scope.spec.mjs` has the dialog selectors). That makes 18 GM shots.

- [ ] **Step 3: Run the gated spec; inspect output**

Run: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs`
Expected: PASS; 18 PNGs in `docs/images/`. Open each PNG (Read tool renders images) and check: window fully in frame, demo names (no TT-), no empty panes, no error toasts.

- [ ] **Step 4: Verify idempotency + cleanliness**

Run the same command a second time. Expected: PASS again, images regenerated. Then verify World A is clean: no `guideDemo`-flagged journals remain, `timelineJournalId`/`savedQueries`/`playerGroups`/`retroLinkMode`/`autoLink` match the pre-run snapshot (evaluate in console or a quick one-off script).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/guide-screenshots.spec.mjs docs/images/
git commit -m "test: seed demo campaign and capture GM-perspective guide screenshots"
```

---

### Task 3: Player-perspective captures

**Files:**
- Modify: `tests/e2e/guide-screenshots.spec.mjs`
- Output: `docs/images/*.png` (player set, 5 files — committed)

**Interfaces:**
- Consumes: Task 2's seeded state (same run, later tests in the same describe block); harness `login(page, "User 1")`.

- [ ] **Step 1: Add the player capture test — 5 shots**

Before capturing, from the GM client: grant User 1 OBSERVER on the demo Session (or enable `playersWriteSessions` — no: keep settings minimal, grant ownership directly like `07-knowledge.spec.mjs:159`'s `ownership: 2` pattern) and reveal the block secret to *Inner Circle* via the audience dialog (already open for Task 2's shot — perform the actual reveal here). Then, on a `User 1` page:

| File | Subject |
|---|---|
| `session-sheet-player.png` | The Session sheet as User 1 sees it (no GM notes, recap field editable) |
| `recap-editing.png` | User 1's own recap field focused mid-edit |
| `revealed-secret-player.png` | The page showing `section.secret.mej-cc-revealed-to-you` content (selector: `09-secrets.spec.mjs:116`) |
| `reveal-whisper.png` | The chat log whisper User 1 received on reveal |
| `graph-player.png` | Relationship graph from User 1 — sparser than `graph-gm.png` |

Cleanup addition: Task 1's `afterAll` sweep already deletes the flagged entries, which removes the ownership grant with them; confirm no `playersWriteSessions` or other setting was touched (it wasn't — ownership was granted directly).

- [ ] **Step 2: Full gated run, inspect, verify cleanliness**

Run: `GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs`
Expected: PASS; all 23 PNGs present. Inspect the 5 new ones (player view genuinely lacks GM-only content — check `knowledge` hidden attribute is absent from any player shot). Re-verify world cleanliness as in Task 2 Step 4. Also run the two cheapest canaries against the untouched world: `npx playwright test tests/e2e/01-session.spec.mjs tests/e2e/02-hub-timeline.spec.mjs` (GUIDE_SHOTS unset) — green.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/guide-screenshots.spec.mjs docs/images/
git commit -m "test: capture player-perspective guide screenshots"
```

---

### Task 4: Write the GM guide

**Files:**
- Create: `docs/gm-guide.md`

**Interfaces:**
- Consumes: `docs/images/*.png` (Tasks 2–3 filenames, referenced as `images/<name>.png`); README anchors (`#player-collaboration-notes`, `#docx-round-trip-notes`, `#settings`, the secrets trust-model paragraph under `#secrets-layer-030`, `#running-without-the-mej-extension-api-050`).
- Produces: section anchors the player guide and README link to: `#running-on-stock-mej-native-mode`, `#settings-reference`, `#troubleshooting`.

- [ ] **Step 1: Write the guide**

Fourteen `##` sections, exactly the spec's GM outline (spec § "GM guide outline" — follow it section by section; it fixes the content of each). Style rules:

- Task-oriented second person ("Create your first session by…"), numbered steps for procedures, screenshots placed immediately after the step they illustrate: `![The Campaign Hub index](images/hub-index.png)`.
- Image placements: §1 `hub-index.png`; §2 `settings.png`; §3 `session-sheet-gm.png`, `campaign-date-picker.png`, `session-checklist.png`; §4 `hub-index.png` (reuse ok), `hub-search.png`; §5 `hub-timeline.png`; §6 `knowledge-tags-attributes.png`, `knowledge-backlinks.png`, `graph-gm.png`, `hub-dashboards.png`, `campaign-query-inline.png`; §7 `autolink-confirm.png`; §9 `secret-audience-dialog.png`, `hub-secrets-tab.png`, `prep-board.png`, `reveal-whisper.png` (what the player receives); §10 `docx-import-wizard.png`, `docx-export-dialog.png`; §13 `settings.png` (reuse).
- §2 installation: manifest URL `https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json`, plus manual install; enable both modules.
- Deep-link, don't duplicate (spec § "Cross-linking rules"): §9 links to the README trust-model paragraph and "Everyone" caveat; §10 to README docx round-trip notes; §11 to README player-collaboration notes; §13 lists the five visible settings with when-to-enable guidance and links to the README `#settings` table as authoritative.
- §12 native mode: the four differences, verbatim facts from README lines 62–69; no screenshots (spec: prose only).
- §14 troubleshooting: the two startup notifications (missing-MEJ vs `init-failed`), observers never block saves, docx import all-or-nothing, issues at the GitHub repo.
- Factual source of truth when writing any behavioral claim: README first, then the code (`scripts/constants.mjs` for setting names). Do not state behavior found in neither.

- [ ] **Step 2: Verify rendering and facts**

Preview the Markdown (any renderer). Check: every image renders; every numbered procedure matches what the Task-2/3 capture run actually did in the UI (the spec file is now a script of real UI paths — reread it and confirm the guide's steps match); setting names match `scripts/constants.mjs`.

- [ ] **Step 3: Commit**

```bash
git add docs/gm-guide.md
git commit -m "docs: GM user guide"
```

---

### Task 5: Write the player guide

**Files:**
- Create: `docs/player-guide.md`

**Interfaces:**
- Consumes: player-set images; GM-guide anchors (`#running-on-stock-mej-native-mode` not needed; link to GM guide's secrets section for "ask your GM" pointers).

- [ ] **Step 1: Write the guide**

Seven `##` sections, exactly the spec's player outline. Image placements: §1 `session-sheet-player.png`; §2 `recap-editing.png`; §3 `hub-search.png` (GM-set reuse is fine where the player view is identical — search results shown are audience-filtered, note this in the caption); §4 `graph-player.png`; §5 `reveal-whisper.png`, `revealed-secret-player.png`; §6 `hub-timeline.png`. §7 quick answers: "why can't I see X" (audience gating: you only see what your permissions allow — links, search results, graph edges all filter the same way), "why didn't my name get linked" (auto-link only links what every reader of the page can see), "can the GM read my recap" (yes — recaps are visible to the whole table including the GM). Written for a reader with zero module knowledge; never mentions settings, modes, or flags.

- [ ] **Step 2: Verify rendering**

Preview; every image renders; no GM-only concept (prep board, Secrets tab, playerHidden, native mode) appears.

- [ ] **Step 3: Commit**

```bash
git add docs/player-guide.md
git commit -m "docs: player user guide"
```

---

### Task 6: README edits, link check, final verification

**Files:**
- Modify: `README.md` (two edits)
- Create: `tests/docs/check-guide-links.mjs`

**Interfaces:**
- Consumes: both guides' filenames and top-level anchors.

- [ ] **Step 1: README — add Documentation section**

Insert after the intro paragraph (currently line 3), before `## Features`:

```markdown
## Documentation

- **[GM Guide](docs/gm-guide.md)** — installation, running sessions, the Campaign Hub, secrets, import/export: everything the GM drives, with screenshots.
- **[Player Guide](docs/player-guide.md)** — what players see and do: recaps, search, the relationship graph, revealed secrets.

The rest of this README is the technical reference: exact feature semantics, trust models, and caveats.
```

- [ ] **Step 2: README — fix the stale Installation paragraph**

Current lines 95 and 101 are stale (repo + releases exist since 0.1.0). Replace the section body so it reads: install via manifest URL `https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json` in Foundry's Install Module dialog (preferred), or manually clone into `Data/modules/mej-campaign-companion`; keep the existing step-3 enable-both-modules text and the load-order note verbatim; **delete** the "`module.json`'s `url`, `manifest`, and `download` fields point at … doesn't exist yet" paragraph entirely.

- [ ] **Step 3: Write the link/image checker**

```js
// tests/docs/check-guide-links.mjs — verifies guide images exist, no orphans,
// and intra-/cross-doc anchors resolve. Run: node tests/docs/check-guide-links.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";

const DOCS = ["docs/gm-guide.md", "docs/player-guide.md", "README.md"];
const slug = (h) => h.toLowerCase().replace(/[^\w\- ]/g, "").trim().replace(/ /g, "-");
const anchors = {}, errors = [];
for (const f of DOCS) {
  const text = readFileSync(f, "utf8");
  anchors[f] = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}
const referenced = new Set();
for (const f of DOCS) {
  const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
  for (const [, target] of readFileSync(f, "utf8").matchAll(/\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    const [path, anchor] = target.split("#");
    const resolved = path ? dir + path : f;
    if (path && !existsSync(resolved)) { errors.push(`${f}: missing file ${target}`); continue; }
    if (path?.endsWith(".png")) referenced.add(resolved);
    if (anchor && anchors[resolved] && !anchors[resolved].has(anchor))
      errors.push(`${f}: dead anchor ${target}`);
  }
}
for (const img of readdirSync("docs/images"))
  if (!referenced.has(`docs/images/${img}`)) errors.push(`orphan image docs/images/${img}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("guide links OK");
```

- [ ] **Step 4: Run all verification**

```bash
node tests/docs/check-guide-links.mjs        # expected: "guide links OK"
npm test                                      # expected: 503/503
npx playwright test                           # expected: 45/45, guide spec skipped
GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs  # reproducibility: PASS, images regenerate
```

Fix anything the checker reports (dead anchors are the likely offender — GitHub slugging of em-dash headings; adjust links, not the checker, unless the checker's slug rule is provably wrong vs GitHub's).

- [ ] **Step 5: Commit and open PR**

```bash
git add README.md tests/docs/check-guide-links.mjs docs/images/
git commit -m "docs: link user guides from README, fix stale install section, add link checker"
```

Then follow repo convention: push the branch, open a PR against `main` summarizing the two guides, screenshot pipeline, and README fix.
