# Import Type-List Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant `text` pseudo-type from the docx import wizard, suggest Session for session-shaped sections, order the type select sensibly, and surface session detection in the review step.

**Architecture:** All behavior changes live in the pure `logic/doc-import.mjs` (suggestion precedence, legacy-type normalization) so they're unit-testable; `apps/import-wizard.mjs` + template/i18n changes are thin presentation (option list contents/order, a detection-count line). Creation shapes are untouched — 0.7.0 already made `text` rows create `journalentry` entries, which is what makes the pseudo-type deletable.

**Tech Stack:** Foundry VTT v13/v14 module (ES modules, no build step), vitest for pure logic, Playwright e2e against a live Foundry world.

**Spec:** `docs/superpowers/specs/2026-08-23-import-type-cleanup-design.md` (committed on this branch — read it first; it records the decision table, including WHY the fallback is `journalentry` and not `session`).

## Global Constraints

- Work on branch `feature/import-type-cleanup` in the worktree `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/import-type-cleanup`. Never commit to main.
- Companion-only rule: no changes to the monks-enhanced-journal repo, ever.
- Playwright e2e MUST run with `--trace off` (near-full disk).
- E2E fixtures use the `TT-` name prefix; World A is a shared live world — restore any state you change; destructive cleanup must be id-tracked, never name-based against non-`TT-` names.
- Creation shapes must not change: `journalentry` rows go through `createMejEntry("journalentry", …)`, `session` rows through `buildSessionPageData()` — exactly as on main today.
- Unit suite must stay green: `npx vitest run` from the worktree root, expected 541 tests before this plan, 545 after Task 1.

---

### Task 1: Suggestion precedence + legacy-type normalization (pure logic)

**Files:**
- Modify: `scripts/logic/doc-import.mjs:209-219` (LEGACY_TYPE_ALIASES), `:227-239` (suggestType), `:248-278` (buildImportPlan)
- Test: `test/doc-import.test.js`

**Interfaces:**
- Consumes: existing `markerType`, `normalizeType`, `TYPE_KEYWORDS`, `LEGACY_TYPE_ALIASES` module-privates in the same file; `section.isSession` (already computed by `splitSections`).
- Produces: `suggestType(section, recordTypes)` now returns `{type: "session"}` for `section.isSession === true` (markers still win) and `{type: "journalentry"}` as the fallback (never `"text"`); `buildImportPlan(sections, rows, recordTypes)` emits `pages[i].type` values normalized through `normalizeType()` (so `"text"` → `"journalentry"`). Task 2 and the e2e rely on exactly these two behaviors.

- [ ] **Step 1: Write the failing tests**

In `test/doc-import.test.js`, REPLACE this existing test (currently at ~line 167):

```js
  it("defaults sessions and unknown titles to text", () => {
    expect(suggestType(sec({ title: "Arc 1 Session 1 10/26/24", isSession: true }), KINDS).type).toBe("text");
    expect(suggestType(sec({ title: "Radiant Citadel" }), KINDS).type).toBe("text");
  });
```

with:

```js
  it("suggests session for session-shaped sections", () => {
    expect(suggestType(sec({ title: "Arc 1 Session 1 10/26/24", isSession: true }), KINDS).type).toBe("session");
    // A session-shaped title never falls into the keyword table.
    expect(suggestType(sec({ title: "Session 3 - The Quest Begins", isSession: true }), KINDS).type).toBe("session");
  });

  it("defaults unknown titles to journalentry (Text and Image)", () => {
    expect(suggestType(sec({ title: "Radiant Citadel" }), KINDS).type).toBe("journalentry");
  });

  it("a round-trip marker still beats the session shape", () => {
    const s = sec({ title: "Session 1 1/5/25", isSession: true, html: "<p>Campaign Record type: quest</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "quest", fromMarker: true });
  });

  it("normalizes a legacy text marker to journalentry", () => {
    const s = sec({ title: "Untitled", html: "<p>Campaign Record type: text</p><p>body</p>" });
    expect(suggestType(s, KINDS)).toEqual({ type: "journalentry", fromMarker: true });
  });
```

In the `describe("buildImportPlan", …)` block, UPDATE the existing "creates pages, merges, and skips" test — change both `type: "text"` row values to `type: "journalentry"` and the expected `pages[1]` object's `type: "text"` to `type: "journalentry"` (nothing else in that test changes) — and ADD:

```js
  it("normalizes the retired text pseudo-type to journalentry (stale form state)", () => {
    const { pages } = buildImportPlan([sections[0]], [
      { title: "Intro", type: "text", timepoint: false }
    ], KINDS);
    expect(pages[0].type).toBe("journalentry");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from the worktree root): `npx vitest run test/doc-import.test.js`
Expected: the 5 new/changed suggestType + buildImportPlan tests FAIL (suggestType returns "text"; buildImportPlan emits "text"); everything else passes.

- [ ] **Step 3: Implement in `scripts/logic/doc-import.mjs`**

Add the `text` alias — the existing object becomes:

```js
const LEGACY_TYPE_ALIASES = {
  npc: "person",
  pc: "person",
  checklist: "list",
  item: "journalentry",
  media: "journalentry",
  // campaign-record's "text" pseudo-type (and this module's own, retired
  // 2026-08-23): a plain-prose page, whose companion equivalent is the MEJ
  // "Text and Image" (journalentry) entry — 0.7.0 already made the two
  // create identical documents, which is what makes the alias lossless.
  text: "journalentry"
};
```

Replace `suggestType` (keep the doc comment line above it, updated):

```js
/** Suggest a wizard type for a section: exporter marker > session shape > title keywords > journalentry. */
export function suggestType(section, recordTypes) {
  const rawMarker = markerType(section.html);
  const fromMarker = rawMarker ? normalizeType(rawMarker) : null;
  if (fromMarker && recordTypes.includes(fromMarker)) return { type: fromMarker, fromMarker: true };
  // Session-shaped sections (detectSessionHeader) suggest the session type
  // itself, not just a pre-checked timepoint — before 2026-08-23 the shape
  // only skipped the keyword table and fell through to the prose fallback,
  // so every real session log imported as prose unless retyped by hand.
  if (section.isSession && recordTypes.includes("session")) return { type: "session", fromMarker: false };
  if (!section.isSession) {
    for (const [re, rawType] of TYPE_KEYWORDS) {
      const type = normalizeType(rawType);
      if (re.test(section.title) && recordTypes.includes(type)) return { type, fromMarker: false };
    }
  }
  return { type: "journalentry", fromMarker: false };
}
```

In `buildImportPlan`, replace the type validation + push (the last two statements of the `forEach` callback):

```js
    if (row.type !== "text" && !recordTypes.includes(row.type)) {
      throw new Error(`unknown import type "${row.type}"`);
    }
    pages.push({ name, type: row.type, html, timepoint: row.timepoint ? name : null });
```

with:

```js
    // Normalize before validating: a stale form still posting the retired
    // "text" pseudo-type (mid-upgrade client) plans as journalentry.
    const type = normalizeType(row.type);
    if (!recordTypes.includes(type)) {
      throw new Error(`unknown import type "${row.type}"`);
    }
    pages.push({ name, type, html, timepoint: row.timepoint ? name : null });
```

Also update the function's doc comment line `type: "text" | record kind | "skip" | "merge".` to `type: record kind | "skip" | "merge" (legacy "text" normalizes to "journalentry").`

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (545 total).

- [ ] **Step 5: Commit**

```bash
git add test/doc-import.test.js scripts/logic/doc-import.mjs
git commit -m "feat: suggest session for session-shaped sections; retire text pseudo-type in plan logic"
```

---

### Task 2: Wizard select list, review-step detection line, copy

**Files:**
- Modify: `scripts/apps/import-wizard.mjs:137-169` (_prepareContext + #typeOptions), `:428-452` (#createPage), and the header comment `:1-10`
- Modify: `templates/import-wizard.hbs:39` (insert before the doc-title heading)
- Modify: `lang/en.json:252` (`import` block: remove `typeText`, add `sessionsDetected`)
- Modify: `scripts/constants.mjs:96-108` (COMPANION_IMPORT_TYPES doc comment)

**Interfaces:**
- Consumes: Task 1's `suggestType` (rows now arrive typed `session`/`journalentry`; no row is ever `"text"`), `buildImportPlan` normalization; existing `COMPANION_IMPORT_TYPES` (unchanged contents).
- Produces: the type `<select>` contains exactly the 12 companion types (ordered) + `skip` — no `text` option; review context exposes `sessionsDetected` (number). The Task 3 e2e asserts both.

- [ ] **Step 1: Replace `#typeOptions` in `scripts/apps/import-wizard.mjs`**

Replace the whole method (including the `{ value: "text", … }` entry and its comment) with:

```js
  // Explicit presentation order (spec A §2): prose first, session next, then
  // the typed sheets roughly by how often docx sections map to them, Skip
  // last. Every entry is in COMPANION_IMPORT_TYPES; the retired "text"
  // pseudo-type is gone — journalentry ("Text and Image") IS the prose type.
  static #TYPE_ORDER = [
    "journalentry", "session", "person", "place", "organization", "quest",
    "encounter", "event", "poi", "shop", "loot", "list"
  ];

  #typeOptions(selected) {
    const labels = game.MonksEnhancedJournal.getTypeLabels();
    const options = [
      ...ImportWizard.#TYPE_ORDER.map((t) => ({
        value: t,
        label: t === "session"
          ? game.i18n.localize(`${I18N}.sheettype.session`)
          : game.i18n.localize(labels[t] ?? t)
      })),
      { value: "skip", label: game.i18n.localize(`${I18N}.import.typeSkip`) }
    ];
    return options.map((o) => ({ ...o, selected: o.value === selected }));
  }
```

(`COMPANION_IMPORT_TYPES` stays imported — `#onCreate` still passes it to `buildImportPlan`.)

- [ ] **Step 2: Delete `#createPage`'s text branch**

In the same file, delete these three lines:

```js
    if (page.type === "text") {
      return createMejEntry("journalentry", page.name, page.html, {}, ownership, folderId);
    }
```

and update the stale wording in the two comments above it: in the method's doc comment, replace the sentence beginning `"text" rows are created as MEJ "Text and Image" (journalentry) entries via createMejEntry - NOT as plain unflagged text pages, …` (through `…and it opens outside the MEJ shell.`) with:

```
   * The retired "text" pseudo-type never reaches here — buildImportPlan
   * normalizes it to "journalentry" (logic/doc-import.mjs), which the
   * generic createMejEntry tail below handles.
```

and in the `JournalEntry.create()` comment inside the method, change `The "session" branch below destructured it` back-reference wording `every "text"/"session" section` to `every "session" section`.

- [ ] **Step 3: Expose the detection count and render it**

In `_prepareContext`, after `context.audienceOptions = …;` add:

```js
    context.sessionsDetected = this.state.sections.filter((s) => s.isSession).length;
```

In `templates/import-wizard.hbs`, directly BEFORE the line `{{#if docTitle}}<h3 class="mej-cc-import-doctitle">{{docTitle}}</h3>{{/if}}`, insert:

```handlebars
    {{#if sessionsDetected}}
    <p class="hint mej-cc-import-sessions-detected">{{localize "MEJCampaignCompanion.import.sessionsDetected" count=sessionsDetected}}</p>
    {{/if}}
```

In `lang/en.json`'s `import` block: delete the line `"typeText": "Text page",` and in its place add:

```json
      "sessionsDetected": "{count} sections detected as sessions — their type and timepoint are pre-set.",
```

- [ ] **Step 4: Update the `COMPANION_IMPORT_TYPES` doc comment in `scripts/constants.mjs`**

Replace the sentence `The wizard's type dropdown also offers "text" (a plain, unflagged page) and "skip", same as campaign-record - those aren't part of this list because buildImportPlan special-cases them regardless of the recordTypes list.` with:

```
 * The wizard's type dropdown offers these plus "skip" (not part of this
 * list; buildImportPlan handles it). The old "text" pseudo-type is retired:
 * legacy markers/rows normalize to "journalentry" (see LEGACY_TYPE_ALIASES
 * in logic/doc-import.mjs).
```

- [ ] **Step 5: Verify**

Run: `npx vitest run` — expected: 545 passed (no unit tests target this glue, but the suite must not regress).
Run: `node --input-type=module --check < scripts/apps/import-wizard.mjs && echo OK` — expected: OK.
Run: `grep -rn "typeText" scripts lang templates` — expected: no matches.
Run: `python3 -c "import json; json.load(open('lang/en.json')); print('json ok')"` — expected: `json ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/import-wizard.mjs templates/import-wizard.hbs lang/en.json scripts/constants.mjs
git commit -m "feat: ordered type select without text pseudo-type; sessions-detected review line"
```

---

### Task 3: E2E — sessions import as sessions without manual retyping

**Files:**
- Modify: `tests/e2e/05-docx-import.spec.mjs:130-150` (suggestion assertions), `:144-146` (remove manual select)
- Test: the modified spec itself, run against the live world

**Interfaces:**
- Consumes: Tasks 1-2 (suggested `session` type reaches the select's value; single Text-and-Image option; `.mej-cc-import-sessions-detected` hint).
- Produces: nothing downstream; this is the live verification gate.

- [ ] **Step 1: Point the test env at this worktree**

```bash
ln -sfn /Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/import-type-cleanup ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion
```

(The Foundry server at localhost:30000 stays running; clients load module scripts fresh per test login. `monks-enhanced-journal` must remain pointed at `/Users/danbularzik/Claude/Projects/monks-enhanced-journal` — do not touch it.)

- [ ] **Step 2: Update the spec's suggestion assertions**

In `tests/e2e/05-docx-import.spec.mjs`, find:

```js
    // Types suggested: every dated "session" row's type <select> at least
    // offers "session"...
    expect(rows[sessionZeroIndex].typeOptions).toContain("session");

    // Dated session rows are pre-checked to become timepoints regardless of
    // the chosen entry type.
    expect(rows[sessionZeroIndex].timepoint).toBe(true);

    // Explicitly choose "session" for this one row so we can verify it
    // actually opens as a companion Session afterward.
    await wizard.locator(`select[name="type-${sessionZeroIndex}"]`).selectOption("session");
```

(the first comment's exact wording may differ slightly — match on the three `expect`/`await` statements) and replace with:

```js
    // Session-shaped sections arrive SUGGESTED as session (spec A §1) — the
    // import below relies on the suggestion; no manual retype. Before
    // 2026-08-23 this test had to selectOption("session") by hand.
    expect(rows[sessionZeroIndex].typeOptions).toContain("session");
    expect(rows[sessionZeroIndex].type).toBe("session");

    // Dated session rows are pre-checked to become timepoints.
    expect(rows[sessionZeroIndex].timepoint).toBe(true);

    // The retired "text" pseudo-type is gone — journalentry is the only
    // prose option (spec A §2: exactly one "Text and Image" in the list).
    expect(rows[sessionZeroIndex].typeOptions).not.toContain("text");
    expect(rows[sessionZeroIndex].typeOptions.filter((v) => v === "journalentry")).toHaveLength(1);

    // Detection is visible in the review step, with the right count: the
    // pre-checked timepoint rows ARE the isSession sections, so their tally
    // is the expected number.
    const sessionsDetected = rows.filter((r) => r.timepoint).length;
    await expect(wizard.locator(".mej-cc-import-sessions-detected")).toContainText(String(sessionsDetected));
```

The existing Introduction assertions (`introNativeType`/`introFlagType` = `text`/`journalentry`) and all Session Zero post-import assertions stay untouched — Session Zero must still arrive as `mej-campaign-companion.session`, now via the suggestion alone.

- [ ] **Step 3: Run the suite**

Run (from the worktree root): `npx playwright test tests/e2e/05-docx-import.spec.mjs --trace off --reporter=line`
Expected: 4 passed (3 auth setup + the import test). If the import test fails on the new `rows[sessionZeroIndex].type` assertion, Task 1's suggestType isn't reaching the form — debug there, don't weaken the assertion.

- [ ] **Step 4: Restore the test-env symlink**

```bash
ln -sfn /Users/danbularzik/Claude/Projects/mej-campaign-companion ~/FoundryVTT-14/Data/Data/modules/mej-campaign-companion
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/05-docx-import.spec.mjs
git commit -m "test: e2e asserts session suggestion, single prose option, detection hint"
```
