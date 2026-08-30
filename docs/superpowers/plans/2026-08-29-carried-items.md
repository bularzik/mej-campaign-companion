# Carried Items (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ten product defects and three harness/provenance items that the
0.13.5 bugfix sweep carried forward — timeline-control layout, the GM's invisible
"Player Recaps" list, the zero-height enriched-preview wrapper that intercepts clicks,
prep-board attendee names, enricher markup leaking into search snippets, the Knowledge
panel on the campaign portal, dead zero-campaign controls and "1 sections", core's Hide
toggle reaching players, MEJ's raw page schema in the Session header, an unreachable
bad-query branch, an unpinned `mammoth` version, a name-keyed timeline cleanup, and ten
bare `game.ready` waits — and ship them as 0.13.6.

**Architecture:** Companion-side only. Product fixes land in four places: pure logic
modules under `scripts/logic/` (unit-testable, no Foundry globals), Handlebars templates
under `templates/`, render hooks under `scripts/hooks/`, and one stylesheet
(`styles/campaign-companion.css`) whose rules are always scoped to markup the companion
itself emits or injects. Harness work lands in `tests/e2e/helpers/foundry.mjs` plus its
callers. No file outside this repository is edited, and no MEJ behaviour is patched — the
three MEJ-side symptoms (L2, L3, S2) are fixed by giving MEJ's shared CSS and its shared
header partial the context they already expect from every MEJ-native sheet.

**Tech Stack:** Foundry VTT v14 (ApplicationV2 / Handlebars), ES modules, vitest for
unit tests (`npm test`), Playwright for e2e against the live World A
(`npx playwright test`), `node tests/vendor/check-vendor.mjs` for vendor integrity.

**Spec:** docs/superpowers/specs/2026-08-29-carried-items-design.md
(evidence appendix: docs/superpowers/specs/2026-08-29-carried-items-investigation.md)

---

## Global Constraints

From the spec's "Global constraints", verbatim:

- Companion features never patch MEJ; no edits outside this repo.
- World A is the user's real world: harness cleanup is id/flag-tracked only.
- Test fixes wait on real conditions — no `retries`, no `waitForTimeout`.
- Every product fix ships with a regression test and a **vacuity check** (disable the fix
  by hand-edit, watch the test fail, restore).
- Regression gate: a full 18-spec e2e run diffed against `main`'s baseline, not a green
  targeted suite (Round 4 lesson).
- `mammoth` is **not upgraded** in this round; it parses untrusted input and a version
  bump is its own decision.

Plus, for this plan:

- **Unit suite floor.** `npm test` reports **679 passed / 56 files** on the base commit
  (`main` @ 59c5e0b, verified). It must never drop below 679 at any commit in this branch.
- **No `scripts/` edit without a regression test and a vacuity check.** Every task that
  touches `scripts/`, `templates/`, `lang/` or `styles/` writes its failing test first and
  hand-disables the fix afterwards to watch that test go red, then restores.
- **Environment lock.** `tests/e2e/helpers/env-lock.mjs` guards the shared Foundry data
  dir (`/Users/danbularzik/FoundryVTT-14/Data/.claude-e2e-lock`). Playwright's global setup
  acquires it. If it is **held by a live foreign pid**, WAIT and retry — do **not** run
  `npm run e2e:unlock`, and do not delete the lock directory by hand. A dead or
  self-owned holder is stolen automatically; that is fine.
- **Temp files** (probe scripts, run logs, screenshot diffs) go in
  `/Users/danbularzik/.claude/jobs/4378f1d9/tmp/` — never in the repo.
- **Working directory.** Every command below runs from the worktree root
  `/Users/danbularzik/Claude/Projects/mej-campaign-companion/.claude/worktrees/carried-items`
  (branch `fix/carried-items`, base `main` @ 59c5e0b = 0.13.5). Paths are relative to it.
- **Do not commit anything under `docs/superpowers/`** beyond what already exists; the
  spec and this plan are already on the branch.

---

## Task 1 — Group Q: strict `parseQuery` (Q1)

Spec item Q1 (inv. §8). `parseQuery` is a total parser, so `#promptDashboard`'s
`badQuery` branch can never fire and `attr:=:=broken` silently yields an
always-empty dashboard.

**Files:**
- Modify `scripts/logic/query-grammar.mjs` — the token loop, lines 19-35 (currently
  `for (const token of …)` through the `attrs.push` ternary).
- Modify `scripts/apps/CampaignHubPage.mjs` — the C16 doc comment at lines 804-807; the
  `catch` at 821-823 (`#promptDashboard`); the `catch` at 817-819 of `#dashboardsContext`
  (line 817 `} catch (err) {`, line 818 `return { ...q, error: game.i18n.localize(...) }`).
- Modify `lang/en.json` line 216 — the value of `MEJCampaignCompanion.hub.dashboards.badQuery`.
- Test: `test/query-grammar.test.js` (exists; already covers `parseQuery`, `matchesMeta`,
  `runQuery`).

**Interfaces:**
- Consumes: `parseQuery(str)` callers — `CampaignHubPage.#promptDashboard`,
  `runQuery(index, queryString, {gm})` in the same module, and `runQueryAll(queryString)`
  in `scripts/search/live-index.mjs` (used by `CampaignHubPage.#dashboardsContext` and by
  `scripts/hooks/query-enricher.mjs`, both of which already wrap the call in `try/catch` —
  verified by reading both).
- Produces: `parseQuery` now throws `Error("bad-type")` and `Error("bad-attr")` in
  addition to the existing `Error("empty-query")`; the returned shape
  `{ types, tags, attrs, text }` is unchanged.
- Produces: `MEJCampaignCompanion.hub.dashboards.badQuery` gains a `{reason}` token and is
  consumed with `game.i18n.format` (not `localize`) at both of its two call sites.

**Spec deviation to record in the commit message and flag at review:** the spec names three
error reasons (`bad-attr`, `bad-type`, `bad-tag`). `bad-tag` is **not** implemented. The
token regex is `/^(type|tag|attr):(.+)$/i`, so `tag:` with no value never matches and falls
through to free text (exactly as the spec's own probe table says it should); a tag value is
free-form user text, so every non-empty value is meaningful. A `bad-tag` throw would
therefore be unreachable — recreating precisely the dead branch this task exists to remove.

- [ ] 1. Write the failing tests. Append to `test/query-grammar.test.js` inside the
  existing `describe("parseQuery", …)` block (after the `throws on empty/whitespace
  queries` case at line 14-16):

```js
  // C16 probes (spec Q1): the four inputs the round-5 audit typed into the
  // dashboard dialog. Only the one that cannot mean anything is rejected.
  it("rejects an attr token with an empty key", () => {
    expect(() => parseQuery("attr:=:=broken")).toThrow("bad-attr");
  });
  it("rejects a type token that cannot name a registry key", () => {
    expect(() => parseQuery("type:=broken")).toThrow("bad-type");
  });
  it("keeps attr:, ((, and an unclosed quote as free text", () => {
    expect(parseQuery("attr:")).toEqual({ types: [], tags: [], attrs: [], text: "attr:" });
    expect(parseQuery("((")).toEqual({ types: [], tags: [], attrs: [], text: "((" });
    expect(parseQuery("\"unclosed")).toEqual({ types: [], tags: [], attrs: [], text: "\"unclosed" });
  });
  it("still accepts every dotted/dashed type key and a valueless attr", () => {
    expect(parseQuery("type:mej-campaign-companion.session attr:patron")).toEqual({
      types: ["mej-campaign-companion.session"], tags: [], attrs: [{ key: "patron", value: null }], text: ""
    });
  });
```

- [ ] 2. Run it and watch it fail:
  `npx vitest run test/query-grammar.test.js`
  Expected: 3 failing cases, the first reading
  `AssertionError: expected [Function] to throw an error` (the `bad-attr` case);
  the `attr:`/`((`/`"unclosed` case and the dotted-key case pass already.

- [ ] 3. Implement. Replace the token loop in `scripts/logic/query-grammar.mjs`
  (lines 19-35) with:

```js
  for (const token of String(str ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(type|tag|attr):(.+)$/i.exec(token);
    if (!m) {
      free.push(token);
      continue;
    }
    const prefix = m[1].toLowerCase();
    const rest = m[2];
    if (prefix === "type") {
      // A type key is a merged-registry key: word chars, dot or dash. Anything
      // else can name no type at all, and used to parse into a types[] entry
      // that matches every record's `type` never - an always-empty dashboard
      // with no feedback anywhere (C16).
      if (!/^[\w.-]+$/.test(rest)) throw new Error("bad-type");
      parsed.types.push(rest.toLowerCase());
    } else if (prefix === "tag") {
      // No validation: a tag is free-form user text, so every non-empty value
      // is meaningful, and `tag:` with no value never reaches here (the regex
      // above needs at least one character) - it is free text, by contract.
      parsed.tags.push(rest);
    } else {
      const eq = rest.indexOf("=");
      const key = eq === -1 ? rest : rest.slice(0, eq);
      // `attr:=:=broken` produced key "" here; matchesMeta then looked for an
      // attribute whose key lowercases to "", which cannot exist, so the query
      // returned zero rows forever with no way to tell it apart from a real
      // empty result.
      if (!key.trim()) throw new Error("bad-attr");
      parsed.attrs.push(eq === -1
        ? { key: rest, value: null }
        : { key, value: rest.slice(eq + 1) });
    }
  }
```

  Then make the error reason visible. In `lang/en.json` line 216, replace
  `"badQuery": "That query can't be parsed.",` with
  `"badQuery": "That query can't be parsed ({reason}).",`.

  In `scripts/apps/CampaignHubPage.mjs`, replace the `#dashboardsContext` catch body
  (line 818) with:

```js
        return { ...q, error: game.i18n.format(`${I18N}.hub.dashboards.badQuery`, { reason: err.message }), results: [] };
```

  and `#promptDashboard`'s catch (lines 821-823) with:

```js
      } catch (err) {
        ui.notifications.warn(game.i18n.format(`${I18N}.hub.dashboards.badQuery`, { reason: err.message }));
        continue;
      }
```

  Finally replace the stale C16 note at `CampaignHubPage.mjs:804-807` with:

```js
   * C16 (fixed 0.13.6): parseQuery is strict now - `attr:` with an empty key
   * and a `type:` value that cannot name a registry key throw `bad-attr` /
   * `bad-type` - so this branch is live and the warning below really appears.
   * Everything else the grammar does not recognize is still free text.
```

- [ ] 4. Run the tests: `npm test` — expected `Tests 683 passed (683)`,
  `Test Files 56 passed (56)`; no other file changes count.

- [ ] 5. Vacuity check. Hand-edit `scripts/logic/query-grammar.mjs` and comment out the
  `if (!key.trim()) throw new Error("bad-attr");` line. Run
  `npx vitest run test/query-grammar.test.js` — expected: the
  `rejects an attr token with an empty key` case fails with
  `expected [Function] to throw an error`. Restore the line and re-run the same command
  (all green) before committing.

- [ ] 6. Commit:

```sh
git add scripts/logic/query-grammar.mjs scripts/apps/CampaignHubPage.mjs lang/en.json test/query-grammar.test.js
git commit -m "Reject unmeanable query tokens instead of returning silently-empty results

parseQuery was total: every token either matched the type/tag/attr prefix or
became free text, so the only throw was on whitespace-only input, which the
dashboard dialog had already rejected. 'attr:=:=broken' parsed to an attribute
key of \"\", which no record can carry, so the dashboard rendered empty forever
with no signal. Reject an empty attr key and a type value that cannot name a
registry key; carry the reason into the warning. Everything else stays free text."
```

---

## Task 2a — Group T (logic): search snippets and zero-campaign honesty (T2, T4)

Spec items T2 (inv. §4) and T4 (inv. §7a + §7b).

**Files:**
- Modify `scripts/logic/search-index.mjs` — new `stripEnrichers` export beside `stripHtml`
  (lines 1-4); apply it at line 40 (`const text = stripHtml(raw)…`).
- Modify `scripts/logic/doc-import.mjs` — new pure `sessionsDetectedHint(count)` export
  (append after `buildImportPlan`, which ends the file).
- Modify `scripts/apps/import-wizard.mjs` line 144 (`context.sessionsDetected = …`) and its
  import list at lines 20 (`import { splitSections, suggestType, buildImportPlan, mergeSections, splitSectionAt } from "../logic/doc-import.mjs";`).
- Modify `templates/import-wizard.hbs` lines 39-41 (the `sessionsDetected` hint).
- Modify `scripts/apps/CampaignHubPage.mjs` line 344 (`context.header = …`) and
  `promptCampaignChoice`'s zero-campaign short-circuit at lines 1298-1300.
- Modify `templates/hub.hbs` lines 59-61 (`button.mej-cc-file-all`) and lines 79-82
  (`button.mej-cc-row-file`).
- Modify `templates/hub-header.hbs` line 28 (`data-action="setCaptureCampaign"`).
- Modify `lang/en.json` — add `hub.noCampaignsYet` after line 118 (`"fileAllShown"`), add
  `import.sessionsDetectedOne` after line 289 (`"sessionsDetected"`).
- Test: `test/search-index.test.js` (exists), `test/doc-import.test.js` (exists),
  `tests/e2e/14-campaigns.spec.mjs` (new test in the existing zero-campaign
  `test.describe.serial("14 campaigns - adoption (isolated, non-destructive)")` block at
  line 67).

**Interfaces:**
- Produces: `stripEnrichers(text)` exported from `scripts/logic/search-index.mjs`;
  consumed by `indexRecord` only.
- Produces: `sessionsDetectedHint(count)` exported from `scripts/logic/doc-import.mjs`,
  returning `{ sessionsDetected: number, sessionsDetectedOne: boolean }`; consumed by
  `ImportWizard._prepareContext`.
- Produces: template context key `hasCampaigns` (boolean) on the Hub's body context,
  read by `templates/hub.hbs` (`{{#unless hasCampaigns}}`, `{{#if @root.hasCampaigns}}`)
  and by `templates/hub-header.hbs` (same partial context — `hub.hbs:4` includes it).
  Its value comes from `#campaignScopeContext()`'s existing `hasCampaigns` field
  (`CampaignHubPage.mjs:505`, verified).
- Produces: i18n keys `MEJCampaignCompanion.hub.noCampaignsYet` and
  `MEJCampaignCompanion.import.sessionsDetectedOne`.
- Consumes: `promptCampaignChoice`'s three callers — `onFileIntoCampaign` (line 1243),
  `onFileAllShown` (line 1269), `onSetCaptureCampaign` (line 1076) — all unchanged; they
  keep treating `null` as "stop", and now the user has been told why.

- [ ] 1. Write the failing unit tests.

  In `test/search-index.test.js`, add `stripEnrichers` to the import list at lines 2-4 and
  append a new describe after the `tokenize / stripHtml` block (line 24-29):

```js
describe("stripEnrichers", () => {
  it("keeps the label of a labelled content link and drops the ref", () => {
    expect(stripEnrichers("met @UUID[JournalEntry.abc123]{Mira Thornwood} at the docks"))
      .toBe("met Mira Thornwood at the docks");
  });
  it("falls back to the last id segment of a bare link", () => {
    expect(stripEnrichers("see @UUID[JournalEntry.abc123]")).toBe("see abc123");
  });
  it("leaves text without enrichers untouched", () => {
    expect(stripEnrichers("a plain sentence with an @ sign")).toBe("a plain sentence with an @ sign");
  });
  it("is applied to indexed fields: the label is searchable, the id is not", () => {
    const idx = createIndex();
    indexRecord(idx, {
      uuid: "u9", name: "Docks", type: "campaign-record.place", tags: [],
      fields: { description: "met @UUID[JournalEntry.abc123]{Mira Thornwood} at the docks" },
      gmFields: {}, meta: { tags: [], attrs: [] }
    });
    const hit = search(idx, "mira", { gm: false })[0];
    expect(hit.uuid).toBe("u9");
    expect(hit.matches[0].snippet).toContain("Mira Thornwood");
    expect(hit.matches[0].snippet).not.toContain("@UUID");
    expect(search(idx, "abc123", { gm: false })).toHaveLength(0);
  });
});
```

  In `test/doc-import.test.js`, add `sessionsDetectedHint` to the import at line 8 and
  append:

```js
describe("sessionsDetectedHint", () => {
  it("selects the singular string for exactly one detected session", () => {
    expect(sessionsDetectedHint(1)).toEqual({ sessionsDetected: 1, sessionsDetectedOne: true });
  });
  it("selects the plural string for zero and for many", () => {
    expect(sessionsDetectedHint(0)).toEqual({ sessionsDetected: 0, sessionsDetectedOne: false });
    expect(sessionsDetectedHint(4)).toEqual({ sessionsDetected: 4, sessionsDetectedOne: false });
  });
});
```

- [ ] 2. Run them and watch them fail:
  `npx vitest run test/search-index.test.js test/doc-import.test.js`
  Expected: both files fail at collection with
  `SyntaxError: The requested module '../scripts/logic/search-index.mjs' does not provide an export named 'stripEnrichers'`
  and the same for `sessionsDetectedHint`.

- [ ] 3. Implement.

  `scripts/logic/search-index.mjs` — insert after `stripHtml` (line 4):

```js
/**
 * Foundry's enricher syntax is PLAIN TEXT in a stored body: a content link is
 * `@UUID[JournalEntry.abc]{Label}` until TextEditor.enrichHTML turns it into an
 * <a> at render time. The index deliberately stores the raw body (so indexing
 * never has to run async enrichment), and stripHtml's tag regex cannot see it -
 * so the ref leaked into snippets and its document id became a search token.
 */
export function stripEnrichers(text) {
  return String(text ?? "")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")                     // @UUID[ref]{Label} -> Label
    .replace(/@\w+\[([^\]]*)\]/g, (_, ref) => ref.split(".").pop()); // @UUID[ref] -> tail
}
```

  and change line 40 to:

```js
    const text = stripHtml(stripEnrichers(raw)).replace(/\s+/g, " ").trim();
```

  `scripts/logic/doc-import.mjs` — append at the end of the file:

```js
/**
 * Foundry's i18n does plain {token} substitution with no plural selection, so a
 * single detected section rendered "1 sections detected as sessions". Pick the
 * string in the context instead of in the template's format call.
 */
export function sessionsDetectedHint(count) {
  return { sessionsDetected: count, sessionsDetectedOne: count === 1 };
}
```

  `scripts/apps/import-wizard.mjs` — add `sessionsDetectedHint` to the `doc-import.mjs`
  import at line 20, and replace line 144 with:

```js
    Object.assign(context, sessionsDetectedHint(this.state.sections.filter((s) => s.isSession).length));
```

  `templates/import-wizard.hbs` — replace lines 39-41 with:

```hbs
    {{#if sessionsDetected}}
    <p class="hint mej-cc-import-sessions-detected">
      {{#if sessionsDetectedOne}}{{localize "MEJCampaignCompanion.import.sessionsDetectedOne"}}
      {{else}}{{localize "MEJCampaignCompanion.import.sessionsDetected" count=sessionsDetected}}{{/if}}
    </p>
    {{/if}}
```

  `lang/en.json` — after line 118 (`"fileAllShown": …`) add:

```json
      "noCampaignsYet": "No campaigns yet — create one from the campaign picker first.",
```

  and after line 289 (`"sessionsDetected": …`) add:

```json
      "sessionsDetectedOne": "1 section detected as a session — its type and timepoint are pre-set.",
```

  `scripts/apps/CampaignHubPage.mjs` — replace the zero-campaign short-circuit at
  lines 1299-1300 with:

```js
    const campaigns = getCampaigns();
    if (!campaigns.length) {
      // Two different outcomes used to share one silent `null`: "the GM
      // cancelled" and "there was no dialog to show". Every caller returns on
      // null, so filing/capture controls did nothing at all in a world with no
      // campaigns yet. Say so.
      ui.notifications.warn(game.i18n.localize(`${I18N}.hub.noCampaignsYet`));
      return null;
    }
```

  and, at line 344, carry the flag the scope context already computes:

```js
    context.header = { scopeOptions: scopeContext.options, isCampaignScope: scopeContext.isCampaignScope, toolsMenuOpen: this.state.toolsMenuOpen };
    context.hasCampaigns = scopeContext.hasCampaigns;
```

  `templates/hub.hbs` — replace lines 59-61 with:

```hbs
                            <button type="button" class="mej-cc-file-all" data-action="fileAllShown"
                                    {{#unless hasCampaigns}}disabled data-tooltip="{{localize 'MEJCampaignCompanion.hub.noCampaignsYet'}}"{{/unless}}>
                                <i class="fa-solid fa-folder-open"></i> {{localize "MEJCampaignCompanion.hub.fileAllShown"}}
                            </button>
```

  and lines 79-82 with:

```hbs
                                <button type="button" class="mej-cc-row-file" data-action="fileIntoCampaign"
                                        {{#if @root.hasCampaigns}}data-tooltip="{{localize 'MEJCampaignCompanion.hub.fileInto'}}"{{else}}disabled data-tooltip="{{localize 'MEJCampaignCompanion.hub.noCampaignsYet'}}"{{/if}}>
                                    <i class="fa-solid fa-folder-open"></i>
                                </button>
```

  `templates/hub-header.hbs` — replace line 28 with:

```hbs
            <button type="button" data-action="setCaptureCampaign"
                    {{#unless hasCampaigns}}disabled data-tooltip="{{localize 'MEJCampaignCompanion.hub.noCampaignsYet'}}"{{/unless}}><i class="fa-solid fa-crosshairs"></i> {{localize 'MEJCampaignCompanion.hub.captureTarget'}}</button>
```

- [ ] 4. Write the zero-campaign e2e. Read `tests/e2e/14-campaigns.spec.mjs` lines 67-120
  first (the adoption describe's opening, its `prior` snapshot and its console-error
  tracking) and match that style. Append this second test inside that same
  `test.describe.serial("14 campaigns - adoption (isolated, non-destructive)")` block,
  after the existing test's closing `});`:

```js
  // T4 (spec Group T): this describe is the suite's only zero-campaign window -
  // it runs before any campaign exists. The three GM controls that need a
  // campaign to do anything used to render enabled and do nothing at all when
  // clicked (promptCampaignChoice returned null for "no campaigns" exactly as
  // it does for "cancelled", and every caller returns silently on null).
  test("zero-campaign world: the filing and capture controls are disabled, and say why", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const campaignCount = await page.evaluate(async () => {
      const { getCampaigns } = await import("/modules/mej-campaign-companion/scripts/data/campaign-store.mjs");
      return getCampaigns().length;
    });
    expect(campaignCount, "this test only means anything in a zero-campaign world").toBe(0);
    const preexisting = await timelineJournalIds(page);

    const shell = await openHub(page);
    await scopeHub(shell, page, "unfiled");
    const hint = "No campaigns yet";

    const fileAll = shell.locator("button.mej-cc-file-all");
    await expect(fileAll).toBeDisabled();
    await expect(fileAll).toHaveAttribute("data-tooltip", new RegExp(hint));

    const rowFile = shell.locator("li.mej-cc-index-row button.mej-cc-row-file").first();
    await expect(rowFile).toBeDisabled();
    await expect(rowFile).toHaveAttribute("data-tooltip", new RegExp(hint));

    await shell.locator('button[data-action="toggleToolsMenu"]').click();
    await settle(page, 200);
    const capture = shell.locator('.mej-cc-tools-menu button[data-action="setCaptureCampaign"]');
    await expect(capture).toBeDisabled();
    await expect(capture).toHaveAttribute("data-tooltip", new RegExp(hint));

    await page.evaluate(() => game.MonksEnhancedJournal?.journal?.close?.());
    await settle(page, 300);
    await cleanupTimelineJournals(page, preexisting);
    await resetHubScope(page);
    assertNoConsoleErrors(errors);
  });
```

  Two dependencies this test names: `timelineJournalIds` / `cleanupTimelineJournals` do
  not exist yet (Task 6 adds them). Until Task 6 lands, use the current helper instead —
  replace the two lines with `const preexisting = await page.evaluate(() => game.journal.filter((e) => e.name === "Campaign Timeline").map((e) => e.id));`
  and `await cleanupTimelineJournal(page, { excludeIds: preexisting });`, and note in the
  Task 6 migration list that this call site migrates too. `resetHubScope(page)` must be
  the file's own scope reset: check `14-campaigns.spec.mjs` for its existing helper name
  (`grep -n "campaignScope\|HUB_CAMPAIGN_SCOPE\|resetScope" tests/e2e/14-campaigns.spec.mjs`)
  and use that; if the file has none, write
  `await page.evaluate(() => game.settings.set("mej-campaign-companion", "hubCampaignScope", ""));`
  after confirming the setting key with
  `grep -n "HUB_CAMPAIGN_SCOPE_SETTING =" scripts/constants.mjs`.

- [ ] 5. Run the tests:
  `npm test` — expected `Tests 689 passed (689)`.
  `npx playwright test tests/e2e/14-campaigns.spec.mjs tests/e2e/05-docx-import.spec.mjs --trace off --reporter=line`
  — expected all passing; the new zero-campaign test must appear in the list.

- [ ] 6. Vacuity check, twice:
  (a) revert `search-index.mjs:40` to `const text = stripHtml(raw)…`; run
  `npx vitest run test/search-index.test.js` — expected failure
  `expected '…@UUID[JournalEntry.abc123]{Mira …' not to contain '@UUID'`; restore.
  (b) delete the `{{#unless hasCampaigns}}disabled …{{/unless}}` clause from
  `templates/hub.hbs`'s `mej-cc-file-all` button; run
  `npx playwright test tests/e2e/14-campaigns.spec.mjs --trace off --reporter=line -g "zero-campaign world"`
  — expected failure `Expect "toBeDisabled" … Received: enabled`; restore and re-run green.

- [ ] 7. Commit:

```sh
git add scripts/logic/search-index.mjs scripts/logic/doc-import.mjs scripts/apps/import-wizard.mjs scripts/apps/CampaignHubPage.mjs templates/import-wizard.hbs templates/hub.hbs templates/hub-header.hbs lang/en.json test/search-index.test.js test/doc-import.test.js tests/e2e/14-campaigns.spec.mjs
git commit -m "Strip enricher markup before indexing, and stop drawing dead campaign controls

Three root causes. stripHtml only removes <tags>, but Foundry's @UUID[ref]{Label}
syntax is plain text in a stored body, so the ref survived into search snippets
and its document id became a search token. promptCampaignChoice returned the same
silent null for 'no campaigns exist' as for 'the GM cancelled', so three GM
controls rendered enabled and did nothing in a world with no campaigns yet.
And the import wizard's sessions hint had only a plural form, so one detected
section read '1 sections'."
```

---

## Task 2b — Group T (templates and hooks): prep-board names, portal panel (T1, T3)

Spec items T1 (inv. §2) and T3 (inv. §6).

**Files:**
- Modify `templates/prep-board.hbs` line 7 (the `{{#each attendees}}` `<li>`).
- Modify `styles/campaign-companion.css` — insert beside the existing
  `.mej-cc-prep-attendees img` rule at lines 972-976.
- Modify `scripts/hooks/knowledge-ui.mjs` — the import at line 11 and `mejPageOf` at
  lines 22-29.
- Test: `tests/e2e/10-secrets-hub.spec.mjs` (new test + an actor sweep in its existing
  `afterEach` at lines 27-37), `tests/e2e/15-campaign-portal.spec.mjs` (assertions added
  to test 1 at line 113 and test 7 at line 392).

**Interfaces:**
- Consumes: `prep-board-app.mjs:_prepareContext`'s attendee rows
  `{ uuid, name, img }` (lines 83-87) — unchanged; only the template reads more of it.
- Consumes: `CAMPAIGN_DOCUMENT_TYPE` (`"mej-campaign-companion.campaign"`), `CAMPAIGN_TYPE`
  (`"campaign"`) and `HUB_PAGE_ID` (`"campaign-hub"`) from `scripts/constants.mjs`
  (lines 24, 26, 28 — verified).
- Produces: CSS class `mej-cc-prep-attendee-name` (new, emitted only by
  `templates/prep-board.hbs`).
- Produces: `mejPageOf(sheet)` in `knowledge-ui.mjs` returns `null` for companion shell
  pages, so `injectPanel` never appends `.mej-cc-knowledge` to a portal or Hub body.

- [ ] 1. Write the failing e2e tests.

  Read `tests/e2e/10-secrets-hub.spec.mjs` lines 1-40 first. Add `deleteActorsByPrefix` to
  its import at lines 2-5, extend the `afterEach` body (after the journal delete at
  line 30) with `await deleteActorsByPrefix(gmPage);`, and append this test after the
  existing one:

```js
  // T1 (spec Group T): _prepareContext resolves every attendee to a real name,
  // but the template only ever put it in data-tooltip and alt - so the board
  // showed an unlabelled row of 36x36 portraits.
  test("prep board shows attendee names, not just portraits", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const actorName = `${TT_PREFIX}Attendee Ilva`;
    const sessionId = await page.evaluate(async ({ prefix, actorName }) => {
      const actor = await Actor.create({ name: actorName, type: "npc" });
      const session = await JournalEntry.create({
        name: `${prefix}Prep-Session`,
        pages: [{
          name: "s",
          type: "mej-campaign-companion.session",
          flags: {
            "mej-campaign-companion": { session: { sessionNumber: 1, campaignDate: null, attendees: [actor.uuid], secrets: [] } },
            "monks-enhanced-journal": { type: "session" }
          }
        }]
      });
      return session.id;
    }, { prefix: TT_PREFIX, actorName });

    // openPrepBoard() called directly - MEJ's own header-button injection for
    // it is broken on v14 (see this file's other test).
    await openEntry(page, sessionId, `${TT_PREFIX}Prep-Session`);
    await page.evaluate(async (id) => {
      const { openPrepBoard } = await import("/modules/mej-campaign-companion/scripts/apps/prep-board-app.mjs");
      const pageDoc = game.journal.get(id).pages.contents[0];
      await openPrepBoard({ pageUuid: pageDoc.uuid });
    }, sessionId);
    await settle(page, 500);
    const board = page.locator(".mej-cc-prep-board");
    await expect(board.locator(".mej-cc-prep-attendees li")).toHaveCount(1);
    await expect(board.locator(".mej-cc-prep-attendees li .mej-cc-prep-attendee-name")).toHaveText(actorName);
    await board.locator('button.header-control[data-action="close"]').click({ force: true });

    assertNoConsoleErrors(errors);
  });
```

  In `tests/e2e/15-campaign-portal.spec.mjs`, add to test 1 immediately after
  `await expect(shell.locator(".mej-cc-hub-header")).toBeVisible();` (line 113):

```js
      // T3 (spec Group T): the portal page carries MEJ's type flag so search,
      // the Hub index and export treat it as first-class - but mejPageOf used
      // that same flag as "does the companion own this page's presentation?",
      // so Tags/Attributes/Mentioned in were appended under the whole Hub.
      await expect(shell.locator(".mej-cc-knowledge")).toHaveCount(0);
```

  and the identical assertion in test 7 ("player seat: portal opens the scoped read view"),
  against that test's own portal shell locator — read lines 392-440 first and use the
  variable it already binds.

- [ ] 2. Run them and watch them fail:
  `npx playwright test tests/e2e/10-secrets-hub.spec.mjs tests/e2e/15-campaign-portal.spec.mjs --trace off --reporter=line`
  Expected: `prep board shows attendee names` fails with
  `Error: expect(locator).toHaveText() … waiting for locator('.mej-cc-prep-attendees li .mej-cc-prep-attendee-name')`
  (element never resolves), and both portal tests fail with
  `Expected: 0 / Received: 1` on `.mej-cc-knowledge`.

- [ ] 3. Implement.

  `templates/prep-board.hbs` — replace line 7 with:

```hbs
            {{#each attendees}}<li data-tooltip="{{this.name}}"><img src="{{this.img}}" alt="{{this.name}}"><span class="mej-cc-prep-attendee-name">{{this.name}}</span></li>
```

  `styles/campaign-companion.css` — replace the `.mej-cc-prep-attendees img` block
  (lines 972-976) with:

```css
.mej-cc-prep-attendees ul {
  flex-wrap: wrap;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.mej-cc-prep-attendees li {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 56px;
}

.mej-cc-prep-attendees img {
  width: 36px;
  height: 36px;
  border-radius: 4px;
}

.mej-cc-prep-attendee-name {
  font-size: var(--font-size-11, 11px);
  text-align: center;
  overflow-wrap: anywhere;
}
```

  `scripts/hooks/knowledge-ui.mjs` — extend the constants import at line 11 to
  `import { MODULE_ID, I18N, MEDIA_PAGE_TYPES, CAMPAIGN_DOCUMENT_TYPE, CAMPAIGN_TYPE, HUB_PAGE_ID } from "../constants.mjs";`
  and replace `mejPageOf` (lines 22-29) with:

```js
/** The page this sheet fronts, if the companion owns its presentation: an MEJ-typed page, or a native media page the companion mounts (spec E §1). */
function mejPageOf(sheet) {
  const doc = sheet?.document;
  if (!(doc instanceof JournalEntryPage)) return null;
  // Shell pages (the campaign portal, the synthetic Hub page) are a third kind
  // this predicate had no notion of: they carry the MEJ type flag on purpose,
  // so search/index/export treat them as first-class, but their whole body IS
  // the Hub - there is nothing to tag, no attributes and no "mentioned in".
  // Guard on the native subtype, never on the MEJ flag, which is load-bearing.
  // MEJ's fixType() normalizes a mounted page's in-memory `.type` to the bare
  // key, so accept all three forms (same reasoning as CampaignHubPage's own
  // isCampaignPage check).
  if (doc.type === CAMPAIGN_DOCUMENT_TYPE || doc.type === CAMPAIGN_TYPE
      || doc._source?.type === CAMPAIGN_DOCUMENT_TYPE || doc.id === HUB_PAGE_ID) return null;
  if (mejType(doc)) return doc;
  const bare = String(doc.type ?? "").split(".").pop();
  return MEDIA_PAGE_TYPES.includes(bare) ? doc : null;
}
```

- [ ] 4. Run the tests:
  `npx playwright test tests/e2e/10-secrets-hub.spec.mjs tests/e2e/15-campaign-portal.spec.mjs tests/e2e/07-knowledge.spec.mjs --trace off --reporter=line`
  — expected all passing. `07-knowledge` is included deliberately: it is the spec that
  proves the panel still injects on ordinary MEJ pages after the predicate change.
  `npm test` — expected `Tests 689 passed (689)` (unchanged; this task adds no unit tests).

- [ ] 5. Vacuity check, twice:
  (a) delete the `<span class="mej-cc-prep-attendee-name">` from `templates/prep-board.hbs`;
  run `npx playwright test tests/e2e/10-secrets-hub.spec.mjs --trace off --reporter=line -g "attendee names"`
  — expected failure on `toHaveText` (locator never resolves); restore.
  (b) delete the shell-page guard line from `knowledge-ui.mjs`'s `mejPageOf`; run
  `npx playwright test tests/e2e/15-campaign-portal.spec.mjs --trace off --reporter=line -g "creating a campaign creates its portal"`
  — expected failure `Expected: 0 / Received: 1`; restore and re-run both green.

- [ ] 6. Commit:

```sh
git add templates/prep-board.hbs styles/campaign-companion.css scripts/hooks/knowledge-ui.mjs tests/e2e/10-secrets-hub.spec.mjs tests/e2e/15-campaign-portal.spec.mjs
git commit -m "Label prep-board attendees, and keep the Knowledge panel off shell pages

Two template/predicate omissions. prep-board.hbs put each attendee's resolved
name only in data-tooltip and alt, never in a text node, so the board rendered an
unlabelled strip of portraits. knowledge-ui's mejPageOf keyed on the MEJ type
flag, which the campaign portal carries deliberately so search and export treat
it as first-class - so Tags/Attributes/Mentioned in was appended below the entire
Campaign Hub. Guard on the native subtype instead; the flag keeps its meaning."
```

---

## Task 3 — Group S: secrets and sheet context (S1, S2)

Spec items S1 (inv. §5) and S2 (inv. §12).

**Files:**
- Modify `scripts/hooks/secrets-ui.mjs` — new `suppressCoreRevealToggles` helper (insert
  after `mejPageOf`, lines 22-26); call it at the end of `injectPlayerSecrets`
  (after `container.replaceChildren(...)`, line 234) and from the `inject` closure in
  `registerSecretsUi` (lines 276-280).
- Create `scripts/logic/session-header.mjs` — pure header-context helper.
- Create `test/session-header.test.js`.
- Modify `scripts/sheets/SessionSheet.mjs` — import the helper; set `context.fields` and
  `context.showHeader` in `_prepareBodyContext` (insert after line 106,
  `const session = sessionData(this.document);`).
- Modify `templates/session.hbs` line 4 (the `sheet-detailed-header.hbs` partial include).
- Test: `tests/e2e/09-secrets.spec.mjs` (new test), `tests/e2e/01-session.spec.mjs`
  (new assertions).

**Interfaces:**
- Produces: `sessionHeaderContext({ src, fields })` exported from
  `scripts/logic/session-header.mjs`, returning `{ fields: Array, showHeader: boolean }`.
  Consumed by `SessionSheet._prepareBodyContext`.
- Produces: template context keys `fields` (an array in MEJ's `fieldlist()` shape, empty
  for Sessions) and `showHeader` (boolean), read by `templates/session.hbs:4`.
- Consumes: core's `HTMLSecretBlockElement.revealable` setter
  (`client/applications/elements/secret-block.mjs:50-52`), which sets
  `button.hidden = !revealable` on the `button.reveal` it injected — the exact operation
  `DocumentSheetV2._toggleDisabled(true)` performs and which MEJ's shell never reaches for
  a mounted subsheet.
- Consumes: `page.parent?.isOwner` as the write test, matching MEJ's own `editable`
  derivation.

- [ ] 1. Write the failing tests.

  Unit — create `test/session-header.test.js`:

```js
import { describe, it, expect } from "vitest";
import { sessionHeaderContext } from "../scripts/logic/session-header.mjs";

describe("sessionHeaderContext", () => {
  it("empties fields so MEJ's shared partial never iterates the raw page schema", () => {
    const schemaShaped = { name: {}, type: {}, src: {}, category: {}, sort: {} };
    expect(sessionHeaderContext({ src: null, fields: schemaShaped }).fields).toEqual([]);
  });
  it("suppresses the header when there is no image and no populated field", () => {
    expect(sessionHeaderContext({ src: null }).showHeader).toBe(false);
    expect(sessionHeaderContext({ src: "" }).showHeader).toBe(false);
  });
  it("renders the header when the page has an image", () => {
    expect(sessionHeaderContext({ src: "worlds/a/session.webp" }).showHeader).toBe(true);
  });
  it("renders the header when a fieldlist-shaped field carries a value", () => {
    const ctx = sessionHeaderContext({ src: null, fields: [{ id: "sessionNumber", name: "Session", value: "12" }] });
    expect(ctx.fields).toEqual([{ id: "sessionNumber", name: "Session", value: "12" }]);
    expect(ctx.showHeader).toBe(true);
  });
});
```

  e2e — in `tests/e2e/09-secrets.spec.mjs`, append this test inside
  `test.describe("09 secrets", …)` (read the `createPlaceWithSecret` / `openEntry` helpers
  at lines 20-63 first; this reuses both):

```js
  // S1 (spec Group S): core adds a Reveal/Hide toggle to every secret-block on
  // element upgrade with no permission check at all. The only suppression in
  // the platform is DocumentSheetV2._toggleDisabled(true), and MEJ's shell
  // calls it with the wrong element for a mounted subsheet, so a player looking
  // at a natively-revealed ("Everyone") secret got a Hide button.
  test("a player never gets core's Hide toggle on a natively-revealed secret; the GM still does", async ({ page, browser }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const NATIVE_HTML = `<p>Public intro.</p><section class="secret revealed" id="secret-native1"><p>${SECRET_TEXT}</p></section>`;
    const id = await page.evaluate(async ({ n, html }) => {
      const entry = await JournalEntry.create({
        name: n,
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        pages: [{ name: n, type: "monks-enhanced-journal.place", flags: { "monks-enhanced-journal": { type: "place" } }, text: { content: html } }]
      });
      return entry.id;
    }, { n: `${TT_PREFIX}Native-Reveal`, html: NATIVE_HTML });

    const gmShell = await openEntry(page, id);
    // The GM owns the entry and keeps the control.
    const gmState = await contentPreview(gmShell).locator("secret-block").first()
      .evaluate((el) => ({ revealable: el.revealable, buttonHidden: el.querySelector("button.reveal")?.hidden ?? null }));
    expect(gmState).toEqual({ revealable: true, buttonHidden: false });

    const p1Ctx = await browser.newContext(VIEW);
    const p1 = await p1Ctx.newPage();
    await login(p1, "User 1");
    const p1Shell = await openEntry(p1, id);
    // The player can read the revealed secret - that part is core behaviour.
    await expect(contentPreview(p1Shell)).toContainText(SECRET_TEXT);
    // Asserted on the property, not on visibility: MEJ has a display:none CSS
    // backstop for non-owners, so a visibility check would pass vacuously
    // whether or not this fix exists.
    const p1State = await contentPreview(p1Shell).locator("secret-block").first()
      .evaluate((el) => ({ revealable: el.revealable, buttonHidden: el.querySelector("button.reveal")?.hidden ?? null }));
    expect(p1State.revealable).toBe(false);
    expect(p1State.buttonHidden).not.toBe(false);

    await p1Ctx.close();
    assertNoConsoleErrors(errors);
  });
```

  e2e — in `tests/e2e/01-session.spec.mjs`, append this test inside
  `test.describe("01 session entries", …)` (it reuses `createSessionViaDialog` and
  `cleanupEntries`, both already in the file):

```js
  // S2 (spec Group S): SessionSheet never shadowed context.fields, so MEJ's
  // shared detailed-header partial iterated Foundry's raw DataFields and drew
  // "Page Name / Type / File Path / Page Category / Sort Order" over empty divs,
  // with a broken image beside them (the partial's onerror fallback resolves to
  // assets/session.png, which MEJ does not ship).
  test("a fresh Session sheet renders no schema-labelled header rows", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const name = `${TT_PREFIX}Session Header`;
    const entryId = await createSessionViaDialog(page, name);
    const shell = page.locator("#MonksEnhancedJournal");
    await expect(shell.locator(".session-container .journal-sheet-header")).toHaveCount(0);
    await expect(shell.locator(".session-container .journal-sheet-header .form-group")).toHaveCount(0);
    // The sheet still works with the header suppressed: the tab strip is the
    // first thing in the container, and the recap editor is present.
    await expect(shell.locator(".session-container nav.sheet-tabs")).toHaveCount(1);
    await expect(shell.locator('.editor-parent[data-editor-id="recap"]')).toHaveCount(1);
    // The page name is untouched by a form submit that no longer carries a
    // name input (ApplicationV2 submits only the fields that rendered).
    await shell.locator('a[data-action="tab"][data-tab="session"]').click();
    await settle(page, 200);
    const numberInput = shell.locator('input[name="flags.mej-campaign-companion.session.sessionNumber"]');
    await numberInput.fill("3");
    await numberInput.blur();
    await page.waitForFunction(
      (id) => game.journal.get(id).pages.contents[0].getFlag("mej-campaign-companion", "session")?.sessionNumber === 3,
      entryId
    );
    const stillNamed = await page.evaluate((id) => game.journal.get(id).pages.contents[0].name, entryId);
    expect(stillNamed).toBe(name);

    await cleanupEntries(page, [entryId]);
    assertNoConsoleErrors(errors);
  });
```

- [ ] 2. Run them and watch them fail:
  `npx vitest run test/session-header.test.js` — expected
  `Error: Failed to load url ../scripts/logic/session-header.mjs`.
  `npx playwright test tests/e2e/09-secrets.spec.mjs tests/e2e/01-session.spec.mjs --trace off --reporter=line`
  — expected: the S1 test fails on `expect(p1State.revealable).toBe(false)` with
  `Received: true`; the S2 test fails on
  `expect(locator).toHaveCount(0) … Received: 1` for `.journal-sheet-header`.

- [ ] 3. Implement S1. In `scripts/hooks/secrets-ui.mjs`, insert after `mejPageOf`
  (line 26):

```js
/**
 * Core's HTMLSecretBlockElement adds a Reveal/Hide toggle to every secret-block
 * on element upgrade, with NO permission check of its own (client/applications/
 * elements/secret-block.mjs). The platform's only suppression is
 * DocumentSheetV2._toggleDisabled(true), which core runs from _onRender - and
 * MEJ's shell never runs _onRender for a mounted subsheet; its hand call passes
 * `subsheet` as `this`, so it inspects subsheet.element rather than the element
 * the shell just rendered into. Do core's own operation ourselves for anyone
 * who cannot write the entry.
 */
function suppressCoreRevealToggles(sheet, element) {
  const page = mejPageOf(sheet);
  if (!page || !element) return;
  if (page.parent?.isOwner) return;                 // GM / genuine owner keeps the control
  for (const block of element.querySelectorAll("secret-block")) {
    // `revealable` is the v13+/v14 property; the fallback covers a wrapper that
    // has not been upgraded yet.
    if ("revealable" in block) block.revealable = false;
    else block.querySelector(":scope > .secret > button.reveal")?.remove();
  }
}
```

  Add `suppressCoreRevealToggles(sheet, element);` as the last statement of
  `injectPlayerSecrets` (immediately after `container.replaceChildren(...root.childNodes);`,
  line 234) — the sections it inserts arrive after the hook body has already walked the
  element — and as the last statement of the `inject` closure in `registerSecretsUi`:

```js
  const inject = (sheet, html, shellHosted) => {
    const element = asElement(html);
    injectGmOverlay(sheet, element, shellHosted).catch((err) => console.error(`${MODULE_ID} | secret overlay failed`, err));
    injectPlayerSecrets(sheet, element).catch((err) => console.error(`${MODULE_ID} | player secret render failed`, err));
    suppressCoreRevealToggles(sheet, element);
  };
```

- [ ] 4. Implement S2. Create `scripts/logic/session-header.mjs`:

```js
/**
 * Context for MEJ's shared detailed-header partial on a Session sheet. Pure
 * (vitest-loadable); SessionSheet supplies the values.
 *
 * DocumentSheetV2._prepareContext puts `document.schema.fields` - an object of
 * DataField instances - on context.fields. MEJ's partial iterates it expecting
 * fieldlist()'s {id, name, value, ...} shape, so a sheet that does not shadow
 * the key renders "Page Name / Type / File Path / Page Category / Sort Order"
 * over empty divs. Every MEJ sheet shadows it (PlaceSheet.js:168,
 * PersonSheet.js:125, ...); the companion's SessionSheet did not.
 *
 * A Session's real header data (number, campaign date, attendees) lives on the
 * Session tab, so the list is empty - and an empty header with no image is not
 * worth ~250px of a 900px window, hence showHeader.
 */
export function sessionHeaderContext({ src = null, fields = null } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  return { fields: list, showHeader: !!src || list.some((f) => f?.value) };
}
```

  In `scripts/sheets/SessionSheet.mjs`, add
  `import { sessionHeaderContext } from "../logic/session-header.mjs";`
  after the existing `../logic/player-recap.mjs` import (line 16), and insert into
  `_prepareBodyContext` right after `const session = sessionData(this.document);`
  (line 106):

```js
    // MEJ's shared header partial (session.hbs:4) iterates `fields`; see
    // logic/session-header.mjs for what core leaves there and why.
    Object.assign(context, sessionHeaderContext({ src: context.data?.src ?? null }));
```

  In `templates/session.hbs`, replace line 4 with:

```hbs
            {{#if showHeader}}{{> "modules/monks-enhanced-journal/templates/sheets/partials/sheet-detailed-header.hbs"}}{{/if}}
```

- [ ] 5. Run the tests:
  `npm test` — expected `Tests 693 passed (693)`, `Test Files 57 passed (57)`.
  `npx playwright test tests/e2e/09-secrets.spec.mjs tests/e2e/01-session.spec.mjs tests/e2e/06-player-collab.spec.mjs --trace off --reporter=line`
  — expected all passing. `06-player-collab` is included because it drives the same Session
  sheet and would catch a header suppression that broke the recap editors.

- [ ] 6. Vacuity check, twice:
  (a) change `if (page.parent?.isOwner) return;` to `return;` in
  `suppressCoreRevealToggles` (disabling it for everyone); run
  `npx playwright test tests/e2e/09-secrets.spec.mjs --trace off --reporter=line -g "natively-revealed secret"`
  — expected failure `expect(received).toBe(expected) … Expected: false Received: true`;
  restore.
  (b) change `templates/session.hbs:4` back to an unconditional partial include; run
  `npx playwright test tests/e2e/01-session.spec.mjs --trace off --reporter=line -g "schema-labelled header rows"`
  — expected failure `Expected: 0 / Received: 1`; restore and re-run both green.

- [ ] 7. Commit:

```sh
git add scripts/hooks/secrets-ui.mjs scripts/logic/session-header.mjs scripts/sheets/SessionSheet.mjs templates/session.hbs test/session-header.test.js tests/e2e/09-secrets.spec.mjs tests/e2e/01-session.spec.mjs
git commit -m "Suppress core's Hide toggle for non-owners, and stop rendering the page schema as a Session header

Two gaps that both come from MEJ's shell never calling _onRender for a mounted
subsheet. Core adds the Reveal/Hide button to every secret-block on upgrade with
no permission check; the platform's only suppression is
DocumentSheetV2._toggleDisabled(true), which MEJ hand-calls against the wrong
element, so a player looking at an Everyone-revealed secret got a Hide control.
And DocumentSheetV2 leaves the raw JournalEntryPage schema on context.fields,
which MEJ's shared header partial iterates expecting fieldlist()'s shape - every
MEJ sheet shadows the key, SessionSheet did not, so a Session drew five empty
schema-labelled rows and a broken image over ~250px of the window."
```

---

## Task 4 — Group L: layout and CSS (L1, L2, L3)

Spec items L1 (inv. §1), L2 (inv. §3), L3 (inv. §13). L2 and L3 touch the same
`.editor-parent` / `.editor-display` cascade and land together.

**Files:**
- Modify `styles/campaign-companion.css` — L1: a new block after the
  `.mej-cc-timeline` rule at lines 212-215. L2: a new block after the existing
  `.session-container .editor-parent` rule at lines 16-18. L3: a new block beside it.
- Test: `tests/e2e/16-multi-timeline.spec.mjs` (assertion added to test 5, line 381),
  `tests/e2e/06-player-collab.spec.mjs` (assertions added to the recap test, after
  line 138), `tests/e2e/09-secrets.spec.mjs` (assertions added before the
  `clickWithHitDiagnostics` call at line 133).

**Interfaces:**
- Consumes: `.mej-cc-timeline-controls`, `.mej-cc-timeline-select` (emitted by
  `templates/hub.hbs:94-95`), `.session-container`, `.player-recaps-section`,
  `.player-recap-self`, `.other-recaps-list`, `.other-recap` (emitted by
  `templates/session.hbs:3, 23, 28, 39, 41`), `.mej-cc-secret-audience` (injected by
  `secrets-ui.mjs:injectGmOverlay`). All companion-emitted — verified by grep; none
  appears in MEJ.
- Produces: no new classes, no JS. Three scoped rule blocks.

- [ ] 1. Write the failing e2e assertions.

  L1 — in `tests/e2e/16-multi-timeline.spec.mjs` test 5 ("rename and delete"), immediately
  before `await shell.locator("button.mej-cc-timeline-rename").click();` (line 390):

```js
      // L1 (spec Group L): .mej-cc-timeline-controls had no rule at all, so it
      // stayed display:block and the picker, Make default, rename and delete
      // each took their own line. Every sibling control row in the stylesheet
      // (.mej-cc-index-controls, .mej-cc-graph-controls, .mej-cc-secrets-controls)
      // is a flex row; this one was simply never given one.
      const selectBox = await shell.locator("select.mej-cc-timeline-select").boundingBox();
      const renameBox = await shell.locator("button.mej-cc-timeline-rename").boundingBox();
      const centre = (b) => b.y + b.height / 2;
      expect(Math.abs(centre(selectBox) - centre(renameBox))).toBeLessThan(6);
```

  L2 — in `tests/e2e/06-player-collab.spec.mjs`, in the first test, after the
  `p2FlagAbsent` assertion (line 138) and before `assertNoConsoleErrors(p1Errors);`:

```js
    // L2 (spec Group L): the GM's own recap editor is empty, and MEJ's
    // .editor-parent {flex:1; height:100%} let it claim the whole
    // .player-recaps-section, pushing ol.other-recaps-list past the bottom of a
    // .sheet-body that clips its overflow. The row was in the DOM (this file
    // already proved that for a player) but off-screen for the GM.
    const gmShell = await openSession(gmPage, entryId);
    const gmOther = gmShell.locator(".other-recap");
    await expect(gmOther).toHaveCount(1);
    await expect(gmOther).toBeVisible();
    const otherBox = await gmOther.boundingBox();
    const bodyBox = await gmShell.locator(".session-container .sheet-body").boundingBox();
    expect(otherBox.height).toBeGreaterThan(0);
    expect(otherBox.y).toBeGreaterThanOrEqual(bodyBox.y);
    expect(otherBox.y + otherBox.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height + 1);
```

  L3 — in `tests/e2e/09-secrets.spec.mjs`, in the first test, immediately before
  `await clickWithHitDiagnostics(btn, page);` (line 133):

```js
    // L3 (spec Group L): the diagnostic capture recorded in the comment above
    // measured this wrapper at clientHeight 0 / scrollHeight 73 - scrollable at
    // zero height, so a click's own scroll-into-view shifted every child's rect
    // up and the audience button landed over the tab strip. A box with no
    // scrollable overflow cannot mis-scroll.
    const scroller = gmShell.locator('.editor-display[data-key="text.content"]');
    expect(await scroller.evaluate((el) => el.clientHeight)).toBeGreaterThan(0);
    expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
```

- [ ] 2. Run them and watch them fail:
  `npx playwright test tests/e2e/16-multi-timeline.spec.mjs tests/e2e/06-player-collab.spec.mjs tests/e2e/09-secrets.spec.mjs --trace off --reporter=line`
  Expected: 16 fails on `expected … to be less than 6` (the buttons sit a full row below
  the select); 06 fails on `expect(locator).toBeVisible()` or on the
  `otherBox.y + otherBox.height <= bodyBox bottom` bound; 09 fails on
  `expected 0 to be greater than 0`.

- [ ] 3. Implement L1. In `styles/campaign-companion.css`, insert after the
  `.mej-cc-timeline` block (line 215, `}`):

```css
/* Modelled on .mej-cc-index-controls above - every other control row in this
   file is a flex row, and this one (the newest, from the multi-timeline work)
   was simply never given a rule, so it stayed display:block and stacked. */
.mej-cc-timeline-controls {
  display: flex;
  align-items: center;
  gap: 0.5em;
  flex: 0 0 auto;
}

.mej-cc-timeline-controls .mej-cc-timeline-select {
  flex: 1 1 auto;
  min-width: 0;
}

.mej-cc-timeline-controls button {
  flex: 0 0 auto;
}
```

- [ ] 4. Run L1's test: `npx playwright test tests/e2e/16-multi-timeline.spec.mjs --trace off --reporter=line`
  — expected all passing.

- [ ] 5. Vacuity-check L1: comment out the `display: flex;` line; re-run the same command
  — expected failure `expected 39 to be less than 6` (the exact number will differ);
  restore and re-run green.

- [ ] 6. Commit L1:

```sh
git add styles/campaign-companion.css tests/e2e/16-multi-timeline.spec.mjs
git commit -m "Lay the timeline controls out as a row

.mej-cc-timeline-controls had no CSS rule at all - grep found no hits in the
stylesheet - so the div stayed display:block and its select plus three buttons
each took their own line. Every sibling control row (.mej-cc-index-controls,
.mej-cc-graph-controls, .mej-cc-secrets-controls, .mej-cc-order-menu) already
has the same flex rule; give this one the same."
```

- [ ] 7. Implement L2 + L3. In `styles/campaign-companion.css`, insert after the existing
  `.session-container .editor-parent { position: relative; }` block (line 18):

```css
/* L2. MEJ's .editor-parent is `flex:1; height:100%` (css/monks-journal-sheet.css
   :606-610) - correct when it is the only editor in a tab. The Session
   description tab has two plus a sibling list, and .player-recaps-section is a
   flex item with a definite main size, so `height:100%` on the (for a GM, empty)
   self-recap editor resolved to the whole section and pushed
   ol.other-recaps-list past a .sheet-body that clips its overflow. Pin the
   self-recap to content size and let the list take the remainder. */
.session-container .player-recaps-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.session-container .player-recap-self.editor-parent {
  flex: 0 0 auto;
  height: auto;
  min-height: 4.5em;
}

.session-container .player-recap-self .editor.editor-display {
  height: auto;
  min-height: 4.5em;
}

.session-container .other-recaps-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
}

/* L3. The same height:100% chain (.editor-parent, then
   .editor.editor-display at :612-619) resolves against a container that is not
   definite in these tab layouts, so the wrapper lays out at clientHeight 0
   while still holding content - and `overflow-y:auto` keeps a 0px box
   scrollable. Playwright's (and a real user's) scroll-into-view then shifts
   every child's rect up by scrollTop and the audience button lands over the tab
   strip. Scoped by :has() to wrappers that actually hold a companion-injected
   control, so no MEJ sheet without companion content changes layout at all.
   As a flex item with a definite line, `flex:1 1 auto` gives it a real height
   and keeps its own scrolling inside the pane. */
.monks-journal-sheet .editor-parent:has(.mej-cc-secret-audience),
.monks-journal-sheet .editor.editor-display:has(.mej-cc-secret-audience) {
  height: auto;
  min-height: 0;
  flex: 1 1 auto;
}
```

- [ ] 8. Run the L2/L3 tests:
  `npx playwright test tests/e2e/06-player-collab.spec.mjs tests/e2e/09-secrets.spec.mjs tests/e2e/01-session.spec.mjs --trace off --reporter=line`
  — expected all passing. `01-session` is included because it owns the non-overlap check
  for the two `.editor-edit` pencils, which the existing
  `.session-container .editor-parent { position: relative }` rule exists to protect and
  which these new flex/height overrides sit directly on top of.

  Then the L3 pairing, six consecutive runs:

```sh
for i in 1 2 3 4 5 6; do
  echo "=== pairing run $i ==="
  npx playwright test tests/e2e/08-query-graph.spec.mjs tests/e2e/09-secrets.spec.mjs --trace off --reporter=line \
    2>&1 | tee "/Users/danbularzik/.claude/jobs/4378f1d9/tmp/l3-pairing-$i.log" | tail -3
done
grep -l "Execution context was destroyed\|intercepts pointer events\|failed" /Users/danbularzik/.claude/jobs/4378f1d9/tmp/l3-pairing-*.log || echo "6/6 clean"
```

  Expected: `6/6 clean`, and every log's tail reading `N passed`. `clickWithHitDiagnostics`
  stays in place; if it ever prints its `scrollTop / clientH / scrollH` triple again, the
  triple itself is the regression report.

- [ ] 9. Vacuity-check L2 and L3:
  (a) comment out the `.session-container .player-recap-self.editor-parent` block; run
  `npx playwright test tests/e2e/06-player-collab.spec.mjs --trace off --reporter=line -g "non-owner player can write their recap"`
  — expected failure on the `otherBox.y + otherBox.height <= bodyBox` bound (or
  `toBeVisible`); restore.
  (b) comment out the `:has(.mej-cc-secret-audience)` block; run
  `npx playwright test tests/e2e/09-secrets.spec.mjs --trace off --reporter=line -g "GM reveals a block to User 1"`
  — expected failure `expected 0 to be greater than 0`; restore and re-run both green.

- [ ] 10. Commit L2 + L3:

```sh
git add styles/campaign-companion.css tests/e2e/06-player-collab.spec.mjs tests/e2e/09-secrets.spec.mjs
git commit -m "Give MEJ's editor wrappers a real height on companion content

Not a data bug either time: the flag write, buildRecapEntries and Foundry's flag
merge all check out, and the <li> reaches the DOM. MEJ's
.editor-parent {flex:1; height:100%} and .editor.editor-display {height:100%;
min-height:100%; overflow-y:auto} resolve against a chain that is not definite in
these tab layouts. On the Session sheet that let the GM's empty self-recap editor
claim the whole recaps section and push the other-recaps list past a clipped
.sheet-body; on any sheet with a companion-injected audience button it produced a
clientHeight-0 box that was still scrollable, so a scroll-into-view moved the
button's rect over the tab strip. Both scoped to companion markup."
```

---

## Task 4b — Duplicate Knowledge-panel injection (added by controller ruling after Task 4)

**Why:** Task 4 fixed L3's zero-height wrapper, but the `09-secrets` audience-button intercept still reproduced 2/6 in the `08+09` pairing. Its failure capture (task-4-report.md, "residual") shows TWO `section.mej-cc-knowledge` panels injected on one sheet (260 px of a 523 px sheet), squeezing `section.sheet-body` to `clientHeight 0`. The same duplicate-panel symptom is the pre-existing `07-knowledge` "2 panels" intermittent seen in batched runs (Task 2b baseline control). This is a companion product bug in `scripts/hooks/knowledge-ui.mjs`.

**Files:**
- Modify: `scripts/hooks/knowledge-ui.mjs` (`injectPanel`, `trackPanel`, `refreshTrackedPanels`, the render-hook entry)
- Test: `tests/e2e/07-knowledge.spec.mjs` (regression), `test/knowledge-*.test.js` if a pure seam exists or is extracted

**Interfaces:**
- Consumes: the `trackPanel`/`panelRecords`/`trackedElements` structure introduced in 0.13.4 (Round 4 C13) — read its comment block; it documents a "two panels on screen" ordering hazard.
- Produces: at most ONE `.mej-cc-knowledge` per rendered sheet element at any time, across re-renders, shell-hosted subsheet swaps and popped-out sheets.

- [ ] 1. **Root cause first, with evidence.** Reproduce with the `08+09` pairing (`npx playwright test tests/e2e/08-query-graph.spec.mjs tests/e2e/09-secrets.spec.mjs --trace off --reporter=line`, up to 6 runs) and/or the batched `07+10+15` run, instrumenting `injectPanel` temporarily (console.debug of `element` identity, `sheet.id`, hook name, stack) to capture WHICH two code paths inject into the same element and in what order. Write the findings into the report before changing behaviour. Likely candidates: the render hook firing for both the shell and the subsheet with the same container; `refreshTrackedPanels` re-injecting into an element that a concurrent render is also injecting into; `injectPanel`'s stale-panel `remove()` scoped to `:scope` while the duplicate sits in a sibling/ancestor.
- [ ] 2. **Write the failing regression test** in `tests/e2e/07-knowledge.spec.mjs`: open an entry, trigger the sequence found in step 1 (e.g. open the same entry twice via the shell and a popout, or re-render via a flag update while the shell swaps subsheets), and assert `.mej-cc-knowledge` count is exactly 1 on every visible sheet element. It must fail on HEAD before the fix (run it 3× to show it reproduces; if it needs the exact interleaving, drive it deterministically from the test with `page.evaluate` calling the sheet's `render()` twice concurrently).
- [ ] 3. **Fix at the root** — the single injection owner: make `injectPanel` idempotent per element (query and remove ALL existing `.mej-cc-knowledge` in that element's sheet container — not just `:scope` — before inserting, or bail if an identical panel is already present for the same page), and make sure the tracking structure never holds two live records for nested elements. No timers, no `waitForTimeout`.
- [ ] 4. Run the new test 3×, `tests/e2e/07-knowledge.spec.mjs` in full, the batched `07+10+15` run, and the `08+09` pairing ×6 — the spec's L3 bar is 6/6 clean; report each.
- [ ] 5. Vacuity check: revert the fix by hand-edit, run the new test → fails; restore.
- [ ] 6. `npm test` ≥ 712; commit with the root cause in the message.

## Task 5 — Group V: vendor provenance (V1)

Spec item V1 (inv. §9). The bundle is byte-identical to npm `mammoth@1.12.0`; the
README's "matches none of them" claim is wrong.

**Files:**
- Modify `vendor/checksums.txt` line 3 — add a third field.
- Modify `tests/vendor/check-vendor.mjs` — the stale header at lines 5-11; `parseManifest`
  at lines 22-33 (export it, widen the regex, carry `pkg`); guard the CLI body (lines
  35-76) so the module can be imported; print the package claim; add an opt-in
  `--verify-upstream` mode.
- Modify `vendor/README.md` — Inventory table (lines 16-20), Recorded checksums block
  (lines 26-32), and delete/replace the "Known gap" section (lines 34-53).
- Modify `package.json` — add `check:vendor:upstream` beside `check:vendor`.
- Create `test/check-vendor-manifest.test.js`.

**Interfaces:**
- Produces: `parseManifest(text)` exported from `tests/vendor/check-vendor.mjs`, returning
  `[{ expected, file, pkg }]` where `pkg` is `null` when the third field is absent.
- Produces: npm script `check:vendor:upstream` → `node tests/vendor/check-vendor.mjs --verify-upstream`.
- Consumes: nothing new at runtime. **No shipped bytes change**, so `npm run check:vendor`
  must stay green throughout and no e2e is affected.

- [ ] 1. Write the failing unit test. Create `test/check-vendor-manifest.test.js`:

```js
import { describe, it, expect } from "vitest";
import { parseManifest } from "../tests/vendor/check-vendor.mjs";

describe("parseManifest", () => {
  const hash = "5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9";
  it("carries the package claim when the third field is present", () => {
    expect(parseManifest(`${hash}  mammoth.browser.min.js  mammoth@1.12.0`))
      .toEqual([{ expected: hash, file: "mammoth.browser.min.js", pkg: "mammoth@1.12.0" }]);
  });
  it("accepts a two-field line and reports no package claim", () => {
    expect(parseManifest(`${hash}  d3-force.esm.js`))
      .toEqual([{ expected: hash, file: "d3-force.esm.js", pkg: null }]);
  });
  it("skips blank lines and comments", () => {
    expect(parseManifest(`# a note\n\n${hash}  docx.iife.js\n`)).toHaveLength(1);
  });
  it("rejects a line it cannot parse", () => {
    expect(() => parseManifest("not-a-checksum  file.js")).toThrow(/cannot parse line/);
  });
});
```

- [ ] 2. Run it and watch it fail:
  `npx vitest run test/check-vendor-manifest.test.js`
  Expected: `SyntaxError: The requested module '../tests/vendor/check-vendor.mjs' does not provide an export named 'parseManifest'`
  (and, once exported but unguarded, the CLI body would run at import time — which is why
  step 3 guards it).

- [ ] 3. Implement. `vendor/checksums.txt` — replace line 3 with:

```
5d4c0e7c9165d70b78f789c5274a2c7846d9e1c06ec19b69afa6ef45f789a3b9  mammoth.browser.min.js  mammoth@1.12.0
```

  (lines 1 and 2 keep their two-field form: `d3-force.esm.js` is a local esbuild bundle
  with no upstream file to compare, and `docx.iife.js` is still unidentified.)

  `tests/vendor/check-vendor.mjs` — replace the header claim at lines 5-11 with:

```js
// These files ship in the release zip but are installed by nothing, so
// `npm audit` never inspects them and no lockfile pins them (S5). This is the
// integrity half of that gap: it guarantees the bytes in a release are the bytes
// that were reviewed, and that a regeneration was accompanied by an updated
// record. A third manifest field records WHICH published package a bundle is,
// where that is known (mammoth is `mammoth@1.12.0`, established by hashing
// `npm pack` output for every release 1.6.0-1.12.2); `--verify-upstream` re-checks
// that claim against the registry, and is opt-in so the default run stays offline.
```

  replace `parseManifest` (lines 22-33) with:

```js
/** Parse `shasum -a 256` output plus an optional package claim: "<hex>  <file>  [<name>@<version>]". */
export function parseManifest(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = /^([0-9a-f]{64})\s+(\S+)(?:\s+(\S+@\S+))?$/.exec(line);
      if (!match) throw new Error(`vendor/checksums.txt: cannot parse line: ${line}`);
      return { expected: match[1], file: match[2], pkg: match[3] ?? null };
    });
}

/** Tarball path of the browser bundle we vendor, per package. */
const UPSTREAM_PATHS = {
  mammoth: "package/mammoth.browser.min.js",
  docx: "package/build/index.iife.js"
};
```

  wrap everything from line 35 (`const problems = []`) to the end in a `main()` function
  invoked only as a CLI, so the module is importable:

```js
async function main({ verifyUpstream = false } = {}) {
  // ... the existing body, unchanged, except:
  //  - the per-entry loop destructures `{ expected, file, pkg }`
  //  - after the hash comparison, when verifyUpstream && pkg, run the upstream check below
  //  - the final log line becomes:
  //      console.log(`check:vendor — ${entries.length} vendor bundles match their recorded checksums ` +
  //        `(${entries.filter((e) => e.pkg).map((e) => e.pkg).join(", ") || "no package claims recorded"}).`);
}

/** Opt-in: re-hash the package the manifest claims, straight from the registry. */
async function verifyUpstreamEntry({ file, pkg, expected }) {
  const [name] = pkg.split("@");
  const source = UPSTREAM_PATHS[name];
  if (!source) return `${file}: no upstream path known for ${name}; cannot verify`;
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "check-vendor-"));
  try {
    const { stdout } = await run("npm", ["pack", pkg, "--pack-destination", dir], { cwd: dir });
    const tarball = stdout.trim().split("\n").pop();
    await run("tar", ["xzf", tarball, "-C", dir]);
    const bytes = await readFile(join(dir, source));
    const actual = createHash("sha256").update(bytes).digest("hex");
    return actual === expected ? null : `${file}: recorded as ${pkg}, but that release hashes to ${actual}`;
  } catch (error) {
    return `${file}: could not fetch ${pkg} (${error.message})`;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main({ verifyUpstream: process.argv.includes("--verify-upstream") });
}
```

  and add `pathToFileURL` to the `node:url` import at line 16.

  `package.json` — add after the `check:vendor` line:

```json
    "check:vendor:upstream": "node tests/vendor/check-vendor.mjs --verify-upstream",
```

  `vendor/README.md` — in the Inventory table (lines 16-20) change the `mammoth` row's
  Upstream cell to `[mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) **1.12.0**`;
  in the Recorded checksums block (line 30) append `  mammoth@1.12.0` to the mammoth line;
  and replace the whole "Known gap: the current versions are unidentified" section
  (lines 34-53) with:

```md
## Version provenance

`mammoth.browser.min.js` is **`mammoth@1.12.0`**, byte-identical to the prebuilt
browser bundle inside that release's npm tarball (`package/mammoth.browser.min.js`).
Established by `npm pack`-ing every release from 1.6.0 to 1.12.2 and hashing each:
1.12.0 is an exact match, and it is the only one. The earlier claim here — that the
file matched no published release and was probably a local build — was wrong; the
comparison it rested on was never actually run against the tarball's own prebuilt
file. `checksums.txt` now records the claim as a third field, and
`npm run check:vendor:upstream` re-checks it against the registry (opt-in: the
default `check:vendor` run stays offline, because it runs in CI beside the unit
suite).

Two bundles are still unidentified. `docx.iife.js` is not `docx@9.1.0`
(776 004 bytes there against 1 123 332 here); the same size/hash sweep across
`docx` 9.x should be repeated when the registry cooperates. `d3-force.esm.js` is
genuinely a local esbuild bundle — its own first-line provenance comment says so —
and cannot be matched by hash; it needs its source version recorded at
regeneration time instead.

`mammoth` 1.12.2 is the latest published release, so the vendored copy is two
patch releases behind. That upgrade is deliberately **not** taken here: replacing
the bundle changes docx-import behaviour and needs `05-docx-import` run against
it, per the Regenerating steps below.
```

- [ ] 4. Run the tests:
  `npx vitest run test/check-vendor-manifest.test.js` — expected `4 passed`.
  `npm test` — expected `Tests 697 passed (697)`, `Test Files 58 passed (58)`.
  `npm run check:vendor` — expected
  `check:vendor — 3 vendor bundles match their recorded checksums (mammoth@1.12.0).`
  `npm run check:vendor:upstream` — expected the same line with no problems reported
  (needs network; if the registry throttles, record the failure text and re-run — this
  mode is opt-in precisely so a throttled registry cannot block the round).

- [ ] 5. Vacuity check. Hand-edit `vendor/checksums.txt` line 3's third field to
  `mammoth@1.11.0` and run `npm run check:vendor:upstream` — expected
  `mammoth.browser.min.js: recorded as mammoth@1.11.0, but that release hashes to 62773d3b…`.
  Then revert that edit, hand-edit `parseManifest`'s regex back to `/^([0-9a-f]{64})\s+(.+)$/`
  and run `npx vitest run test/check-vendor-manifest.test.js` — expected failure
  `expected { expected: …, file: 'mammoth.browser.min.js  mammoth@1.12.0' } to deeply equal …`.
  Restore both and re-run green.

- [ ] 6. Commit:

```sh
git add vendor/checksums.txt vendor/README.md tests/vendor/check-vendor.mjs package.json test/check-vendor-manifest.test.js
git commit -m "Pin the vendored mammoth bundle to 1.12.0 and correct the provenance record

vendor/README.md claimed the bundle matched no published release and was probably
a local build. It is byte-identical to package/mammoth.browser.min.js inside the
mammoth@1.12.0 npm tarball - the only release out of 1.6.0-1.12.2 that matches.
Record the claim as a third manifest field, widen the manifest parser to carry it,
and add an opt-in --verify-upstream mode that re-hashes the release from the
registry. No shipped bytes change; 1.12.2 is noted as available, not applied."
```

---

## Task 6 — Group H: harness (H1, H2)

Spec items H1 (inv. §10) and H2 (inv. §11).

**Files:**
- Modify `tests/e2e/helpers/foundry.mjs` — add `timelineJournalIds` and
  `cleanupTimelineJournals` beside `cleanupTimelineJournal` (lines 340-387, whose doc
  comment is replaced); add `gotoGame`, `reloadGame` and the internal `waitSessionBound`
  immediately after `SESSION_BOUND` (lines 139-140).
- Modify `tests/e2e/02-hub-timeline.spec.mjs` (import line 3; `afterEach` line 50; the
  navigation at lines 70-72).
- Modify `tests/e2e/04-auto-capture.spec.mjs` (import line 3; cleanup call line 60).
- Modify `tests/e2e/05-docx-import.spec.mjs` (import line 3; cleanup call line 70).
- Modify `tests/e2e/14-campaigns.spec.mjs` (import line 16; cleanup call line 244; the new
  Task 2a test's cleanup; navigations at lines 336-338 and 694-696).
- Modify `tests/e2e/16-multi-timeline.spec.mjs` (import line 23; cleanup call line 131).
- Modify `tests/e2e/17-media-routing.spec.mjs` (import line 28; cleanup call line 280).
- Modify `tests/e2e/00-mej-api.spec.mjs` (lines 139-140), `01-session.spec.mjs`
  (141-142), `09-secrets.spec.mjs` (593-594), `12-native-mode.spec.mjs` (13-14 and
  106-107), `13-stock-smoke.spec.mjs` (62-63), `15-campaign-portal.spec.mjs` (354-355).
- Test: the affected specs themselves; there is no vitest seam for the harness.

**Interfaces:**
- Produces: `timelineJournalIds(page)` → `Promise<string[]>`, the ids of every journal
  currently carrying `flags["mej-campaign-companion"].timeline`.
- Produces: `cleanupTimelineJournals(page, preexisting = [], { prefix = TT_PREFIX } = {})`
  — deletes only flagged timeline journals absent from `preexisting`, and only when they
  carry no non-`TT-` timepoints; strips `TT-` timepoints from the rest; clears the
  `timelineJournalId` **and** `hubTimelineSelection` settings when they point at a deleted
  id. `cleanupTimelineJournal` (singular) is **deleted** in the same commit — all callers
  migrate at once (six existing plus the Task 2a test).
- Produces: `gotoGame(page, { timeout = 60_000 })` and `reloadGame(page, { timeout = 60_000 })`,
  both ending in the private `waitSessionBound`, which wraps `page.waitForFunction(SESSION_BOUND)`
  and turns a landing-page miss into a labelled error naming `page.url()`.
- Consumes: `MODULE_ID` and `TT_PREFIX` (already exported from the same module, lines 10
  and 17) — `MODULE_ID` must be passed **into** `page.evaluate`, it is a Node-side import.
- Consumes: `BASE_URL` (line 8) for `gotoGame`.

- [ ] 1. Re-verify the ten navigation sites before touching anything:

```sh
grep -rn "waitForFunction(() => globalThis.game?.ready === true" tests/e2e/*.spec.mjs
grep -rn -B1 "await settle(page, 3000);" tests/e2e/09-secrets.spec.mjs
```

  Expected exactly nine hits from the first command — `00-mej-api:140`, `01-session:142`,
  `02-hub-timeline:71`, `12-native-mode:14`, `12-native-mode:107`, `13-stock-smoke:63`,
  `14-campaigns:337`, `14-campaigns:695`, `15-campaign-portal:355` — and the tenth site,
  `09-secrets:593-594` (`await page.reload(); await settle(page, 3000);`), from the second.
  If any line number has drifted, use the grep output, not this list.

- [ ] 2. Write the failing harness test. Create `tests/e2e/18-harness-cleanup.spec.mjs`
  — read `tests/e2e/16-multi-timeline.spec.mjs` lines 1-40 first and match its login,
  `trackConsoleErrors`, `TT_PREFIX` and id-tracked-cleanup style:

```js
// The harness testing itself (spec H1/H2): the two hazards the name-keyed
// cleanupTimelineJournal could not express. World A really does hold a
// pre-existing, empty journal named "Campaign Timeline", and campaign-owned
// timelines are named "<Campaign> — Timeline" and never matched the name filter
// at all, so they leaked.
import { test, expect } from "@playwright/test";
import {
  login, TT_PREFIX, timelineJournalIds, cleanupTimelineJournals,
  gotoGame, reloadGame, trackConsoleErrors, assertNoConsoleErrors, settle,
  KNOWN_MEJ_SESSION_ICON_404
} from "./helpers/foundry.mjs";

const IGNORE = [KNOWN_MEJ_SESSION_ICON_404];
const MODULE_ID = "mej-campaign-companion";

test.describe("18 harness cleanup", () => {
  test("deletes only flagged timelines that appeared, and never a name-alike", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    const preexisting = await timelineJournalIds(page);

    const seeded = await page.evaluate(async ({ id, prefix }) => {
      // A user document that merely shares the singleton's name - the exact
      // World A hazard. No module flag, so it is not a timeline at all.
      const lookalike = await JournalEntry.create({ name: "Campaign Timeline" });
      // A flagged timeline created after the snapshot: fair game.
      const appeared = await JournalEntry.create({
        name: `${prefix}Appeared Timeline`,
        flags: { [id]: { timeline: { timepoints: [{ id: "t1", label: `${prefix}point` }] } } }
      });
      // A flagged timeline carrying real content: never deleted, only stripped.
      const real = await JournalEntry.create({
        name: `${prefix}Real Timeline`,
        flags: { [id]: { timeline: { timepoints: [{ id: "t2", label: "Session Zero" }, { id: "t3", label: `${prefix}point` }] } } }
      });
      return { lookalikeId: lookalike.id, appearedId: appeared.id, realId: real.id };
    }, { id: MODULE_ID, prefix: TT_PREFIX });

    await cleanupTimelineJournals(page, preexisting);

    const after = await page.evaluate(({ ids, keep, id }) => ({
      lookalikeSurvives: !!game.journal.get(ids.lookalikeId),
      appearedGone: !game.journal.get(ids.appearedId),
      realSurvives: !!game.journal.get(ids.realId),
      realLabels: (game.journal.get(ids.realId)?.getFlag(id, "timeline")?.timepoints ?? []).map((t) => t.label),
      preexistingAllSurvive: keep.every((k) => !!game.journal.get(k))
    }), { ids: seeded, keep: preexisting, id: MODULE_ID });

    expect(after.lookalikeSurvives).toBe(true);
    expect(after.appearedGone).toBe(true);
    expect(after.realSurvives).toBe(true);
    expect(after.realLabels).toEqual(["Session Zero"]);
    expect(after.preexistingAllSurvive).toBe(true);

    // Tear down this test's own fixtures by id, never by name.
    await page.evaluate(async (ids) => {
      const doomed = [ids.lookalikeId, ids.realId].filter((i) => game.journal.get(i));
      if (doomed.length) await JournalEntry.implementation.deleteDocuments(doomed);
    }, seeded);
    assertNoConsoleErrors(errors);
  });

  test("gotoGame and reloadGame return on a session-bound document", async ({ page }) => {
    const errors = trackConsoleErrors(page, { ignore: IGNORE });
    await login(page, "Gamemaster");
    await gotoGame(page);
    await settle(page, 300);
    expect(await page.evaluate(() => !!game.socket?.session?.userId)).toBe(true);
    await reloadGame(page);
    await settle(page, 300);
    expect(await page.evaluate(() => !!game.socket?.session?.userId)).toBe(true);
    assertNoConsoleErrors(errors);
  });
});
```

- [ ] 3. Run it and watch it fail:
  `npx playwright test tests/e2e/18-harness-cleanup.spec.mjs --trace off --reporter=line`
  Expected: both tests fail at import with
  `SyntaxError: The requested module './helpers/foundry.mjs' does not provide an export named 'timelineJournalIds'`.

- [ ] 4. Implement H1. In `tests/e2e/helpers/foundry.mjs`, replace
  `cleanupTimelineJournal` and its doc comment (lines 340-387) with:

```js
/** Ids of every timeline journal that exists RIGHT NOW. Call in beforeAll/beforeEach. */
export async function timelineJournalIds(page) {
  return page.evaluate(
    (id) => game.journal.filter((e) => !!e.getFlag(id, "timeline")).map((e) => e.id),
    MODULE_ID
  );
}

/**
 * Delete every timeline journal created since `preexisting` was taken, provided
 * it carries no non-TT timepoints.
 *
 * Identity is the module's own flag, never the name. The old name-keyed helper
 * was wrong in both directions. It OVER-deleted: "Campaign Timeline" is the
 * default name of the world singleton AND a perfectly plausible name for a
 * user's real journal - which is the situation in World A today (a
 * pre-existing, empty one), and an empty user journal defeats the
 * "no non-TT timepoints => safe" heuristic that was the only guard. And it
 * UNDER-deleted: campaign-owned timelines are named "<Campaign> — Timeline"
 * (data/timeline-journal.mjs:85) and never matched the filter, so every one a
 * spec induced leaked unless its campaign folder was deleted with deleteContents.
 *
 * Registration cannot happen at creation time inside a spec, because the specs
 * do not create these - the module does, from a GM Hub render
 * (ensureTimelineJournal). So invert it: register what already existed, delete
 * only what appeared. The ledger is Node-side, so it survives page.reload(),
 * new contexts, and the per-worker restarts Playwright does after a failure.
 *
 * Take the snapshot BEFORE anything opens a GM Hub - a snapshot taken after
 * would bless a journal the run itself created.
 */
export async function cleanupTimelineJournals(page, preexisting = [], { prefix = TT_PREFIX } = {}) {
  await page.evaluate(async ({ id, TT, keep }) => {
    const keepSet = new Set(keep);
    const doomed = game.journal.filter((e) => !!e.getFlag(id, "timeline") && !keepSet.has(e.id));
    for (const j of doomed) {
      const tps = j.getFlag(id, "timeline")?.timepoints ?? [];
      const real = tps.filter((t) => !t.label?.startsWith(TT));
      if (real.length) {
        if (real.length !== tps.length) await j.setFlag(id, "timeline", { timepoints: real });
        continue;
      }
      const deletedId = j.id;
      await JournalEntry.implementation.deleteDocuments([deletedId]);
      // Both settings can be left dangling at a deleted id; the old helper
      // cleared only the first.
      if (game.settings.get(id, "timelineJournalId") === deletedId) await game.settings.set(id, "timelineJournalId", "");
      if (game.settings.get(id, "hubTimelineSelection") === deletedId) await game.settings.set(id, "hubTimelineSelection", "");
    }
  }, { id: MODULE_ID, TT: prefix, keep: preexisting });
}
```

  Confirm the two setting keys before running:
  `grep -n "timelineJournalId\|hubTimelineSelection" scripts/constants.mjs` — use the
  literal registered names those constants hold.

- [ ] 5. Migrate the six existing callers plus the Task 2a test. Each gains a
  module-scoped `let preexistingTimelines = [];` and takes its snapshot as a GM before
  any Hub opens:

  - `02-hub-timeline.spec.mjs`: import `timelineJournalIds, cleanupTimelineJournals`
    instead of `cleanupTimelineJournal` (line 3); add
    `test.beforeAll(async ({ browser }) => { await withGmPage(browser, async (p) => { preexistingTimelines = await timelineJournalIds(p); }); });`
    above the `afterEach`; change line 50 to
    `await cleanupAsGm(page, browser, (gmPage) => cleanupTimelineJournals(gmPage, preexistingTimelines));`.
  - `04-auto-capture.spec.mjs`: same import change (line 3); snapshot inside the same
    cleanup helper's caller (it already has a live GM `page`) — take it in a
    `test.beforeAll` via `withGmPage` and change line 60 to
    `await cleanupTimelineJournals(page, preexistingTimelines);`.
  - `05-docx-import.spec.mjs`: same pattern; line 70 becomes
    `await cleanupTimelineJournals(page, preexistingTimelines);`.
  - `16-multi-timeline.spec.mjs`: same pattern; line 131 becomes
    `await cleanupTimelineJournals(page, preexistingTimelines);`. This is the spec that
    most needs the campaign-timeline reclamation the new helper adds.
  - `17-media-routing.spec.mjs`: same pattern; line 280 becomes
    `await cleanupTimelineJournals(page, preexistingTimelines);`.
  - `14-campaigns.spec.mjs`: **simplifies.** In the adoption test, add
    `const preexistingTimelines = await timelineJournalIds(page);` beside the existing
    `prior` snapshot, and replace line 244's
    `await cleanupTimelineJournal(page, { excludeIds: prior.campaignTimelineIds });` with
    `await cleanupTimelineJournals(page, preexistingTimelines);`. Leave `prior`'s own
    name-keyed `campaignTimelineIds` / `campaignTimelineCount` fields alone — they are the
    test's "world left exactly as found" assertion, not a cleanup input. Migrate the Task 2a
    zero-campaign test's cleanup to `cleanupTimelineJournals(page, preexisting)` and its
    snapshot to `timelineJournalIds(page)` in the same edit.

  Then confirm nothing still calls the old helper:
  `grep -rn "cleanupTimelineJournal\b" tests/ scripts/` — expected: no hits.

- [ ] 6. Implement H2. In `tests/e2e/helpers/foundry.mjs`, insert immediately after
  `SESSION_BOUND` (line 140):

```js
async function waitSessionBound(page, timeout) {
  try {
    await page.waitForFunction(SESSION_BOUND, null, { timeout });
  } catch {
    // A reload that lands on /join (expired session) would otherwise burn the
    // whole timeout with no clue; name what we actually landed on.
    throw new Error(`no session-bound /game document after ${timeout}ms (url=${page.url()})`);
  }
}

/** Navigate to /game and wait for a session-bound document (never a bare game.ready). */
export async function gotoGame(page, { timeout = 60_000 } = {}) {
  await page.goto(`${BASE_URL}/game`);
  await waitSessionBound(page, timeout);
}

/** Reload the current /game document and wait for it to rebind. */
export async function reloadGame(page, { timeout = 60_000 } = {}) {
  await page.reload();
  await waitSessionBound(page, timeout);
}
```

  Replace each of the ten sites, keeping every trailing wait exactly as it is:

  - `00-mej-api.spec.mjs:139-140` → `await gotoGame(page);` (this also drops the hardcoded
    `http://localhost:30000/game` in favour of `BASE_URL`); keep `await settle(page, 500);`.
    Add `gotoGame` to its helper import.
  - `01-session.spec.mjs:141-142` → `await gotoGame(page);`; keep `settle(page, 300)`.
  - `02-hub-timeline.spec.mjs:70-71` → `await gotoGame(page);`; keep `settle(page, 500)`.
  - `12-native-mode.spec.mjs:13-14` → `await reloadGame(page);`; **keep the 2500 ms settle
    and its comment** — Foundry rebuilds `CONFIG.JournalEntryPage.sheetClasses`
    asynchronously after ready, which `SESSION_BOUND` does not cover.
  - `12-native-mode.spec.mjs:106-107` → `await reloadGame(page);`; keep `settle(page, 2500)`.
  - `13-stock-smoke.spec.mjs:62-63` → `await reloadGame(page);`; keep the
    `settle(page, 2500)` at line 67 and its comment.
  - `14-campaigns.spec.mjs:336-337` → `await gotoGame(page);`; keep `settle(page, 500)`.
  - `14-campaigns.spec.mjs:694-695` → `await gotoGame(playerPage);`; keep
    `settle(playerPage, 500)`.
  - `15-campaign-portal.spec.mjs:354-355` → `await reloadGame(page);`; **keep the
    `dataVersion` poll at lines 356-371 verbatim**, including its read-from-the-served-module
    target.
  - `09-secrets.spec.mjs:593-594` → `await reloadGame(page);` followed by the same
    `dataVersion` poll copied from `15-campaign-portal:361-371` (both tests rewind
    `dataVersion` to re-run a migration), replacing the blind `settle(page, 3000)`.

  Add `gotoGame` to the `./helpers/foundry.mjs` import in `00-mej-api`, `01-session`,
  `02-hub-timeline` and `14-campaigns`, and `reloadGame` to it in `09-secrets`,
  `12-native-mode`, `13-stock-smoke` and `15-campaign-portal`. Confirm none is
  left behind: `grep -rn "globalThis.game?.ready === true" tests/e2e/*.spec.mjs` —
  expected: no hits.

- [ ] 7. Run the affected specs:

```sh
npx playwright test tests/e2e/18-harness-cleanup.spec.mjs --trace off --reporter=line
npx playwright test tests/e2e/00-mej-api.spec.mjs tests/e2e/01-session.spec.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/04-auto-capture.spec.mjs tests/e2e/05-docx-import.spec.mjs --trace off --reporter=line
npx playwright test tests/e2e/09-secrets.spec.mjs tests/e2e/12-native-mode.spec.mjs tests/e2e/13-stock-smoke.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/15-campaign-portal.spec.mjs tests/e2e/16-multi-timeline.spec.mjs tests/e2e/17-media-routing.spec.mjs --trace off --reporter=line
```

  Expected: all passing. `npm test` — expected `Tests 697 passed (697)`, unchanged
  (`tests/e2e/**` is excluded from vitest by `vitest.config.mjs`).

- [ ] 8. Vacuity check (harness, so the check is on the guard itself). Hand-edit
  `cleanupTimelineJournals` to drop the `!keepSet.has(e.id)` clause; run
  `npx playwright test tests/e2e/18-harness-cleanup.spec.mjs --trace off --reporter=line -g "name-alike"`
  — expected failure `expect(received).toBe(expected) … preexistingAllSurvive Expected: true Received: false`
  (or, if World A currently holds no flagged timeline, the `realSurvives` assertion; in
  that case seed one flagged journal into `preexisting` by creating it before the snapshot
  and re-run). Restore, re-run green. Then hand-edit `waitSessionBound` to
  `await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout });`
  and confirm the second test still passes — it will; note in the commit message that this
  helper's value is a race the pairing protocol measures, not a single assertion, and that
  the labelled-error path is what the test pins.

- [ ] 9. Commit (two commits, H1 then H2):

```sh
git add tests/e2e/helpers/foundry.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/04-auto-capture.spec.mjs tests/e2e/05-docx-import.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/16-multi-timeline.spec.mjs tests/e2e/17-media-routing.spec.mjs tests/e2e/18-harness-cleanup.spec.mjs
git commit -m "Identify timeline journals by their flag, not by their name

cleanupTimelineJournal deleted by the name \"Campaign Timeline\" - which is both
the default name of the world singleton and a plausible name for a user's real
journal, exactly the situation in World A, where an empty pre-existing one
defeats the only guard the helper had. It also missed campaign-owned timelines
entirely, since those are named \"<Campaign> — Timeline\". The specs cannot
register these at creation, because the module creates them from a GM Hub
render - so snapshot the ids that already exist and delete only what appeared."

git add tests/e2e/helpers/foundry.mjs tests/e2e/00-mej-api.spec.mjs tests/e2e/01-session.spec.mjs tests/e2e/02-hub-timeline.spec.mjs tests/e2e/09-secrets.spec.mjs tests/e2e/12-native-mode.spec.mjs tests/e2e/13-stock-smoke.spec.mjs tests/e2e/14-campaigns.spec.mjs tests/e2e/15-campaign-portal.spec.mjs tests/e2e/18-harness-cleanup.spec.mjs
git commit -m "Wait for a session-bound document at every spec-side navigation

SESSION_BOUND was added in round 5 for a measured race - a cookie fast-path login
produces two /game navigations, and game.ready can flip on the first, doomed
document, so the next evaluate dies with its execution context. The helper module
was converted; the nine spec-side navigations were not, and 09-secrets:593 had no
ready wait at all, only a 3s settle standing in for both that and a migration
poll. One gotoGame/reloadGame pair replaces all ten; every site keeps its own
trailing wait, including the three 2500ms sheetClasses settles and the two
dataVersion polls."
```

---

## Task 7 — Regression gate and guide screenshots

**Files:**
- Modify `docs/gm-guide.md` line 126 — the `timeline-selector.png` caption.
- Modify `docs/images/timeline-selector.png`, `session-sheet-gm.png`,
  `session-sheet-player.png`, `prep-board.png`, `hub-search.png` (regenerated, not
  hand-edited), plus any other image the guide run rewrites.
- Test: the full suite; no new test code.

**Interfaces:**
- Consumes: the 0.13.5 baseline **93 passed / 0 failed / 12 skipped**.
- Consumes: `GUIDE_SHOTS=1` (read at `guide-screenshots.spec.mjs:32`); the run's own
  crash-safety snapshot at `tests/e2e/.guide-shots-snapshot.json` (line 30) and its
  `guideDemo` flag sweep (lines 101-120).

- [ ] 1. Full-suite run 1:

```sh
npx playwright test --trace off --reporter=line 2>&1 | tee /Users/danbularzik/.claude/jobs/4378f1d9/tmp/regression-run1.log | tail -20
```

  Expected: `12 skipped` and `passed` at **97** — 93 baseline + 4 new tests (Task 2a's
  zero-campaign test, Task 2b's prep-board test, Task 3's two) — with **0 failed**. Two of
  Task 6's new tests live in the new `18-harness-cleanup.spec.mjs`, so the exact figure is
  99; reconcile the count against the baseline by *name*, not by total: every one of the
  93 baseline tests must still pass, and the only additions are the ones this branch wrote.

- [ ] 2. Full-suite run 2 (same command, `regression-run2.log`). Both runs must agree.
  Any test that passes in one and fails in the other is a flake and blocks the round —
  diagnose it before continuing; do not add `retries`.

- [ ] 3. Guide screenshots:

```sh
GUIDE_SHOTS=1 npx playwright test tests/e2e/guide-screenshots.spec.mjs --trace off --reporter=line
git status --short docs/images
```

  Expected: the spec passes, and `git status` lists at least the four images the spec
  names — `timeline-selector.png`, `session-sheet-gm.png`, `prep-board.png`,
  `hub-search.png` — plus `session-sheet-player.png`, which shares the Session sheet with
  the S2/L2 fixes.

- [ ] 4. Check each of the four against its guide caption. Open each PNG and read it:
  - `timeline-selector.png` (`docs/gm-guide.md:126`) — the caption reads "showing Make
    default, rename and delete **beneath** the picker". After L1 they sit **beside** it.
    Edit the caption to "…showing Make default, rename and delete beside the picker".
    Also confirm the committed crop is still right: `guide-screenshots.spec.mjs:1105-1109`
    derives it live from `.mej-cc-timeline-controls`'s own bounding box, so it resizes
    itself — but the old committed PNG was sized around the stacked layout, so the new one
    must be visibly one row.
  - `session-sheet-gm.png` (`docs/gm-guide.md:47`) — caption: "the GM recap text and the
    Player Recaps heading below it". After S2 the five schema rows and the broken image
    are gone; after L2 User 1's recap row is visible below the heading. Both are
    improvements the caption already covers; leave it unless the heading is no longer
    visible in frame.
  - `prep-board.png` (`docs/gm-guide.md:239`) — caption: "showing attendees, the numbered
    secrets and clues list…". Confirm the attendee portraits now carry names underneath.
  - `hub-search.png` (`docs/gm-guide.md:92` and `docs/player-guide.md:49`) — both captions
    describe the matching field and snippet per row. Confirm no snippet contains
    `@UUID[` or a raw document id any more.

  Then `npm run check:links` — expected: no broken guide links.

- [ ] 5. World-clean verification. The guide run's own `afterAll` sweeps its fixtures;
  confirm it actually did. Write this to the temp dir and run it from the repo root:

```sh
cat > /Users/danbularzik/.claude/jobs/4378f1d9/tmp/world-clean-check.mjs <<'JS'
import { chromium } from "@playwright/test";
import { login } from "./tests/e2e/helpers/foundry.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await login(page, "Gamemaster");
const left = await page.evaluate((id) => ({
  entries: game.journal.filter((e) => e.getFlag(id, "guideDemo")).map((e) => e.name),
  actors: game.actors.filter((a) => a.getFlag(id, "guideDemo")).map((a) => a.name),
  folders: game.folders.filter((f) => f.getFlag(id, "guideDemo")).map((f) => f.name),
  ttNamed: game.journal.filter((e) => e.name?.startsWith("TT-")).map((e) => e.name)
}), "mej-campaign-companion");
console.log(JSON.stringify(left, null, 2));
await browser.close();
JS
node /Users/danbularzik/.claude/jobs/4378f1d9/tmp/world-clean-check.mjs
ls tests/e2e/.guide-shots-snapshot.json 2>&1
git status --short
```

  Expected: every array empty; `ls` reports
  `No such file or directory` (the snapshot file is deleted only after the restore has
  actually run — its presence means a crashed run); and `git status` shows no untracked
  file under `tests/e2e/`.

- [ ] 6. Commit:

```sh
git add docs/images docs/gm-guide.md
git commit -m "Recapture the guide screenshots the 0.13.6 fixes change

timeline-selector.png was cropped around the broken stacked control row;
session-sheet-gm.png carried the five empty schema-labelled header rows, the
broken assets/session.png image, and no visible player recap; prep-board.png
showed unlabelled attendee portraits; hub-search.png showed a snippet sliced
through a raw @UUID ref. The timeline caption said the controls sit beneath the
picker; they sit beside it now."
```

---

## Task 8 — Release prep (0.13.6)

**Files:**
- Modify `CHANGELOG.md` — new `## 0.13.6` section above `## 0.13.5 (2026-08-29)` (line 3).
- Modify `module.json` line 5 — `"version": "0.13.5"` → `"0.13.6"`.

**Interfaces:**
- Consumes: the spec's Release section — one CHANGELOG entry per user-visible fix
  (L1, L2, T1, T2, T3, T4, S1, S2, Q1) in the existing voice; H1/H2/V1 noted as
  "no user-facing change".
- Produces: version `0.13.6` in `module.json`, matching the annotated tag cut after merge.

- [ ] 1. Write the CHANGELOG entry. Insert after line 2 (`# Changelog`), in the existing
  voice — plain language, what the user saw, then what it does now:

```md
## 0.13.6 (2026-08-29)

Fix round. Nothing is migrated, and no data changes.

- **The timeline's picker and its buttons sit on one row again.** The
  timeline selector, "Make default", rename and delete each took a line of
  their own, pushing the timeline itself down the pane.
- **A GM can see the players' recaps.** On the Session sheet, the GM's own
  (usually empty) recap editor was taking the whole Player Recaps block and
  pushing everyone else's recap off the bottom of the sheet, where it was
  clipped. The recaps were always saved — they just weren't on screen.
- **Session sheets no longer open with a broken image and five empty rows.**
  The header was showing Foundry's internal page schema — "Page Name",
  "Type", "File Path", "Page Category", "Sort Order" — over empty boxes,
  next to an image that could never load, eating about a quarter of the
  window. A Session's number, date and attendees live on its Session tab,
  so the header is simply not drawn when there is nothing to put in it.
- **Clicking a secret's audience button works reliably.** The enriched
  preview it sits in was being laid out with no height at all while still
  holding content, so the first click could scroll the button up behind the
  tab strip.
- **The session prep board names its attendees.** They were an unlabelled
  row of portraits; the names were only in the hover tooltip.
- **Search results no longer show link markup.** A snippet could read
  `…rnalEntry.rMYO0mN9F6sSvpxN]{The Missing Caravan}` instead of the link's
  text. Document ids also stop being indexed as search words, so a search
  for a random id string no longer matches.
- **The campaign portal no longer shows an empty Tags / Attributes /
  Mentioned in panel** underneath the Campaign Hub. The portal page is the
  Hub; there is nothing on it to tag.
- **In a world with no campaigns yet, the controls that need one say so.**
  "File into campaign", "File all shown into…" and the Tools menu's
  auto-capture target were drawn as normal, did nothing at all when
  clicked, and gave no explanation. They are now disabled with a reason,
  and clicking one from anywhere else warns instead of failing silently.
- **A player no longer sees Foundry's Hide button** on a secret that was
  revealed to everyone. Pressing it could not actually have hidden anything
  — the server refuses the write — but it should not have been there.
- **The import wizard counts in the singular.** "1 sections detected as
  sessions" now reads "1 section detected as a session".
- **A dashboard query that cannot mean anything is rejected** instead of
  quietly returning nothing. `attr:=:=broken` asked for an attribute with
  no name, which no entry can have, so the dashboard sat empty with no
  explanation. Plain text, unbalanced brackets and stray quotes are still
  ordinary full-text searches — only genuinely meaningless tokens are
  refused, and the message now says which one.
- No user-facing change: the vendored `mammoth` bundle is now identified
  and pinned in the provenance record (`mammoth@1.12.0`), and the test
  harness identifies timeline journals by their own flag rather than by
  name and waits for a bound session at every navigation.
```

- [ ] 2. Bump the version: in `module.json`, line 5, `"version": "0.13.6",`.

- [ ] 3. Verify the release surface before handing off:

```sh
npm test
npm run check:vendor
npm run check:links
git log --oneline main..HEAD
git diff --stat main..HEAD
```

  Expected: 697 unit tests passing; vendor check green naming `mammoth@1.12.0`; no broken
  links; ten commits (Q1, T2+T4, T1+T3, S1+S2, L1, L2+L3, V1, H1, H2, guide shots) plus
  this release commit; the diff touching only `scripts/`, `templates/`, `styles/`,
  `lang/`, `test/`, `tests/`, `vendor/`, `docs/images/`, `docs/gm-guide.md`,
  `CHANGELOG.md`, `module.json`, `package.json` and `docs/superpowers/plans/`.

- [ ] 4. Commit:

```sh
git add CHANGELOG.md module.json
git commit -m "chore: release 0.13.6"
```

- [ ] 5. Hand off to **superpowers:finishing-a-development-branch** for the PR and merge
  decision. Do not tag or build the zip before the merge lands.

- [ ] 6. After merge, as in every prior round:
  - Cut an **annotated** tag named exactly `0.13.6` at the **merge commit** on `main`
    (`git tag -a 0.13.6 -m "0.13.6" <merge-sha>` then `git push origin 0.13.6`), so the
    published artifact can be reconstructed exactly.
  - Build the zip with `git archive` from that tag, with exactly this file list:

```sh
git archive --format=zip --output=/Users/danbularzik/.claude/jobs/4378f1d9/tmp/module.zip 0.13.6 \
  CHANGELOG.md docs/gm-guide.md docs/player-guide.md docs/manual-test-checklist.md \
  docs/images lang LICENSE module.json README.md scripts styles templates vendor
```

  - Diff the manifest against 0.13.5's published `module.json` — only `version` may differ.
  - Upload `module.json` and `module.zip` to the GitHub release for `0.13.6`, then verify
    `https://github.com/bularzik/mej-campaign-companion/releases/latest/download/module.json`
    resolves and reports `"version": "0.13.6"`.

---

## Out of scope (spec)

- Sub-project 2: the page-keyed secrets index (duplicate section ids, `pruneOrphans` data
  loss, `#secretSectionHtml` preview fallback) — a stored-data migration with its own spec.
- `mammoth` 1.12.2 upgrade.
- MEJ-side changes of any kind.
