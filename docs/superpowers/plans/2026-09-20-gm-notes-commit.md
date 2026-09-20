# GM Notes Commit on Foundry 13 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Session sheet's GM-notes pencil actually save the notes on Foundry 13 as well as 14, by committing through the editor element's public `value` property instead of its (13-private) `save()` method.

**Architecture:** A pure decision function (`shouldCommitGmNotes(live, stored)`) in a new logic module, and a three-line change in `SessionSheet.onEditGmNotes` that reads the `<prose-mirror>`'s public `value` (live content while active) and assigns it back through the public setter when it differs from the document's stored notes. Core then fires the bubbling `change` event that MEJ's submit-on-change form turns into the write. No template, adapter or generation-specific code.

**Tech Stack:** Foundry VTT 13.351 / 14.368 client (`HTMLProseMirrorElement`, `AbstractFormInputElement`), Monk's Enhanced Journal shell (`EnhancedJournalSheet`), vitest for unit tests, Playwright e2e harness (`FOUNDRY_TARGET=v13` / default v14).

**Spec:** `docs/superpowers/specs/2026-09-20-gm-notes-commit-design.md`

## Global Constraints

- Branch: `feat/native-shell-shim` in the worktree `.claude/worktrees/native-shell-shim`; every commit ends with the `Co-Authored-By` / `Claude-Session` trailers in force for this session.
- Companion features never patch MEJ or Foundry: only companion files change.
- No private (`#`) or protected (`_`) member of a Foundry element is called; only `editor.value` (get and set) — spec §2.
- The GM-notes editor stays non-`toggled`; `onEditRecap` and the recap editor are untouched — spec §3.4.
- The `.editing` class toggle in `onEditGmNotes` runs regardless of commit outcome — spec §3.2.
- Both e2e proofs are required green before the plan is complete: `tests/e2e/06-player-collab.spec.mjs` on Foundry 13 native mode (world-b) and on Foundry 14 api mode (world-a) — spec §5. On Foundry 13 the only permitted failure is `:231` at most once (known teardown residual); `:328` must pass.
- `npm test` and `npm run check:links` clean at the end.

---

### Task 1: The pure decision `shouldCommitGmNotes`

**Files:**
- Create: `scripts/logic/gm-notes-commit.mjs`
- Test: `test/gm-notes-commit.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function shouldCommitGmNotes(live: unknown, stored: unknown): boolean` — true only when `live` is a string that differs from `stored`, where an `undefined`/`null` `stored` counts as `""`. Task 2 imports it.

- [ ] **Step 1: Write the failing test**

```js
// test/gm-notes-commit.test.js
import { describe, it, expect } from "vitest";
import { shouldCommitGmNotes } from "../scripts/logic/gm-notes-commit.mjs";

describe("shouldCommitGmNotes", () => {
  it("writes when the live value differs from the stored one", () => {
    expect(shouldCommitGmNotes("<p>new</p>", "<p>old</p>")).toBe(true);
  });

  it("does not write when the live value equals the stored one", () => {
    expect(shouldCommitGmNotes("<p>same</p>", "<p>same</p>")).toBe(false);
  });

  it("treats a missing stored value as empty", () => {
    expect(shouldCommitGmNotes("", undefined)).toBe(false);
    expect(shouldCommitGmNotes("", null)).toBe(false);
    expect(shouldCommitGmNotes("<p>x</p>", undefined)).toBe(true);
  });

  it("never writes a non-string live value (editor missing or not a prose-mirror)", () => {
    expect(shouldCommitGmNotes(undefined, "<p>old</p>")).toBe(false);
    expect(shouldCommitGmNotes(null, "")).toBe(false);
    expect(shouldCommitGmNotes(42, "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/gm-notes-commit.test.js`
Expected: FAIL — "Failed to resolve import ../scripts/logic/gm-notes-commit.mjs" (module does not exist).

- [ ] **Step 3: Write the minimal implementation**

```js
// scripts/logic/gm-notes-commit.mjs
// Decision behind SessionSheet.onEditGmNotes's commit (spec
// 2026-09-20-gm-notes-commit-design.md §3.1). Pure so vitest can pin it:
// the sheet reads the <prose-mirror>'s public `value` (its live content
// while active, its stored value otherwise) and writes it back through the
// public setter only when this says so.

/**
 * Whether the GM-notes editor's current value must be written back.
 * @param {unknown} live   the editor element's `value` (live content while active)
 * @param {unknown} stored the document's `system.gmNotes`
 * @returns {boolean} true only when `live` is a string that differs from `stored`
 *   (a missing stored value counts as "")
 */
export function shouldCommitGmNotes(live, stored) {
  if (typeof live !== "string") return false;
  return live !== (stored ?? "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/gm-notes-commit.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/logic/gm-notes-commit.mjs test/gm-notes-commit.test.js
git commit -m "feat(session): pure decision for the GM-notes commit"
```

---

### Task 2: Commit through the editor's public value; string; e2e proof on both generations; docs

**Files:**
- Modify: `scripts/sheets/SessionSheet.mjs` (imports at :15-24; `onEditGmNotes` at :366-383)
- Modify: `lang/en.json` (the `session` object, beside `"editGmNotes"` at :91)
- Modify: `CHANGELOG.md` (the `## 0.20.0 (2026-09-20)` list)
- Modify: `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md` (cause I paragraph; follow-up 7)
- Test: `tests/e2e/06-player-collab.spec.mjs:328` (existing, unchanged — it is the proof)

**Interfaces:**
- Consumes: `shouldCommitGmNotes(live, stored)` from `scripts/logic/gm-notes-commit.mjs` (Task 1); `MODULE_ID`, `I18N` already imported in the sheet from `../constants.mjs`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Confirm the failing state on Foundry 13 (the e2e test is the failing test)**

Preconditions: the Foundry 13 server is running on world-b (`curl -s http://localhost:30013/api/status` shows `"world":"world-b"`); if not, global setup starts it. Run:

```bash
FOUNDRY_TARGET=v13 npx playwright test tests/e2e/06-player-collab.spec.mjs -g "GM notes commit" --trace off --reporter=line
```

Expected: FAIL at `06-player-collab.spec.mjs:352` — `TimeoutError: page.waitForFunction: Timeout 10000ms exceeded` (the notes are never written; cause I).

- [ ] **Step 2: Add the import to the sheet**

In `scripts/sheets/SessionSheet.mjs`, after line 19 (`import { fieldsToStrip } from "../logic/session-submit.mjs";`) add:

```js
import { shouldCommitGmNotes } from "../logic/gm-notes-commit.mjs";
```

- [ ] **Step 3: Replace `onEditGmNotes` and add `commitGmNotes`**

Replace this exact block (currently `scripts/sheets/SessionSheet.mjs:366-383`):

```js
  static onEditGmNotes(event, target) {
    const editing = $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).hasClass("editing");
    // Unlike the recap editor, gmNotes is not toggled (no collaborative
    // join to manage) - it activates at render time and just stays active,
    // so the pencil here is purely a CSS show/hide. That means the pencil is
    // ALSO this editor's only commit point: nothing else ever calls this
    // element's own save() for it (no toggle -> no open=false -> save()
    // chain the way the recap editor gets from onEditRecap below). Call it
    // explicitly, BEFORE removing .editing, while closing - core's save()
    // fires "change" (event.target = this element) only when the value
    // actually changed, which MEJ's submitOnChange turns into a submit the
    // stale-field guard already keeps (session-submit.mjs's activeFields).
    if (editing) {
      const editor = this.trueElement?.querySelector?.("prose-mirror[name='system.gmNotes']");
      editor?.save();
    }
    $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).toggleClass("editing", !editing);
  }
```

with:

```js
  static onEditGmNotes(event, target) {
    const editing = $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).hasClass("editing");
    // Unlike the recap editor, gmNotes is not toggled (no collaborative
    // join to manage) - it activates at render time and just stays active,
    // so the pencil here is purely a CSS show/hide. That means the pencil is
    // ALSO this editor's only commit point: nothing else ever saves it (no
    // toggle -> no open=false -> save() chain the way the recap editor gets
    // from onEditRecap above). Commit explicitly, BEFORE removing .editing,
    // while closing - see commitGmNotes below for why that goes through the
    // element's public `value` and not its save() (private on Foundry 13).
    if (editing) {
      const editor = this.trueElement?.querySelector?.("prose-mirror[name='system.gmNotes']");
      commitGmNotes(editor, this.document?.system?.gmNotes);
    }
    $(".editor-parent[data-editor-id='gmNotes']", this.trueElement).toggleClass("editing", !editing);
  }
```

Then add, at module scope directly ABOVE the `export class SessionSheet` line (a module-private function, not a static method):

```js
// Commit the GM-notes editor through the element's PUBLIC value property.
// `get value` is the live editor content while the editor is active (core's
// own _getValue, foundry.mjs 13.351:72762 / 14.368:97393) and the stored
// value otherwise; `set value` stores it and fires the bubbling "change"
// that MEJ's submit-on-change form turns into a submit with this element as
// event.target (AbstractFormInputElement 13.351:70329 / 14.368:41256), which
// SessionSheet._prepareSubmitData's stale-field guard keeps because the
// target names system.gmNotes. Those are the same two steps core's own
// save() performs for a non-toggled editor - but save() is private (#save)
// on Foundry 13, where calling it threw and the notes were never written
// (v13 sweep report, cause I). _refresh() after the set is a no-op while
// the editor is active. A throw here is a real defect, so it is logged and
// shown; the caller's .editing toggle runs regardless.
function commitGmNotes(editor, stored) {
  if (!editor) return;
  try {
    const live = editor.value;
    if (shouldCommitGmNotes(live, stored)) editor.value = live;
  } catch (err) {
    console.error(`${MODULE_ID} | GM notes could not be saved`, err);
    ui.notifications.error(game.i18n.localize(`${I18N}.session.gmNotesSaveFailed`));
  }
}
```

- [ ] **Step 4: Add the string**

In `lang/en.json`, inside the `"session": {` object, directly after the line `"editGmNotes": "Edit GM Notes",` add:

```json
      "gmNotesSaveFailed": "GM notes could not be saved. See the console for details.",
```

Run `node -e 'JSON.parse(require("fs").readFileSync("lang/en.json","utf8")); console.log("json ok")'` — expected `json ok`.

- [ ] **Step 5: Run the e2e proof on Foundry 13**

```bash
FOUNDRY_TARGET=v13 npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off --reporter=line
```

Expected: `:328` "GM notes commit on pencil close" PASSES; every other test passes, except that `:231` "two owners edit at once" may fail at most once (known teardown residual — if it fails, rerun the file once and it must pass). Any other failure is a regression: stop and report.

- [ ] **Step 6: Run the e2e proof on Foundry 14 (api mode)**

Preconditions: the Foundry 14 server is running on world-a (`curl -s http://localhost:30000/api/status` shows `"world":"world-a"`, `"version":"14.368"`) with the fork-line MEJ (module worktree at `9569984`). Run:

```bash
npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off --reporter=line
```

Expected: all 8 tests pass (baseline: this file was green in the 0.20.0 api-mode gate).

- [ ] **Step 7: Unit suite and links**

```bash
npm test
npm run check:links
```

Expected: all vitest files pass (890+ tests incl. Task 1's 4); `guide links OK`.

- [ ] **Step 8: Changelog and sweep report**

In `CHANGELOG.md`, in the `## 0.20.0 (2026-09-20)` list, directly after the line beginning `- **Fixed:** Sessions opened from the sidebar on Foundry 13` add:

```markdown
- **Fixed:** GM notes typed on Foundry 13 were never saved (the pencil's commit used an editor method that is private there); the commit now goes through the editor's public value on both Foundry 13 and 14.
```

In `docs/superpowers/triage/2026-09-19-v13-companion-sweep.md`:

(a) Replace the cause I heading line

```
**I. `HTMLProseMirrorElement#save()` does not exist on Foundry 13 (1 test) — `platform`.**
```

with

```
**I. `HTMLProseMirrorElement#save()` does not exist on Foundry 13 (1 test) — `companion`, fixed 2026-09-20.**
```

and append to the end of that paragraph (after `Follow-up 7.`):

```
Fixed on `feat/native-shell-shim` (spec
`docs/superpowers/specs/2026-09-20-gm-notes-commit-design.md`): the commit
now reads and re-assigns the element's public `value`, which stores the live
content and fires the same `change` core's private save fires. `:328` passes
on Foundry 13 and 14.
```

(b) Replace the follow-up 7 opening line

```
7. **`SessionSheet.onEditGmNotes` has no commit path on Foundry 13.**
```

with

```
7. **`SessionSheet.onEditGmNotes` has no commit path on Foundry 13 — closed
   2026-09-20** (cause I above; commit through the editor's public `value`).
```

- [ ] **Step 9: Commit**

```bash
git add scripts/sheets/SessionSheet.mjs lang/en.json CHANGELOG.md docs/superpowers/triage/2026-09-19-v13-companion-sweep.md
git commit -m "fix(session): GM notes commit through the editor's public value, so Foundry 13 saves them

HTMLProseMirrorElement#save() is private on Foundry 13.351, so the pencil's
editor?.save() threw and system.gmNotes was never written (v13 sweep cause
I). AbstractFormInputElement's public value setter performs the same two
steps core's save does for a non-toggled editor - store the live content
and fire the bubbling change MEJ's submit-on-change form turns into the
write - on both 13 and 14, so the commit now goes through it, guarded by
the pure shouldCommitGmNotes. 06-player-collab:328 passes on Foundry 13
(native, stock 13.06) and Foundry 14 (api, fork line)."
```
