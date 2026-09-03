# Task 7 diagnosis — v13 stock smoke: "opening the session from the sidebar renders it without errors"

**Date:** 2026-09-02
**Env:** Foundry 13.351 (`~/FoundryVTT/FoundryVTT-Node-13.351`), world-b, port 30013;
stock MEJ 13.06; companion 0.15.0 from the `feat/v13-compat` worktree at HEAD `b824ca7`.
**Probes:** throwaway Playwright scripts (A–F) whose JSON outputs are quoted
below; the scripts lived in the git-ignored SDD workspace and are not preserved.

---

## Verdict, up front

**The test is wrong, and the product fix is correct and load-bearing.**

`row.evaluate((el) => el.click())` on `#journal .directory-item` is a **no-op on Foundry
v13** (and on v14 — the template is byte-identical). The `<li class="directory-item">`
carries no `data-action`, so ApplicationV2's delegated click handler finds no action to
dispatch and nothing happens at all: MEJ's `_onClickEntry` wrapper never runs, the shell
never opens, no sheet renders, and — because nothing ran — no console error is produced.
That is precisely the observed "`toBeAttached` times out with zero console errors",
identically with and without commit `4d53533`. The vacuity run was vacuous in the
stronger sense: it never reached the code under test either.

Retargeting the click to the `<a class="entry-name" data-action="activateEntry">` makes
the test both **pass at HEAD** and **fail (with the exact upstream crash) when the fix is
removed** — verified live, both directions.

---

## 1. Why `li.click()` does nothing on v13

### Core: the action lives on the anchor, not the row

`~/FoundryVTT/FoundryVTT-Node-13.351/templates/sidebar/partials/document-partial.hbs`
(entire file):

```hbs
<li class="directory-item entry document {{ @root.documentCls }} flexrow" data-entry-id="{{ id }}">
    {{#if thumbnail}}
    <img class="thumbnail" src="{{ thumbnail }}" alt="{{ name }}" loading="lazy">
    {{/if}}
    <a class="entry-name ellipsis" data-action="activateEntry">{{ name }}</a>
</li>
```

`~/FoundryVTT/FoundryVTT-Node-13.351/client/applications/sidebar/document-directory.mjs:55-64`:

```js
    actions: {
      activateEntry: DocumentDirectory.#onClickEntry,
      ...
```

`~/FoundryVTT/FoundryVTT-Node-13.351/client/applications/api/application.mjs:1394-1399`:

```js
  async #onClick(event) {
    const target = event.target;
    const actionButton = target.closest("[data-action]");
    if ( actionButton ) return this.#onClickAction(event, actionButton);
    this.toggleControls(false);
  }
```

`event.target.closest("[data-action]")` walks **up**, never down. Clicking the `<li>`
therefore resolves to `null` (the sidebar's ancestors carry no `data-action`), the
handler is skipped, and `toggleControls(false)` is the only thing that happens.

### Live confirmation — Probe A (`diag-probe-out.json`)

```json
{
  "probe": "A: li.directory-item .click()",
  "info": {
    "rowFound": true,
    "rowTag": "LI",
    "rowClass": "directory-item entry document journalentry flexrow",
    "rowDataset": { "entryId": "nfF30ZbmESkT2KsS" },
    "rowHasDataAction": false,
    "closestDataActionFromRow": null,
    "innerHTML": "<a class=\"entry-name ellipsis\" data-action=\"activateEntry\"><i class=\"fas fa-fw fa-book journal-type\"></i>TT-DIAG Session</a><div class=\"permissions\"></div>"
  },
  "observe": {
    "shellRendered": false,
    "subsheetCtor": null,
    "sessionContainerAnywhere": false,
    "standaloneAppExists": false,
    "instances": [ "...", "settings" ]      // ← no "MonksEnhancedJournal" entry at all
  },
  "errors": []
}
```

`game.MonksEnhancedJournal.journal` was never even constructed (absent from
`foundry.applications.instances`). Zero errors, zero DOM. Symptom matched exactly.

### Same on v14

`~/FoundryVTT-14/FoundryVTT-Node-14.365/templates/sidebar/partials/document-partial.hbs`
is identical to the v13 file above, so this test step would fail the same way in the v14
stock phase. It is not a v13 regression; the step has never been able to work.

---

## 2. The correct click target works, and the fix is doing real work

### Probe B — click `a.entry-name`

```json
{
  "probe": "B: a.entry-name .click()",
  "info": { "anchorFound": true, "anchorAction": "activateEntry" },
  "observe": {
    "shellRendered": true,
    "shellDocClass": "JournalEntry",
    "subsheetCtor": "JournalEntrySheet",
    "sessionContainerInShell": true,
    "standalone": true,
    "shellHTMLLen": 65286,
    "pageViewOutline": ["HEADER.journal-header", "DIV.journal-entry-pages scrollable editable"]
  },
  "errors": []
}
```

(`standalone: true` is not a second mount: the transplanted element keeps its
`SessionSheet-…` id, so `[id^="SessionSheet-"] .session-container` matches the copy that
now lives inside the shell.)

Probes C (`openJournalEntry(entry)`) and D (`openJournalEntry(page)`) produce the same
state and return `true`. So the sidebar path, the entry API and the page API all converge
on the same successful mount at HEAD.

### `sheet.enhancedjournal` at render time — the question the brief asked

Instrumented wrapper around `SessionSheet.prototype.render` (Probe B-instrumented):

```json
{ "phase": "render-call",     "hasEnhancedJournal": false, "elementBefore": false, "isThenable": true },
{ "phase": "render-call",     "hasEnhancedJournal": false, "elementBefore": true,  "isThenable": true },
{ "phase": "render-resolved", "elementAfter": true, "elementId": "SessionSheet-…-view",
  "parentAfter": "undefined.",   "inDocument": false },
{ "phase": "render-resolved", "elementAfter": true, "elementId": "SessionSheet-…-view",
  "parentAfter": "ARTICLE.journal-entry-page mej-campaign-companion.session level1 page",
  "inDocument": false }
```

- **`enhancedjournal` is falsy** on both calls → `renderAwaitable()` takes the standalone
  branch (`base.render.call(...)`, i.e. `DocumentSheetV2`/`ApplicationV2.render`), which
  returns a genuine promise. That is why `isThenable: true` and why `sheet.element` is
  defined the moment the await resolves.
- After the first resolve the element exists but is unparented (`parentAfter
  "undefined."`); MEJ then `append`s it, and by the second pass its parent is MEJ's own
  `<article class="journal-entry-page mej-campaign-companion.session level1 page">`.
- `inDocument: false` at both sample points is an artefact of MEJ building its shell
  off-document; the final observation shows `sessionContainerInShell: true` and the
  article carrying 2 children.

MEJ does set `subsheet.enhancedjournal = this` (`apps/enhanced-journal.js:535`) — but only
for the **subsheet**, which here is MEJ's own `JournalEntrySheet`, not for the per-page
sheets it renders one level down. So the helper's `!this.enhancedjournal` guard picks the
right branch, as designed.

### Vacuity, done properly — Probe E (`diag-vacuity-out.json`)

Same correct click target, with `SessionSheet.prototype.render` monkey-patched back to
`EnhancedJournalSheet.prototype.render` (exactly 0.14.0's behaviour — no override):

```json
{ "step": "unfix", "patched": { "patchedOn": "SessionSheet", "delegateTo": "EnhancedJournalSheet" } }
{
  "probe": "E2 WITHOUT fix, .entry-name click",
  "errors": [
    "[error] monks-enhanced-journal |  TypeError: Cannot read properties of undefined (reading 'removeAttribute')
        at JournalEntrySheet._renderPageView (…/monks-enhanced-journal/sheets/JournalEntrySheet.js:609:23)
        at async JournalEntrySheet._renderPageViews (…/JournalEntrySheet.js:590:54)
        at async JournalEntrySheet.subRender (…/JournalEntrySheet.js:358:9)
        at async EnhancedJournal.renderSubSheet (…/apps/enhanced-journal.js:598:17)"
  ]
}
```

versus the control in the same session:

```json
{ "probe": "E1 WITH fix, .entry-name click", "errors": [] }
```

**The regression net is real.** The fix in `4d53533` prevents an error that genuinely
occurs on stock MEJ 13.06; the test simply never fired the gun.

Note that in E2 the page body was *eventually* populated (`kids: 2`): `_renderPageViews`
runs twice, and the second pass finds `sheet.element` already assigned by the first
(aborted) render and appends it. So on 13.06 the un-fixed symptom is **a console error
plus a transiently empty page body**, not a permanently empty one — which is why
`expect(errors).toEqual([])` (and not the `.session-container` assertion) is the part of
the test that carries the regression value.

### The upstream defect, for the record

`~/FoundryVTT/Data/Data/modules/monks-enhanced-journal/sheets/JournalEntrySheet.js:607-611`:

```js
    async _renderPageView(element, sheet) {
        await sheet.render({ force: true });
        sheet.element.removeAttribute("class");     // ← line 609, no `if (!sheet.element) return`
        element.append(sheet.element);
    }
```

`awaitable-render.mjs`'s comment describes this accurately; 13.06 indeed lacks the guard
that later MEJ builds have.

---

## 3. How MEJ 13.06 routes an unknown page type

Walking the actual source:

1. **Sidebar click** — `monks-enhanced-journal.js:355-391` patches
   `foundry.applications.sidebar.tabs.JournalDirectory.prototype._onClickEntry` (MIXED)
   with `clickDocumentName`, which resolves the entry as:

   ```js
   const element = event.target;
   const documentId = element.parentElement.dataset.entryId;
   const entry = this.collection.get(documentId);
   ```

   i.e. it assumes `event.target` is the `<a class="entry-name">` whose parent `<li>`
   carries `data-entry-id`. (Core itself uses the robust
   `target.closest("[data-entry-id]")` — `document-directory.mjs:509`.)

2. **`fixType(entry)`** (`monks-enhanced-journal.js:362`) — the entry is a `JournalEntry`,
   not a `JournalEntryPage`, so the first branch is skipped and the second only fires for
   `blank`/`folder`. No-op here.

3. **`openJournalEntry(entry, …)`** (`monks-enhanced-journal.js:2310-2400`) — no early
   bail-out applies (no `pdfoundry` flag, no shim sheet name, GM user), so it reaches
   line 2392-2394 and calls `MonksEnhancedJournal.journal.open(doc, newtab, options)`.

4. **`EnhancedJournal.renderSubSheet`** (`apps/enhanced-journal.js:409-…`):
   - **line 430-441** — the single-page demotion to a typed MEJ subsheet requires
     `flags["monks-enhanced-journal"].type` to be a key of `getDocumentTypes()`
     (`list`, `encounter`, `event`, `organization`, `person`, `picture`, `place`, `poi`,
     `quest`, `shop`, `loot`, `slideshow`, `journalentry`). A companion Session page has
     **no MEJ flag at all** (Probe A fixture: `"mejFlag": null`) and its native type is
     `mej-campaign-companion.session`, which is not in that map. **No demotion.**
   - **line 443-444** — `fixType(this.document)` again a no-op for a `JournalEntry`.
     (Had the page carried a stale MEJ flag, `fixType`'s `else if (game.user.isGM)
     object.unsetFlag("monks-enhanced-journal", "type")` would strip it — which is what
     the existing "mej-flag-after-create" annotation observes. Irrelevant here: the flag
     is already absent.)
   - **line 486** — `const cls = this.document instanceof JournalEntry ? JournalEntrySheet : …`
     → the shell subsheet is MEJ's own `JournalEntrySheet`.
5. **`JournalEntrySheet.subRender` → `_renderPageViews`** (`:578-605`), which for each
   page calls `getPageSheet(id)` (the companion's `SessionSheet`, since
   `page._getSheetClass()` resolves to it) and, because it is a V2 sheet, hits
   `_renderPageView` (`:607-611`) — the awaiting transplant above.

So: **shell page view, never a standalone sheet, never demoted, `fixType` does not
touch it.** Confirmed live by `subsheetCtor: "JournalEntrySheet"` and
`pageViewOutline: ["HEADER.journal-header", "DIV.journal-entry-pages scrollable editable"]`
in Probes B/C/D.

---

## 4. Root cause and the fix

### Root cause

The spec's assertion never executed the behaviour it guards. On Foundry 13 (and 14) the
sidebar's `[data-action="activateEntry"]` sits on the `<a class="entry-name">` inside the
row, not on `<li class="directory-item">`; ApplicationV2 dispatches actions by walking
**up** from `event.target`, so `row.evaluate((el) => el.click())` dispatches no action,
MEJ's `_onClickEntry` wrapper never runs, and nothing renders — hence `.session-container`
never attaches and no console error is logged, identically with and without `4d53533`.

### The fix belongs in the **test only**

`tests/e2e/13-stock-smoke.spec.mjs`, test *"opening the session from the sidebar renders
it without errors"* (~line 274-278). Replace the row click with a click on the row's
action anchor, keeping the in-page dispatch (the row can sit outside the headless
viewport, which was the original reason for `evaluate`):

```diff
     const row = page.locator("#journal .directory-item", { hasText: FIXTURE }).first();
     await expect(row).toHaveCount(1);
-    await row.evaluate((el) => el.click());
+    // v13/v14 core puts data-action="activateEntry" on the row's <a class="entry-name">,
+    // not on the <li> — and ApplicationV2 dispatches actions by walking UP from
+    // event.target, so clicking the <li> is a silent no-op. Clicking the anchor itself
+    // (not a descendant) also keeps MEJ's _onClickEntry wrapper happy: it reads
+    // event.target.parentElement.dataset.entryId (monks-enhanced-journal.js:358-360).
+    await row.evaluate((el) => el.querySelector("a.entry-name").click());
```

Nothing else in the test needs to change. `.session-container` is the right marker, the
15 s budget is ample (the open completes well inside 4 s in every probe), and
`expect(errors).toEqual([])` is what actually catches the regression.

**Product code (`scripts/sheets/awaitable-render.mjs`, `SessionSheet.mjs`,
`CampaignHubPage`) needs no change.** Probe E proves the override is required on stock
MEJ 13.06 and sufficient to silence the crash.

### Two observations, neither in scope

1. **MEJ's own sidebar wrapper is fragile.** `monks-enhanced-journal.js:358-360` uses
   `event.target.parentElement.dataset.entryId`. MEJ injects an
   `<i class="fas fa-fw fa-book journal-type">` *inside* the anchor, so a real user who
   clicks the icon makes `event.target` the `<i>`, whose parent is the `<a>` (no
   `data-entry-id`) → `entry === undefined` → `openJournalEntry(undefined)` opens an
   **empty blank tab**. Probe F (`diag-icon-out.json`):

   ```json
   { "iconParentTag": "A", "iconParentEntryId": null }
   { "shellRendered": true, "shellDocName": null, "shellDocType": "blank",
     "subsheetCtor": "BlankSheet", "sessionContainerAnywhere": false, "errors": [] }
   ```

   This is an upstream MEJ bug affecting **every** journal entry regardless of type
   (MEJ's own `person`/`quest`/etc. included), not companion-specific. Per project rules,
   the companion never patches MEJ; worth an upstream note, not a companion change.
   Playwright's own `.click()` on the anchor locator targets the anchor's centre, which
   is the text, so the corrected test step is unaffected either way — but do click the
   anchor itself (`el.querySelector("a.entry-name").click()`), not a descendant.

2. **The test's `where.standalone` flag is a false positive**, not a bug: after MEJ's
   transplant the SessionSheet element retains its `SessionSheet-…` id inside the shell,
   so `[id^="SessionSheet-"] .session-container` matches even for a shell mount. The
   assertion `expect(where.inShell || where.standalone).toBe(true)` still holds; only the
   recorded annotation is ambiguous. If precision matters, compute `standalone` as
   `!where.inShell && !!document.querySelector('[id^="SessionSheet-"] .session-container')`.

### Confidence

**High.** Three independent lines of evidence agree: core source shows the action is on
the anchor and dispatch walks upward; Probe A shows the `<li>` has no `data-action`, no
`[data-action]` ancestor, and produces zero application state; Probe E reproduces the
crash the test was written to catch *and* shows HEAD silencing it, both through the
corrected target in a single session.

---

## Cleanup performed

- Fixtures deleted by id: `LzhGKEdEyA9uB2eX`, `nfF30ZbmESkT2KsS` (TT-DIAG Session),
  `mnm93L7uBwP7Fdq6` (TT-DIAGVAC Session), `9OStvmWorg5KojOD` (TT-DIAGICON Session).
  Post-run sweep of `game.journal` for `TT-DIAG*` returned empty.
- No world settings were mutated (companion already enabled, `forceNativeMode` already
  `false`).
- v13 server on port 30013 stopped.
- `~/FoundryVTT/Data/Data/modules/mej-campaign-companion` restored to
  `/Users/danbularzik/Claude/Projects/mej-campaign-companion` (rm + ln -s).
- Worktree `git status --porcelain` empty (probe scripts live in git-ignored
  `.superpowers/`).
